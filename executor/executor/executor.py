import csv
import json
import logging
from pprint import pprint
import os
import shutil
import signal
import subprocess
import time
import traceback
from urllib import parse

import boto3
import botocore
import botocore.exceptions
from chardet.universaldetector import UniversalDetector
import requests

import executor.actions as action
import executor.action_statuses as status
import executor.artifacts as artifact
import executor.config as config
import executor.errors as error
from executor.output_sets import OutputSet

handler = logging.StreamHandler()
_formatter = logging.Formatter(
    "%(asctime)s.%(msecs)03d %(name)s %(levelname)s %(message)s", "%Y-%m-%d %H:%M:%S"
)
handler.setFormatter(_formatter)


class JobExecutor:
    """Responsible for performing actions, producing artifacts, and reporting error
    
    To understand the logical flow, start with the execute() method
    """

    def __init__(self):
        self.logger = logging.getLogger("runway")
        self.logger.setLevel(logging.getLevelName("DEBUG"))
        self.logger.propagate = False
        self.logger.addHandler(handler)

        self.action = ""
        self.error = None
        self.summary = {}
        self.timeout_seconds = int(os.environ.get("TIMEOUT_SECONDS"))


        self.wrapper_project = os.path.join(
            config.BUNDLE_DIR, "packages", "student_id_wrapper"
        )
        self.wrapper_earthmover = os.path.join(
            self.wrapper_project, "earthmover.yaml"
        )

        endpoint_url = os.environ.get("S3_ENDPOINT_URL")
        self.s3 = boto3.client("s3", **({"endpoint_url": endpoint_url} if endpoint_url else {}))
        self.local_mode = os.environ.get("DEPLOYMENT_MODE") == "LOCAL"
        self.conn = requests.Session()

        # wipe state left behind by a prior local run so reruns are idempotent
        shutil.rmtree(".lightbeam", ignore_errors=True)
        shutil.rmtree(config.OUTPUT_DIR_FIRST_RUN, ignore_errors=True)
        shutil.rmtree(config.ROSTER_DOWNLOAD_DIR, ignore_errors=True)

        self.output_dir = os.path.abspath(config.OUTPUT_DIR)
        os.mkdir(self.output_dir)
        os.environ["DATA_DIR"] = self.output_dir
        os.environ["OUTPUT_DIR"] = self.output_dir

        os.environ["REQUIRED_ID_MATCH_RATE"] = str(config.REQUIRED_ID_MATCH_RATE)
        os.environ["EDFI_ROSTER_SOURCE_TYPE"] = "file"
        os.environ["EDFI_ROSTER_FILE"] = artifact.ROSTER.path
        os.environ["TEMPORARY_DIRECTORY"] = "/tmp"

        # add retry logic
        retries = requests.adapters.Retry()
        self.conn.mount("http://", requests.adapters.HTTPAdapter(max_retries=retries))
        self.conn.mount("https://", requests.adapters.HTTPAdapter(max_retries=retries))

    def timeout_handler(self, signum, frame):
        self.error = error.ExecutorTimeout(self.timeout_seconds)
        raise TimeoutError()

    def execute(self):
        # in order to prevent deadlocked jobs from building up, the app provides
        # an execution timeout, after which point we will gracefully shut down
        self.logger.debug(f"timing out in {self.timeout_seconds} seconds...")
        signal.signal(signal.SIGALRM, self.timeout_handler)
        signal.alarm(self.timeout_seconds)

        success = False
        try:
            self.logger.info("spinning up")
            init_resp = self.conn.get(
                os.environ.get("INIT_JOB_URL"),
                headers={"Authorization": f"Bearer {os.environ.get('INIT_TOKEN')}"},
            )

            init_resp.raise_for_status()
            init_info = init_resp.json()

            self.conn.headers.update({"Authorization": f"Bearer {init_info['token']}"})
            job = self.conn.get(init_info["jobUrl"]).json()

            self.unpack_job(job)
            self.refresh_bundle_code()
            self.earthmover_deps()

            if self.send_to_ods and self.local_mode:
                self.modify_local_lightbeam()

            self.get_student_roster()
            self.get_input_files()

            self.map_descriptors()
            self.orchestrate_earthmover()

            self.lightbeam_send()

            self.report_unmatched_students()
            self.upload_output()
            self.compile_summary()

        # NOTE: all specific exceptions are handled in sub-methods
        except:
            # failure cases
            traceback.print_exc()

            # Lock in the error payload immediately so any failure below this point
            # still has something to report to the app.
            if not self.error:
                self.error = error.UnknownError(traceback.format_exc())
            if not self.error.stacktrace:
                self.error.stacktrace = traceback.format_exc()

            # generic exception catching to be super-defensive while we cleanup and make a best effort to get the error object out the door
            try:
                self.upload_remaining_artifacts()
            except Exception as e:
                self.logger.error(f"upload_remaining_artifacts raised during shutdown ({repr(e)}); continuing", exc_info=True)

            try:
                self.update_failure()
            except Exception as e:
                self.logger.error(f"update_failure raised during shutdown ({repr(e)}); continuing", exc_info=True)

            self.send_error()
        else:
            # success case
            success = True
            # send a final 'success' update for whatever our final action was
            self.update_success()
        finally:
            # in the future we may wish to perform additional cleanup here,
            # e.g. deleting data from the container as a security measure
            self.logger.info("spinning down")
            self.send_update(action.DONE, status.SUCCESS if success else status.FAILURE)

    def unpack_job(self, job):
        """Parse the job definition received from the app"""

        # basic unpacking
        try:
            self.status_url = job["appUrls"]["status"]
            self.error_url = job["appUrls"]["error"]
            self.matches_url = job["appUrls"]["unmatchedIds"]
            self.summary_url = job["appUrls"]["summary"]
            self.output_files_url = job["appUrls"]["outputFiles"]

            self.send_to_ods = job.get("sendToOds", True)
            self.cross_year_match_available = job.get("crossYearMatchAvailable", False)
            if self.cross_year_match_available:
                self.cross_year_roster_url = job["appUrls"]["roster"]

            self.assessment_project = os.path.join(
                self.wrapper_project, "packages", *job["bundle"]["path"].split("/")[1:]
            )
            self.seeds_dir = os.path.join(
                self.assessment_project, "seeds"
            )
            self.assessment_lightbeam = os.path.join(
                self.assessment_project, "lightbeam.yaml"
            )

            if not self.send_to_ods:
                self.logger.info("this job is not sending Earthmover output set to an ODS")
                artifact.LB_SEND_RESULTS.needs_upload = False
                if not self.cross_year_match_available:
                    # If bypassing the ODS and not pulling from EDU, require that a roster file exists in S3
                    self.roster_file_path = job["rosterFilePath"]
            else:
                #     Note that we always need the API_YEAR env var set in order to run Earthmover.
                # We also use it in cases when we are using an ODS - in such cases the year used by EM
                # and LB should be identical. So instead of providing API_YEAR explicitly as its own env
                # var, the app passes it implicitly as part of the inputParams object. Below, we unpack 
                # those values and assign them to env vars
                os.environ["EDFI_API_BASE_URL"] = job["assessmentDatastore"]["url"]
                os.environ["EDFI_API_CLIENT_ID"] = job["assessmentDatastore"]["clientId"]
                os.environ["EDFI_API_CLIENT_SECRET"] = job["assessmentDatastore"]["clientSecret"]
                # remove the secret so we don't log it
                del job["assessmentDatastore"]["clientSecret"]

            os.environ["ASSESSMENT_BUNDLE"] = os.path.basename(job["bundle"]["path"])
            os.environ["ASSESSMENT_BUNDLE_BRANCH"] = job["bundle"]["branch"]

            app_base_uri = parse.urlparse(job["appDataBasePath"])
            self.app_bucket = app_base_uri.hostname
            app_prefix = app_base_uri.path.strip("/")
            self.s3_in_path = f"{app_prefix}/input"
            self.s3_out_path = f"{app_prefix}/output"

            self.input_sources = job["inputFiles"]

            self.descriptor_map = job["customDescriptorMappings"]

            # note that API_YEAR is guaranteed to be included in this
            for env_name, value in job["inputParams"].items():
                os.environ[env_name] = str(value)
        except KeyError as e:
            self.error = error.InvalidJobError(f"job is missing required value: {e}")
            raise

        # semantic validation
        if "INPUT_FILE" not in self.input_sources:
            err_message = "job.inputFiles must include an INPUT_FILE item"
            self.error = error.InvalidJobError(err_message)
            raise ValueError(err_message)
        pprint(job)

    def refresh_bundle_code(self):
        """Pull from the bundles repo to ensure the latest code is being used"""
        self.set_action(action.BUNDLE_REFRESH)

        try:
            # the branch we're about to try to check out may not exist
            subprocess.run(
                ["git", "-C", config.BUNDLE_DIR, "fetch"]
            ).check_returncode()

            #    ASSESSMENT_BUNDLE_BRANCH is intended to be passed to Earthmover but we
            # can utilize it to enable non-main code to be run if the app dictates it
            subprocess.run(
                ["git", "-C", config.BUNDLE_DIR, "checkout", os.environ["ASSESSMENT_BUNDLE_BRANCH"]]
            ).check_returncode()

            subprocess.run(
                ["git", "-C", config.BUNDLE_DIR, "pull", "--ff-only"]
            ).check_returncode()
        except subprocess.CalledProcessError:
            self.error = error.GitPullError()
            raise
    
    def earthmover_cmd(self, **kwargs):
        """Thinly wrap our em calls to handle invocation and logging. Returns either a CompletedProcess object or CalledProcessError object"""

        em=subprocess.run(
            **kwargs
        )

        # Log stdout and stderror if they exist
        if em.stdout:
            self.logger.info(f"earthmover stdout: {em.stdout}")
        if em.stderr:
            self.logger.info(f"earthmover stderr: {em.stderr}")

        return em       

    def earthmover_deps(self):
        """Create the Earthmover runtime environment by installing bundle dependencies"""
        self.set_action(action.EARTHMOVER_DEPS)

        try:
            cmd=["earthmover", "-c", self.wrapper_earthmover, "deps"]
            self.earthmover_cmd(args=cmd, check=True)
        except subprocess.CalledProcessError:
            self.error = error.EarthmoverDepsError()
            raise

    def modify_local_lightbeam(self):
        """Disable SSL checking in Lightbeam so that it can communicate with a locally-running ODS"""
        subprocess.run(
            ["sed", "-i", "s/verify_ssl: True/verify_ssl: False/", self.assessment_lightbeam]
        )

    def get_student_roster(self):
        """Download a list of students so they can be used to match IDs in the initial Earthmover run"""
        self.set_action(action.GET_ROSTER)

        if self.send_to_ods:
            # Case 1: initially attempt to match on current year;
            #         leave open the cross-year option if we take another pass
            self.get_roster_from_ods()
        elif self.cross_year_match_available:
            # Case 2: not sending to this year's ODS but we have access to EDU;
            #         only running Earthmover once with cross-year roster
            self.get_roster_from_edu(artifact.ROSTER.path)
        else:
            # Case 3: not sending to this year's ODS and EDU is unavailable;
            #         only running Earthmover once with uploaded roster
            self.get_roster_from_s3()

        self.upload_artifact(artifact.ROSTER)

    def get_roster_from_edu(self, dest_path):
        """Query EDU via the Runway app and stream cross-year roster data into the given JSONL file"""
        self.logger.info(f"cross-year pass: streaming cross-year roster")
        dest_path = os.path.abspath(dest_path)
        os.makedirs(os.path.dirname(dest_path), exist_ok=True)
        try:
            stream_to_file(self.conn, self.cross_year_roster_url, dest_path)
        except requests.exceptions.RequestException:
            self.error = error.CrossYearRosterFetchError()
            raise

        if os.stat(dest_path).st_size == 0:
            self.error = error.CrossYearRosterFetchError()
            raise ValueError("Cross-year roster is empty")

    def get_roster_from_ods(self):
        """Fetch student roster from the ODS via lightbeam"""
        try:
            subprocess.run(
                ["lightbeam", "-c", self.assessment_lightbeam, "fetch", "-s", "studentEducationOrganizationAssociations", "-k", "studentIdentificationCodes,educationOrganizationReference,studentReference"]
            ).check_returncode()

            # in effect: mv output roster-download-dir
            # Because lightbeam uses the same directory for uploads and downloads,
            # we move the downloaded roster file to a separate location so that
            # it is not mixed in with the data that earthmover produces.
            # OUTPUT_DIR will be recreated by the Earthmover run
            os.rename(self.output_dir, config.ROSTER_DOWNLOAD_DIR)

            if os.stat(artifact.ROSTER.path).st_size == 0:
                raise ValueError("ODS contains no student enrollments")

        except (ValueError, FileNotFoundError):
            self.error = error.MissingOdsRosterError()
            raise
    
        except subprocess.CalledProcessError:
            self.error = error.LightbeamFetchError(
                "studentEducationOrganizationAssociations"
            )
            raise

    def get_roster_from_s3(self):
        """Download a pre-loaded roster file from S3"""
        self.logger.info(f"downloading roster from {self.roster_file_path}")
        os.makedirs(config.ROSTER_DOWNLOAD_DIR, exist_ok=True)

        try:
            roster_uri = parse.urlparse(self.roster_file_path, allow_fragments=False)
            bucket = roster_uri.hostname
            key = roster_uri.path.lstrip("/")
            self.s3.download_file(bucket, key, artifact.ROSTER.path)

            if os.stat(artifact.ROSTER.path).st_size == 0:
                raise ValueError("Downloaded roster file is empty")

        except (ValueError, FileNotFoundError):
            self.error = error.MissingOdsRosterError()
            raise
        except botocore.exceptions.ClientError:
            self.error = error.InputS3DownloadError(
                "roster", self.roster_file_path
            )
            raise

    def get_input_files(self):
        """Download user-uploaded files from S3"""
        self.set_action(action.GET_FILES)

        self.input_paths = {}
        for env_name, path in self.input_sources.items():
            # if allow_fragments is True, paths containing a '#' are incorrectly split
            uri = parse.urlparse(path, allow_fragments=False)
            try:
                # NOTE: there's a world where we don't need to download the file
                # and we can use something like s3fs to just give Earthmover an
                # s3 path, but we're not living in that world yet. s3fs seems to
                # have serious problems and without it, this would require a
                # change to earthmover itself
                uri_path = uri.path.lstrip("/")
                local_path = os.path.abspath(localize_s3_path(uri_path))
                self.s3.download_file(
                    self.app_bucket, f"{self.s3_in_path}/{uri_path}", local_path
                )
                os.environ[env_name] = local_path
                self.input_sources[env_name] = {"path": local_path}
            except botocore.exceptions.ClientError:
                self.error = error.InputS3DownloadError(
                    env_name, f"{self.s3_in_path}/{uri_path}"
                )
                raise

    def map_descriptors(self):
        """Replace assessment bundle seed files' Ed-Fi descriptors with custom values"""
        if not self.descriptor_map:
            return

        # each descriptor type we need to map has its own file
        for name, descriptors in self.descriptor_map.items():
            self.logger.debug(f"mapping {name}...")
            # check that v_other_columns has a consistent structure 
            v_other_columns = list(descriptors[0]["v_other_columns"].keys())
            for desc in descriptors:
                keys = list(desc["v_other_columns"].keys())
                # without caring about order
                if len(set(keys) ^ set(v_other_columns)) > 0:
                    raise ValueError(
                        f"{name}: expected {v_other_columns}, got {keys}"
                    )

            fields = v_other_columns + ["edfi_descriptor"]
            outfile = os.path.join(self.seeds_dir, f"{name}.csv")

            # create drop-in replacement CSVs
            with open(outfile, "w", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=fields)
                writer.writeheader()

                for d in descriptors:
                    # null values are written as blank strings, as intended
                    writer.writerow({
                        **d["v_other_columns"],
                        "edfi_descriptor": d["local_descriptor"],
                    })

                self.logger.debug(f"Mapped {len(descriptors)} {name} values")

    def orchestrate_earthmover(self):
        """Run an Earthmover bundle to transform assessment data.
        
        Conditionally run Earthmover a second time on input records that initially failed to match
        """
        self.set_action(action.EARTHMOVER_RUN)

        # first pass
        self.unpack_id_types()
        os.environ["EDFI_STUDENT_ID_TYPES"] = ",".join(self.distinct_id_types)
        self.logger.info(f"Student ID types in Ed-Fi roster: {os.environ['EDFI_STUDENT_ID_TYPES']}")

        self.earthmover_run(artifact.EM_RESULTS.path)
        self.upload_artifact(artifact.EM_RESULTS)
        self.record_highest_match_rate()

        self.output_sets = [OutputSet(
            local_dir=self.output_dir,
            s3_subdir="ods" if self.send_to_ods else "non-ods",
            sent_to_ods=self.send_to_ods,
            em_results_path=artifact.EM_RESULTS.path,
            lb_send_results_path=artifact.LB_SEND_RESULTS.path if self.send_to_ods else None,
        )]

        # if we're here, the first pass of Earthmover was successful
        if (self.send_to_ods                          # i.e. we've only tried matching this year's students so far
            and self.cross_year_match_available       # and we have access to EDU
            and self.num_unmatched_students > 0       # and there are unmatched students from the first pass
        ):
            # then take a second pass with the cross-year roster from EDU
            # and thus produce a second output set to be sideloaded
            cross_year_output = self.cross_year_pass(self.output_sets[0])
            self.output_sets.append(cross_year_output)
        # If the conditions for a second pass are not met
        # fall back to our typical process and enforce the match rate threshold
        else:
            self.enforce_match_threshold()

        self.upload_artifact(artifact.MATCH_RATES)

    def earthmover_run(self, results_path):
        """Compile and run Earthmover into the given results directory."""
        self.check_input_encoding()
        if self.input_sources["INPUT_FILE"]["is_plausible_non_utf8"]:
            encoding = str.lower(self.input_sources["INPUT_FILE"]["encoding"])
        else:
            encoding = None
        encoding_args = ["--set", "sources.input.encoding", encoding] if encoding else []
        if encoding:
            self.logger.info(f"using input encoding: {encoding}")

        fatal = False
        try:
            cmd = ["earthmover", "-c", self.wrapper_earthmover, "compile"]
            em = self.earthmover_cmd(args=cmd, capture_output=True, text=True)
            em.check_returncode()

            # attempt no. 1
            cmd = ["earthmover", "-c", self.wrapper_earthmover, "run", "--results-file", results_path]
            cmd.extend(encoding_args)
            em = self.earthmover_cmd(args=cmd, capture_output=True, text=True)
            em.check_returncode()

        except subprocess.CalledProcessError as err:
            self.logger.error("earthmover encountered an error")
            fatal = True

            #    yes it's brittle to check the error against a string like this, but this message hasn't
            # changed since 2007(!) -> https://github.com/python/cpython/blame/main/Objects/exceptions.c
            if err.stderr and "codec can't decode" in err.stderr and encoding != "iso-8859-1":
                self.logger.error(f"Failed to read file with {encoding} encoding. Retrying with Latin1...")
                try:
                    # attempt no. 2 - need a new em object to overwrite the decoding error
                    cmd = ["earthmover", "-c", self.wrapper_earthmover, "run", "--results-file", results_path, "--set", "sources.input.encoding", "iso-8859-1"]
                    em = self.earthmover_cmd(args=cmd, capture_output=True, text=True)
                    em.check_returncode()
                    
                    fatal = False # if we made it this far, we can abort the shutdown
                except subprocess.CalledProcessError:
                    # failed again, move on to shutdown procedure
                    pass

        if fatal:
            #    It is possible that Earthmover successfully matches students but then
            # fails during data transformation. This is most likely to happen when the user
            # uploads a file that is recognizable as the correct assessment but has some
            # other flaw - for example, the file is from the wrong year.
            # In this case. we end up with a match rates file, but we don't want to send it
            #  to the app. All the user needs to know is that the run failed.
            artifact.MATCH_RATES.needs_upload = False
            # Anyway, yeah, the run failed. Shut it down.
            self.error = error.EarthmoverRunError()
            # generic exception that will be caught, with em.stderr reported as the stacktrace
            raise Exception(em.stderr)

    def cross_year_pass(self, primary):
        """Run a second Earthmover pass on unmatched students using a cross-year roster in an attempt to match more students."""

        first_run_output_dir = os.path.abspath(config.OUTPUT_DIR_FIRST_RUN)
        os.rename(self.output_dir, first_run_output_dir)
        primary.local_dir = first_run_output_dir
        os.mkdir(self.output_dir)

        self.get_roster_from_edu(config.CROSS_YEAR_ROSTER_PATH)
        artifact.CROSS_YEAR_ROSTER.needs_upload = True
        self.upload_artifact(artifact.CROSS_YEAR_ROSTER)
        os.environ["EDFI_ROSTER_FILE"] = os.path.abspath(config.CROSS_YEAR_ROSTER_PATH)

        # If we hit the required match rate on the first pass, constrain to the ID column that won.
        # Otherwise, we run again and check against all ID types.
        # The bundle always appends studentUniqueId internally, so we pass an empty list when that's what won.
        if self.highest_match_rate >= config.REQUIRED_ID_MATCH_RATE:

            # use only the students who failed to match the primary ID from the first run
            unmatched_path = os.path.join(first_run_output_dir, os.path.basename(artifact.UNMATCHED_STUDENTS.path))
            os.environ["INPUT_FILE"] = unmatched_path
            self.input_sources["INPUT_FILE"]["path"] = unmatched_path
            
            # constrain this pass to use the IDs that matched best in the first pass
            first_run_id_name = self.highest_match_id_name
            first_run_id_type = self.highest_match_id_type

            os.environ["POSSIBLE_STUDENT_ID_COLUMNS"] = first_run_id_name
            os.environ["EDFI_STUDENT_ID_TYPES"] = (
                "" if first_run_id_type == "studentUniqueId" else first_run_id_type
            )
            # we already know which ID to use so we should succeed no matter how many failed matches remain
            os.environ["REQUIRED_ID_MATCH_RATE"] = "0.0"
            self.logger.info(f"cross-year pass: matching on {first_run_id_name} ({first_run_id_type} ID)")
        else:
            self.logger.info("cross-year pass: first pass below threshold, running again against all ID types")

        self.earthmover_run(artifact.EM_RESULTS_X_YEAR.path)
        artifact.EM_RESULTS_X_YEAR.needs_upload = True
        self.upload_artifact(artifact.EM_RESULTS_X_YEAR)
        # Record our new second pass match rate.
        # If we don't meet the threshold, halt!
        self.record_highest_match_rate()
        self.enforce_match_threshold()

        self.logger.info(f"cross-year pass: match_rates: {load_match_rates()}")
        count = count_unmatched_students()
        if count is None:
            #    Edge case alert! It may be that in the second pass, there are no matches even with the
            # expanded universe of students. Of course we need to return these rows to the user and tell
            # them how many records failed to match. However, with no matches, our usual method of counting
            # via the match rates file breaks down, because that file is now empty. So here we are saying
            # "if there were no matches on the second pass, use the number of unmatched from the first pass"
            self.logger.warning("cross-year pass: no additional matches. Falling back to original unmatched students file")
            count =  self.num_unmatched_students
        else:
            self.logger.warning(f"cross-year pass: {count} unmatched students remain")
    
        # then, in either case, we do the usual thing: upload the unmatched students file if and only if 
        # there are unmatched students
        self.num_unmatched_students = count

        return OutputSet(
            local_dir=self.output_dir,
            s3_subdir="non-ods",
            sent_to_ods=False,
            em_results_path=artifact.EM_RESULTS_X_YEAR.path,
        )

    def check_input_encoding(self):
        """Determine whether assessment file should be loaded with a non-UTF-8 encoding"""
        #    right now we only support encoding changes on the primary input file,
        # which is called "input" in Runway-ready bundles. In order to modify the
        # encodings of other files, we would have to know their name inside earthmover.yaml,
        # which for now we are not going to attempt to do.
        detector = UniversalDetector()
        start = time.monotonic()
        for line in open(self.input_sources["INPUT_FILE"]["path"], 'rb'):
            detector.feed(line)
            if detector.done:
                break
            elif time.monotonic() - start > config.MAX_ENCODING_DETECTION_SECONDS:
                self.logger.warning(f"Encoding detection timed out after {config.MAX_ENCODING_DETECTION_SECONDS} seconds - defaulting to UTF-8")
                break
        chardet_runtime = time.monotonic() - start
        result = detector.close()
        self.input_sources["INPUT_FILE"]["encoding"] = result["encoding"]
        self.input_sources["INPUT_FILE"]["is_plausible_non_utf8"] = result["encoding"] in config.PLAUSIBLE_NON_UTF8_ENCODINGS

        self.logger.info(f"encoding detected for input file: {self.input_sources['INPUT_FILE']['encoding']}")
        self.logger.debug(f"encoding detection ran for {chardet_runtime} seconds")

    def unpack_id_types(self):
        """Use descriptors that exist in the roster to help the user assign IDs to unmatched students
        
            In theory, there are several types of student IDs in an Ed-Fi roster. If there are students
        in the assessment file with a mismatched ID, we want to indicate to the user which type of ID
        they need to look up in order to fix the file (eg State vs. Local). One thing this function does
        is gather all of the ID types that exist in the roster so that Runway can report this kind of 
        information to the user.
        
        In addition, it is likely that one of these "natural" IDs is replicated in Ed-Fi's 
        studentUniqueId, which is more of a surrogate ID. Because the user is unlikely to know that, say, 
        studentUniqueId is the same as State ID in their ODS, we want to avoid cases where we report 
        studentUniqueId as the highest-matching ID column. Thus, the other thing this function does is
        flag whether there is such a replication so that Runway knows which ID type to report to the user
        even when it is not used for ID crosswalking directly.
        """
        roster_records = []
        with open(artifact.ROSTER.path, 'r', encoding='utf-8') as f:
            for line in f:
                roster_records.append(json.loads(line.strip()))

        id_types = {}
        for record in roster_records:
            try:
                for id_code in record["studentIdentificationCodes"]:
                    # a given roster record may have several ID descriptors with different values
                    # using split()[-1] here because it's possible for these ID types to have a full descriptor URI, and also for them to be bare
                    id_type = id_code["studentIdentificationSystemDescriptor"].split("#")[-1]
                    if id_type not in id_types:
                        id_types[id_type] = {
                            "stu_id_matches": 0,
                            "non_nulls": 0
                        }
                    if str(id_code["identificationCode"]) == str(record["studentReference"]["studentUniqueId"]):
                        id_types[id_type]["stu_id_matches"] += 1
                    if id_code["identificationCode"]:
                        id_types[id_type]["non_nulls"] += 1
            except KeyError:
                # any malformed or incomplete stu-ed-org record doesn't need to be counted for this
                pass

        # first thing's done - we know all types of IDs represented in the roster
        self.distinct_id_types = set(id_types.keys())
        logging.info(f"distinct_id_types: {self.distinct_id_types}")

        # now we check for sufficient overlap between these IDs and studentUniqueId
        not_null_threshold = 0.5
        too_many_nulls_ids = []
        for t in id_types.keys():
            # what fraction of all the records have this ID?
            id_types[t]["pct_non_nulls"] = id_types[t]["non_nulls"] / len(roster_records)
            if id_types[t]["pct_non_nulls"] < not_null_threshold:
                too_many_nulls_ids.append(t)
            else:
                # of the records that have this ID, what fraction of the ID's values match
                id_types[t]["pct_matches"] = id_types[t]["stu_id_matches"] / id_types[t]["non_nulls"]

        for t in too_many_nulls_ids:
            del id_types[t]

        #    In theory, you could have an ID with a greater number of matches but a lower percentage.
        # We opt to prefer an ID that is a tighter fit, even if it not as well represented in the roster
        # since it is more likely to be the true source of studentUniqueId. In practice, it is highly
        # unlikely that you would have, say, an 95% matching ID as well as a 92% matching one, but this
        # is the theoretical basis
        if len(id_types) == 0:
            #    this can happen if the roster is particularly bare-bones; in that case we're banking on
            # studentUniqueId being a match, but the below code will not work
            # TODO: oh but could it be more efficient?
            self.stu_unique_id_in_roster = None
            return

        highest_match_type = max(id_types, key=lambda outer_key: id_types[outer_key]['pct_matches'])
        highest_match_rate = id_types[highest_match_type]["pct_matches"]

        match_threshold = 0.95
        if highest_match_rate >= match_threshold:
            #    since we have a match between an "actual" ID type and studentUniqueId, we'll use
            # studentUniqueId for the crosswalk but keep the actual ID on hand for user-facing
            # messaging
            self.stu_unique_id_in_roster = highest_match_type
            self.distinct_id_types.remove(highest_match_type)
            self.logger.info(f"Ed-Fi ID {highest_match_type} matches studentUniqueId ({highest_match_rate * 100}% of non-null records match)")
        else:
            self.stu_unique_id_in_roster = None

    def record_highest_match_rate(self):
        """Read the match rates file to determine which ID was the best match and how many student IDs failed to match it"""
        #    Let's make one thing very clear: There is an unmatched students file and a match rates file.
        # The unmatched students file is like the input file, filtered for any records that do not match the
        # **primary** ID used. e.g. If 6/10 of the input records match a state ID and 2/10 others match a
        # local ID, then the 4/10 without matching state IDs go in the unmatched students file, but both types
        # of match are recorded in the match rates file. Both are used for different purposes by the app and
        # within the exeuctor
        #    Why do we use the match rates file to count unmatched students? Because the unmatched students file
        # may have multiple header rows, so it's hard to use it for counting:
        # ref: https://github.com/edanalytics/runway/pull/6

        # in the case of literally zero matches (or a failed run), the file is empty and these defaults remain
        self.highest_match_rate = 0.0
        self.highest_match_id_name = "N/A"
        self.highest_match_id_type = "N/A"
        # we set this to distinguish from the case where the run succeeded and num_unmatched_students is 0.
        # If this value is not properly set then enforce_match_threshold fails, as intended
        self.num_unmatched_students = None

        match_rates = load_match_rates()
        if len(match_rates) == 0:
            # either
            #   - Earthmover failed and so we don't report unmatched students
            #   - OR no students matched, which in the first pass means we've hit a more fundamental error
            # in both cases we usually have already exited out of the run prior to now, but we retain
            # this as a guardrail
            return

        self.logger.info(f"at least some records matched - match rates by ID: {match_rates}")
        highest_match = sorted(match_rates, reverse=True, key=lambda mr: float(mr['match_rate']))[0]
        self.highest_match_rate = float(highest_match["match_rate"])
        self.highest_match_id_name = highest_match["source_column_name"]
        self.highest_match_id_type = highest_match["edfi_column_name"]
        self.num_unmatched_students = int(highest_match["num_rows"]) - int(highest_match["num_matches"])

        if self.num_unmatched_students == 0:
            self.logger.debug("all input records matched")

    def enforce_match_threshold(self):
        """Halt if the primary Earthmover run's best match rate is below the configured threshold"""
        if self.num_unmatched_students == 0:
            return
        if self.highest_match_rate >= config.REQUIRED_ID_MATCH_RATE:
            return

        self.error = error.InsufficientMatchesError(
            self.highest_match_rate, config.REQUIRED_ID_MATCH_RATE,
            self.highest_match_id_name, self.highest_match_id_type,
        )
        # For now, since we're asking the user to revisit their entire file, it's simpler
        # if we don't return the unmatched students file at all
        self.logger.debug("too many unmatched students. Halting run")
        raise ValueError(f"insufficient ID matches to continue (highest rate {self.highest_match_rate} < required {config.REQUIRED_ID_MATCH_RATE}; ID column name: {self.highest_match_id_name}; Ed-Fi ID type: {self.highest_match_id_type})")

    def report_unmatched_students(self):
        """At the end of a successful run, alert the app to any unmatched students that remain after all Earthmover passes.
        """
        if self.num_unmatched_students == 0:
            return

        self.logger.warning('earthmover run failed to match some student IDs')

        # if an "actual" ID is replicated as studentUniqueId, we should send the actual ID to the user
        id_type_to_report = self.highest_match_id_type
        if self.highest_match_id_type == "studentUniqueId" and self.stu_unique_id_in_roster:
            id_type_to_report = self.stu_unique_id_in_roster

        # additional context so the app can help the user fix their file
        # in this case, num_unmatched_students is guaranteed to be an int instead of None
        self.send_id_matches(self.highest_match_id_name, id_type_to_report, self.num_unmatched_students)
        artifact.UNMATCHED_STUDENTS.needs_upload = True
        self.upload_artifact(artifact.UNMATCHED_STUDENTS)

    def lightbeam_send(self):
        """Upload an Earthmover output set to the ODS via lightbeam."""

        if not self.send_to_ods:
            return

        self.set_action(action.LIGHTBEAM_SEND)
        # If we ran Earthmover twice, we're only ever sending the first output set
        os.environ["DATA_DIR"] = self.output_sets[0].local_dir
        try:
            lb = subprocess.run(
                ["lightbeam", "-c", self.assessment_lightbeam, "send", "--results-file", artifact.LB_SEND_RESULTS.path]
            )
            if lb.stdout:
                self.logger.info(f"lightbeam stdout: {lb.stdout}")
            if lb.stderr:
                self.logger.info(f"lightbeam stderr: {lb.stderr}")
            lb.check_returncode()

        except subprocess.CalledProcessError:
            self.error = error.LightbeamSendError(lb.stderr)

        self.upload_artifact(artifact.LB_SEND_RESULTS)

        # place an additional guardrail around the case when everything fails to send,
        # likely due to a descriptor or namespace issue. We don't want to continue forward in that case
        with open(artifact.LB_SEND_RESULTS.path) as f:
            send_results = json.load(f)["resources"]

        all_failed = all(
            counts.get("records_processed", 0) == counts.get("records_failed", 0)
            for counts in send_results.values()
        )
        if all_failed:
            self.error = error.LightbeamSendError()
            raise ValueError("all output data failed to send")

    def compile_summary(self):
        """Send per-resource records-processed/skipped/failed counts to the app."""
        summary = {}
        for set in self.output_sets:
            for resource, counts in set.counts().items():
                if resource not in summary:
                    summary[resource] = {
                        "records_processed": 0,
                        "records_skipped": 0,
                        "records_failed": 0,
                    }
                for k in summary[resource]:
                    summary[resource][k] += counts.get(k, 0)

        if summary:
            self.summary = summary
            self.send_job_summary()

    def upload_output(self):
        """Upload each Earthmover output set to S3 and notify the app of its location."""
        self.set_action(action.UPLOAD_OUTPUT)
        for set in self.output_sets:
            self.upload_output_set(set)

    def upload_output_set(self, output_set):
        """Upload all non-empty JSONL files in one OutputSet's local_dir to its S3 subdir, then alert the app."""
        s3_prefix = f"{self.s3_out_path}/{output_set.s3_subdir}"
        uploaded = False
        for fname in os.listdir(output_set.local_dir):
            if not fname.endswith(".jsonl"):
                continue
            fpath = os.path.join(output_set.local_dir, fname)
            if not os.path.isfile(fpath) or os.stat(fpath).st_size == 0:
                continue

            dest_fname = f"{s3_prefix}/{fname}"
            self.logger.info(f"uploading output: {fname} -> {dest_fname}")
            try:
                self.s3.upload_file(fpath, self.app_bucket, dest_fname)
            except botocore.exceptions.ClientError:
                self.error = error.ArtifactS3UploadError(fname, dest_fname)
                raise
            uploaded = True

        if not uploaded:
            self.logger.warning(f"no Earthmover output files found in {output_set.local_dir} to upload")
            return

        self.send_job_output_alert(s3_prefix, output_set.sent_to_ods)

    def upload_remaining_artifacts(self):
        """Attempt to upload all artifacts that have not yet been uploaded"""
        self.logger.info("uploading remaining artifacts")
        for a in artifact.ALL:
            if a.needs_upload:
                self.upload_artifact(a, fail_ok=True)

    def upload_artifact(self, artifact_to_upload, fail_ok=False):
        """Upload one of the executor's artifacts to S3"""
        self.logger.debug(f"uploading artifact {artifact_to_upload.name}")
        fpath = artifact_to_upload.path

        if not os.path.exists(fpath):
            if fail_ok:
                self.logger.debug(f"file not found during shutdown. continuing...")
                return
            self.error = error.ArtifactNotFoundError(artifact_to_upload.name, fpath)
            raise FileNotFoundError(fpath)
        elif not os.stat(fpath).st_size > 0:
            if fail_ok:
                self.logger.debug(f"file empty during shutdown. continuing...")
                return
            self.error = error.ArtifactEmptyError(artifact_to_upload.name, fpath)
            raise FileNotFoundError(fpath)

        try:
            self.s3.upload_file(
                fpath, self.app_bucket, f"{self.s3_out_path}/{os.path.basename(fpath)}"
            )
        except botocore.exceptions.ClientError:
            if fail_ok:
                self.logger.debug(f"upload failed during shutdown. continuing...")
                return
            self.error = error.ArtifactS3UploadError(
                artifact_to_upload.name, f"{self.s3_out_path}/{os.path.basename(fpath)}"
            )
            raise

        artifact_to_upload.needs_upload = False

    def set_action(self, next_action):
        """Change the current action and mark the previous one as successful"""
        if self.action:
            self.update_success()
        self.action = next_action
        self.logger.info(f"beginning action: {next_action}")
        self.update_begin()

    def update_begin(self):
        """Send a message to the app indicating the beginning of an action"""
        self.send_update(self.action, status.BEGIN)

    def update_success(self):
        """Send a message to the app indicating the success of an action"""
        self.send_update(self.action, status.SUCCESS)
        # we do this so that we can change actions without necessarily logging success
        self.action = ""

    def send_update(self, action, status):
        """Send a message to the app indicating the beginning or conclusion of an action"""
        body = {"action": action, "status": status}
        # return the response in case the caller wants to do something with it
        return self.conn.post(self.status_url, json=body)

    def update_failure(self):
        """Send a message to the app indicating the failure of an action and wait for a success response"""
        attempt = 0
        max_attempts = 3
        while attempt < max_attempts:
            attempt += 1
            fail_resp = self.send_update(self.action, status.FAILURE)
            if fail_resp.status_code != 201:
                # Give the app a few chances to respond affirmatively. While there is no immediate risk
                # of the executor's error payload arriving before this failure message, we want to
                # establish that the failure message ought to arrive first and do our best to avoid a
                # potential race condition
                self.logger.debug(f"Failed to send final status update (attempt {attempt} of {max_attempts}): status {fail_resp.status_code}")
                if attempt < max_attempts:
                    time.sleep(attempt * 5)
            else:
                return

    def send_id_matches(self, id_name, id_type, count):
        self.logger.debug("Sending student ID match info")
        body = {"name": id_name, "type": id_type, "count": count}
        self.conn.post(self.matches_url, json=body)

    def send_error(self):
        """Send a diagnostic message to app after a fatal error"""
        self.logger.debug("Sending error report")
        self.conn.post(self.error_url, json=self.error.to_json())

    def send_job_summary(self):
        """Send a user-facing message to app indicating what data was produced"""
        self.logger.debug(f"Sending summary")
        self.conn.post(self.summary_url, json=self.summary)

    def send_job_output_alert(self, s3_prefix, sent_to_ods):
        """Notify the app that an Earthmover output set has been uploaded to S3"""
        self.logger.debug(f"Notifying app of output set at {s3_prefix}")
        self.conn.post(self.output_files_url, json={
            "sentToOds": sent_to_ods,
            "path": s3_prefix,
        })


