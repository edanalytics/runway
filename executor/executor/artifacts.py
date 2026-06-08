# Artifacts represent the files produced by the executor during the normal course of operations.
#
# For now, all of these artifacts are "mandatory" and considered part of the executor's core logic.
# In the future, some artifacts may be optional or only conditonally required, depending on external circumstances. 

import os

import executor.config as config

class JobArtifact:
    def __init__(self, name, path, needs_upload=True):
        self.name = name
        self.path = path
        self.needs_upload = needs_upload


ROSTER = JobArtifact(
    "edfi_roster",
    os.path.abspath(os.path.join(config.ROSTER_DOWNLOAD_DIR, "studentEducationOrganizationAssociations.jsonl"),)
)
# Only populated when the cross-year matching pass runs and fetches a roster from EDU.
CROSS_YEAR_ROSTER = JobArtifact(
    "cross_year_roster",
    os.path.abspath(config.CROSS_YEAR_ROSTER_PATH),
    False
)
EM_RESULTS = JobArtifact(
    "earthmover_results",
    "em-results.json"
)
# Only generated when earthmover runs for a second time as part of cross-year ID matching.
# If a cross-year match is performed as part of a sideload-only job, EM_RESULTS is used alone
EM_RESULTS_X_YEAR = JobArtifact(
    "earthmover_results_x_year",
    "em-results-x-year.json",
    False
)
MATCH_RATES = JobArtifact(
    "student_id_match_rates",
    os.path.join(config.OUTPUT_DIR, ("student_id_match_rates.csv")),
)
# Uploading the unmatched students file impacts the UX; we must be careful to only do so
# in the event of an otherwise successful run that has a tolerable number of unmatched input records
UNMATCHED_STUDENTS = JobArtifact(
    "unmatched_students",
    os.path.join(config.OUTPUT_DIR, "input_no_student_id_match.csv"),
    False
)
LB_SEND_RESULTS = JobArtifact(
    "lightbeam_send_results",
    "lb-send-results.json"
)

ALL = [ROSTER, CROSS_YEAR_ROSTER, EM_RESULTS, EM_RESULTS_X_YEAR, MATCH_RATES, UNMATCHED_STUDENTS, LB_SEND_RESULTS]