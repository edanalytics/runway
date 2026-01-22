import csv
import json
import logging
from pprint import pprint
import os
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

handler = logging.StreamHandler()
_formatter = logging.Formatter(
    "%(asctime)s.%(msecs)03d %(name)s %(levelname)s %(message)s", "%Y-%m-%d %H:%M:%S"
)
handler.setFormatter(_formatter)


class JobExecutor:
    """Responsible for performing actions, producing artifacts, and reporting errors"""

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

        self.s3 = boto3.client("s3")
        self.local_mode = os.environ.get("DEPLOYMENT_MODE") == "LOCAL"
        self.conn = requests.Session()

        os.mkdir(os.path.abspath(config.OUTPUT_DIR))
        os.environ["DATA_DIR"] = os.path.abspath(config.OUTPUT_DIR)
        os.environ["OUTPUT_DIR"] = os.path.abspath(config.OUTPUT_DIR)

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

            if self.local_mode:
                self.modify_local_lightbeam()

            self.get_student_roster()
            self.get_input_files()

            self.map_descriptors()
            self.earthmover_run()

            self.lightbeam_send()

            self.compile_summary()

        # NOTE: all specific exceptions are handled in sub-methods
        except:
            # failure cases
            traceback.print_exc()
            self.upload_remaining_artifacts()

            self.update_failure()

            if not self.error:
                self.error = error.UnknownError(traceback.format_exc())
            if not self.error.stacktrace:
                self.error.stacktrace = traceback.format_exc()

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

            self.assessment_project = os.path.join(
                self.wrapper_project, "packages", *job["bundle"]["path"].split("/")[1:]
            )
            self.seeds_dir = os.path.join(
                self.assessment_project, "seeds"
            )
            self.assessment_lightbeam = os.path.join(
                self.assessment_project, "lightbeam.yaml"
            )

            # API_YEAR will be overwritten by the bundle metadata's env_var
            # config if necessary
            os.environ["API_YEAR"] = str(job["assessmentDatastore"]["apiYear"])
            os.environ["EDFI_API_BASE_URL"] = job["assessmentDatastore"]["url"]
            os.environ["EDFI_API_CLIENT_ID"] = job["assessmentDatastore"]["clientId"]
            os.environ["EDFI_API_CLIENT_SECRET"] = job["assessmentDatastore"]["clientSecret"]
            # remove the secret so we don't log it
            del job["assessmentDatastore"]["clientSecret"]

            os.environ["ASSESSMENT_BUNDLE"] = os.path.basename(job["bundle"]["path"])
            os.environ["ASSESSMENT_BUNDLE_BRANCH"] = job["bundle"]["branch"]

            self.app_bucket = parse.urlparse(job["appDataBasePath"]).hostname
            app_prefix = parse.urlparse(job["appDataBasePath"]).path.strip("/")
            self.s3_in_path = f"{app_prefix}/input"
            self.s3_out_path = f"{app_prefix}/output"

            self.input_sources = job["inputFiles"]

            self.descriptor_map = job["customDescriptorMappings"]

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

    def earthmover_deps(self):
        """Create the Earthmover runtime environment by installing bundle dependencies"""
        self.set_action(action.EARTHMOVER_DEPS)

        try:
            subprocess.run(
                ["earthmover", "-c", self.wrapper_earthmover, "deps"],
            ).check_returncode()
        except subprocess.CalledProcessError:
            self.error = error.EarthmoverDepsError()
            raise

    def modify_local_lightbeam(self):
        """Disable SSL checking in Lightbeam so that it can communicate with a locally-running ODS"""
        subprocess.run(
            ["sed", "-i", r"s/show_graph: False/show_graph: False\n  show_stacktrace: True/", self.assessment_project]
        )

        subprocess.run(
            ["sed", "-i", "s/verify_ssl: True/verify_ssl: False/", self.assessment_lightbeam]
        )

    def get_student_roster(self):
        """Download a list of students from the ODS so they can be used to match IDs"""
        self.set_action(action.GET_ROSTER)

        try:
            subprocess.run(
                ["lightbeam", "-c", self.assessment_lightbeam, "fetch", "-s", "studentEducationOrganizationAssociations", "-k", "studentIdentificationCodes,educationOrganizationReference,studentReference"]
            ).check_returncode()

            # $ mv output lb-download-dir
            # Because lightbeam uses the same directory for uploads and downloads,
            # we move the downloaded roster file to a separate location so that
            # it is not mixed in with the data that earthmover produces.
            # OUTPUT_DIR will be recreated by the Earthmover run
            os.rename(config.OUTPUT_DIR, config.LB_DOWNLOAD_DIR)

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

        self.upload_artifact(artifact.ROSTER)

    def get_input_files(self):
        """Download user-uploaded files from S3"""
        self.set_action(action.GET_FILES)

        self.input_paths = {}
        for env_name, path in self.input_sources.items():
            # if allow_fragments is True, paths containing a '#' are incorrectly split
            uri = parse.urlparse(path, allow_fragments=False)
            if uri.scheme == "file":
                os.environ[env_name] = uri.path
            # NOTE: for now this assumes S3
            else:
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

    def earthmover_run(self):
        """Run an Earthmover bundle to transform assessment data"""
        self.set_action(action.EARTHMOVER_RUN)

        self.unpack_id_types()
        os.environ["EDFI_STUDENT_ID_TYPES"] = ",".join(self.distinct_id_types)
        self.logger.info(f"Student ID types in Ed-Fi roster: {os.environ['EDFI_STUDENT_ID_TYPES']}")

        self.check_input_encoding()
        fatal = False

        try:
            encoding_mod = []
            if self.input_sources["INPUT_FILE"]["is_plausible_non_utf8"]:
                #    if chardet identified an encoding that we think is plausible, use it.
                # Otherwise, do nothing and default to UTF-8 for the first attempt
                encoding = str.lower(self.input_sources["INPUT_FILE"]["encoding"])
                self.logger.info(f"setting input encoding to {encoding}")
                encoding_mod.extend(["--set", "sources.input.encoding", encoding])

            subprocess.run(
                ["earthmover", "-c", self.wrapper_earthmover, "compile"]
            ).check_returncode()

            # attempt no. 1
            cmd = ["earthmover", "-c", self.wrapper_earthmover, "run", "--results-file", artifact.EM_RESULTS.path]
            cmd.extend(encoding_mod)
            em = subprocess.run(
                cmd,
                capture_output=True,
                text=True
            )

            if em.stdout:
                self.logger.info(f"earthmover stdout: {em.stdout}")
            if em.stderr:
                self.logger.info(f"earthmover stderr: {em.stderr}")
            em.check_returncode()
        except subprocess.CalledProcessError as err:
            self.logger.warning("earthmover encountered an error")
            fatal = True

            #    yes it's brittle to check the error against a string like this, but this message hasn't
            # changed since 2007(!) -> https://github.com/python/cpython/blame/main/Objects/exceptions.c
            if err.stderr and "codec can't decode" in err.stderr and self.input_sources["INPUT_FILE"]["encoding"] != "ISO-8859-1":
                self.logger.error(f"Failed to read file with {self.input_sources['INPUT_FILE']['encoding']} encoding. Retrying with Latin1...")
                try:
                    # attempt no. 2
                    subprocess.run(
                        ["earthmover", "-c", self.wrapper_earthmover, "run", "--results-file", artifact.EM_RESULTS.path, "--set", "sources.input.encoding", "iso-8859-1"],
                    ).check_returncode()

                    fatal = False # if we made it this far, we can abort the shutdown
                except subprocess.CalledProcessError:
                    # failed again, move on to shutdown procedure
                    pass
        finally:
            #    the app relies on the presence of the unmatched students file but does not check
            # whether it is populated. It is possible that Earthmover successfully matches students
            # (so the file is empty) but then fails during data transformation. We need to check the
            # match rates whether or not Earthmover succeeds, so that we don't accidentally tell the
            # user there are unmatched students when there are none
            self.record_highest_match_rate()
            if fatal:
                # shut it down
                self.error = error.EarthmoverRunError()
                raise

        self.upload_artifact(artifact.EM_RESULTS)
        self.upload_artifact(artifact.MATCH_RATES)

        # If we reach this point, it's likely that the input file was basically compatible with the bundle
        self.report_unmatched_students()

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
                    id_type = id_code["studentIdentificationSystemDescriptor"].split("#")[1]
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
        #
        #    There are three circumstances under which we don't upload the unmatched students file and thus don't
        # show the "some students failed to match" message to the user. These are:
        #    1. Earthmover failed, so we don't know how many students matched
        #    2. The match rates file tells us that there is a perfect match, so there is nothing to upload
        #    3. The match rates file is empty, so there were no matches and the unmatched students file is the same as the original input

        # in the case of literally zero matches (or a failed run), the file is empty and these defaults remain
        self.highest_match_rate = 0.0
        self.highest_match_id_name = "N/A"
        self.highest_match_id_type = "N/A"
        # but if the file is empty, we don't learn this number. We need to distinguish between 0 and "don't know"
        self.num_unmatched_students = None

        try:
            with open(artifact.MATCH_RATES.path) as f:
                match_rates = [
                    {k: v for k, v in row.items()}
                    for row in csv.DictReader(f, skipinitialspace=True)
                ]
        except FileNotFoundError:
            # case 1
            self.logger.debug("failed Earthmover run. Skipping upload of unmatched students file")
            artifact.UNMATCHED_STUDENTS.needs_upload = False
            return

        if len(match_rates) > 0:
            self.logger.info(f"at least some records matched - match rates by ID: {match_rates}")

            highest_match = sorted(match_rates, reverse=True, key=lambda mr: float(mr['match_rate']))[0]
            self.highest_match_rate = float(highest_match["match_rate"])
            self.highest_match_id_name = highest_match["source_column_name"]
            self.highest_match_id_type = highest_match["edfi_column_name"]
            self.num_unmatched_students = int(highest_match["num_rows"]) - int(highest_match["num_matches"])

            if self.num_unmatched_students == 0:
                # case 2
                self.logger.debug("all records matched. Skipping upload of unmatched students file")
                artifact.UNMATCHED_STUDENTS.needs_upload = False
        else:
            # case 3
            self.logger.debug("no students matched any ID. Skipping upload of unmatched students file")
            artifact.UNMATCHED_STUDENTS.needs_upload = False

    def report_unmatched_students(self):
        """Alert the app to the existence of unmatched students (if any) and the best candidate for ID matching"""
        if self.num_unmatched_students == 0:
            return

        self.logger.warning('earthmover run failed to match some student IDs')

        if self.highest_match_rate >= config.REQUIRED_ID_MATCH_RATE:
            #    in this case, there are unmatched students but not so many that we doubt the
            # integrity of the file. Send the ones that match and give the rest back to the user
            # if an "actual" ID is replicated as studentUniqueId, we should send the actual ID to the user
            id_type_to_report = self.highest_match_id_type
            if self.highest_match_id_type == "studentUniqueId" and self.stu_unique_id_in_roster:
                id_type_to_report = self.stu_unique_id_in_roster

            # additional context so the app can help the user fix their file
            # in this case, num_unmatched_students is guaranteed to be an int instead of None
            self.send_id_matches(self.highest_match_id_name, id_type_to_report, self.num_unmatched_students)
            self.upload_artifact(artifact.UNMATCHED_STUDENTS)
        else:
            #    Insufficient matches. Assume the input file is no good Don't bother uploading anything.
            # Instead, alert the user with an error
            self.error = error.InsufficientMatchesError(self.highest_match_rate, config.REQUIRED_ID_MATCH_RATE, self.highest_match_id_name, self.highest_match_id_type)
            #    For now, since we're asking the user to revisit their entire file, it's simpler if we don't
            # return the unmatched students file at all
            self.logger.debug("too many unmatched students. Skipping upload")
            artifact.UNMATCHED_STUDENTS.needs_upload = False
            raise ValueError(f"insufficient ID matches to continue (highest rate {self.highest_match_rate} < required {config.REQUIRED_ID_MATCH_RATE}; ID column name: {self.highest_match_id_name}; Ed-Fi ID type: {self.highest_match_id_type})")

    def lightbeam_send(self):
        """Upload Earthmover's outputs to the ODS"""
        self.set_action(action.LIGHTBEAM_SEND)
        try:
            subprocess.run(
                ["lightbeam", "-c", self.assessment_lightbeam, "send", "--results-file", artifact.LB_SEND_RESULTS.path]
            ).check_returncode()

            # TODO: ostensibly should check for Ed-Fi warnings here but failed uploads still make it back via the summary report
        except subprocess.CalledProcessError:
            self.error = error.LightbeamSendError()

        self.upload_artifact(artifact.LB_SEND_RESULTS)

    def compile_summary(self):
        """Post results from lightbeam send to share with the user"""
        lb_send_results = {}
        with open(artifact.LB_SEND_RESULTS.path) as f:
            lb_send_results = json.load(f)

        required_counts = ["records_processed", "records_skipped", "records_failed"]
        for resource, counts in lb_send_results["resources"].items():
            # grab the counts we care about
            self.summary[resource] = {
                key: val for key, val in counts.items() if key in required_counts
            }
        
        if self.summary:
            self.send_summary()

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
            self.error_obj = error.ArtifactEmptyError(artifact_to_upload.name, fpath)
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
                artifact_to_upload, f"{self.bucket_out_path}/{os.path.basename(fpath)}"
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

    def send_summary(self):
        """Send a user-facing message to app indicating what data was loaded"""
        self.logger.debug("Sending `lightbeam send` summary")
        self.conn.post(self.summary_url, json=self.summary)


def localize_s3_path(path):
    """Convert an S3 'path' to a single filename"""
    return path.replace("/", "__")