def localize_s3_path(path):
    """Convert an S3 'path' to a single filename"""
    return path.replace("/", "__")


def load_match_rates():
    """Read the latest Earthmover run's match_rates.csv. Returns an empty list when the file is missing or has no data rows."""
    try:
        with open(artifact.MATCH_RATES.path) as f:
            return list(csv.DictReader(f, skipinitialspace=True))
    except FileNotFoundError:
        return []


def count_unmatched_students():
    """Number of unmatched students reported by the latest Earthmover run's match rates file

    Returns None when the match rates file is empty, signifying no matches or a failed run
    """
    rows = load_match_rates()
    if len(rows) == 0:
        return None
    return int(rows[0]["num_rows"]) - int(rows[0]["num_matches"])


def stream_to_file(session, url, dest_path, max_attempts=3):
    """GET url as a stream and write the body to dest_path"""
    for attempt in range(1, max_attempts + 1):
        try:
            with session.get(url, stream=True) as resp:
                resp.raise_for_status()
                with open(dest_path, "wb") as f:
                    for chunk in resp.iter_content(chunk_size=64 * 1024):
                        if chunk:
                            f.write(chunk)
            return
        except (requests.exceptions.ChunkedEncodingError,
                requests.exceptions.ConnectionError) as e:
            if attempt == max_attempts:
                raise
            sleep_seconds = attempt * 5
            print(f"stream_to_file: attempt {attempt}/{max_attempts} failed ({type(e).__name__}); retrying in {sleep_seconds}s")
            time.sleep(sleep_seconds)
