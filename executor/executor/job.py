import os
from dataclasses import dataclass, field
from pprint import pprint
from urllib import parse
from logging import Logger
import executor.artifacts as artifact
import executor.errors as error

@dataclass(frozen=True)
class Job:
    '''Class that unpacks and returns a Job object that holds all the information about a Job received from the app.'''

    status_url: str
    error_url: str
    matches_url: str
    summary_url: str
    output_files_url: str
    idrs_url: str
    student_match_results_url: str
    id_matching_mode: str
    send_to_ods: bool
    cross_year_match_available: bool
    assessment_project: str
    seeds_dir: str
    assessment_lightbeam: str
    app_bucket: str
    s3_in_path: str
    s3_out_path: str
    input_sources: list[str]
    descriptor_map: dict
    roster_file_path: str | None = None
    cross_year_roster_url: str | None = None
    
    @classmethod
    def create_job(cls, job: dict, executor, logger: Logger):
        '''method to handle reading the job payload from the app. Sets env vars and returns a Job object'''
        cls.set_env_vars(job)
        new_job = cls.unpack_job(job, executor, logger)

        return new_job
    
    @staticmethod
    def set_env_vars(job: dict) -> None:
            
        if job.get("sendToOds", True):
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
        
        # note that API_YEAR is guaranteed to be included in this
        for env_name, value in job["inputParams"].items():
            os.environ[env_name] = str(value)
        os.environ["ASSESSMENT_BUNDLE"] = os.path.basename(job["bundle"]["path"])
        os.environ["ASSESSMENT_BUNDLE_BRANCH"] = job["bundle"]["branch"]
    
    @classmethod
    def unpack_job(cls, job: dict, executor, logger: Logger) -> 'Job':
        """Parse the job definition received from the app"""

        job_dict = {}
        # basic unpacking
        try:
            job_dict['status_url'] = job["appUrls"]["status"]
            job_dict['error_url'] = job["appUrls"]["error"]
            job_dict['matches_url'] = job["appUrls"]["unmatchedIds"]
            job_dict['summary_url'] = job["appUrls"]["summary"]
            job_dict['output_files_url'] = job["appUrls"]["outputFiles"]
            job_dict['idrs_url'] = job.get("appUrls", {}).get("identityService", '')
            job_dict['student_match_results_url'] = job.get("appUrls", {}).get("studentMatchResults", '')
            job_dict['id_matching_mode'] = job.get("idMatchingMode", "id_based")
            job_dict['send_to_ods'] = job.get("sendToOds", True)
            job_dict['cross_year_match_available'] = job.get("crossYearMatchAvailable", False)
            
            if job_dict['cross_year_match_available']:
                job_dict['cross_year_roster_url'] = job["appUrls"]["roster"]

            job_dict['assessment_project'] = os.path.join(executor.student_id_wrapper_project, "packages", *job["bundle"]["path"].split("/")[1:])
            job_dict['seeds_dir'] = os.path.join(job_dict['assessment_project'], "seeds")
            job_dict['assessment_lightbeam'] = os.path.join(job_dict['assessment_project'], "lightbeam.yaml")

            if not job_dict['send_to_ods']:
                logger.info("this job is not sending Earthmover output set to an ODS")
                artifact.LB_SEND_RESULTS.needs_upload = False
                if not job_dict['cross_year_match_available']:
                    # If bypassing the ODS and not pulling from EDU, require that a roster file exists in S3
                    job_dict['roster_file_path'] = job["rosterFilePath"]

            app_base_uri = parse.urlparse(job["appDataBasePath"])
            job_dict['app_bucket'] = app_base_uri.hostname
            app_prefix = app_base_uri.path.strip("/")
            job_dict['s3_in_path'] = f"{app_prefix}/input"
            job_dict['s3_out_path'] = f"{app_prefix}/output"
            job_dict['input_sources'] = job["inputFiles"]
            job_dict['descriptor_map'] = job["customDescriptorMappings"]

        except KeyError as e:
            executor.error = error.InvalidJobError(f"job is missing required value: {e}")
            raise

        # semantic validation
        if "INPUT_FILE" not in job_dict['input_sources']:
            err_message = "job.inputFiles must include an INPUT_FILE item"
            executor.error = error.InvalidJobError(err_message)
            raise ValueError(err_message)
        pprint(job)

        return cls(**job_dict)