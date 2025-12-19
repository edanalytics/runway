# Artifacts represent the files produced by the executor during the normal course of operations.
#
# For now, all of these artifacts are "mandatory" and considered part of the executor's core logic.
# In the future, some artifacts may be optional or only conditonally required, depending on external circumstances. 

import os

import executor.config as config

class JobArtifact:
    def __init__(self, name, path):
        self.name = name
        self.path = path
        self.needs_upload = True


ROSTER = JobArtifact(
    "edfi_roster",
    os.path.abspath(os.path.join(config.LB_DOWNLOAD_DIR, "studentEducationOrganizationAssociations.jsonl"),)
)
EM_RESULTS = JobArtifact(
    "earthmover_results",
    "em-results.json"
)
MATCH_RATES = JobArtifact(
    "student_id_match_rates",
    os.path.join(config.OUTPUT_DIR, ("student_id_match_rates.csv")),
)
UNMATCHED_STUDENTS = JobArtifact(
    "unmatched_students",
    os.path.join(config.OUTPUT_DIR, "input_no_student_id_match.csv"),
)
LB_SEND_RESULTS = JobArtifact(
    "lightbeam_send_results",
    "lb-send-results.json"
)

ALL = [ROSTER, EM_RESULTS, MATCH_RATES, UNMATCHED_STUDENTS, LB_SEND_RESULTS]