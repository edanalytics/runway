# An OutputSet describes one collection of Earthmover output files that a job
# produces and uploads to S3. Every job produces at least one output set, which
# may or may not be sent to the ODS. Jobs that perform cross-year matching produce
# two output sets.

import json


class OutputSet:
    def __init__(self, local_dir, s3_subdir, sent_to_ods, em_results_path, lb_send_results_path=None):
        # Local directory containing the output files Earthmover produced for this set.
        self.local_dir = local_dir
        # Subdirectory under the job's S3 output path that these files land in.
        # The app reads this to distinguish ODS-bound output from sideloaded output.
        self.s3_subdir = s3_subdir
        # Whether the records in this set were (or will be) sent to an ODS via lightbeam.
        self.sent_to_ods = sent_to_ods
        # Path to the Earthmover results JSON for the run that produced this set.
        self.em_results_path = em_results_path
        # Path to the lightbeam-send results JSON, if sent_to_ods
        self.lb_send_results_path = lb_send_results_path

    def counts(self):
        """Per-resource records-processed/skipped/failed counts contributed by this set.

        For ODS-bound sets, lightbeam's send-results are authoritative (they know
        what the ODS actually accepted). For sideloaded sets, Earthmover row counts
        are the best signal we have.
        """
        if self.sent_to_ods:
            with open(self.lb_send_results_path) as f:
                return json.load(f)["resources"]

        with open(self.em_results_path) as f:
            em_results = json.load(f)
        dest_prefix = "$destinations."
        return {
            key[len(dest_prefix):]: {"records_processed": count}
            for key, count in em_results.get("row_counts", {}).items()
            if key.startswith(dest_prefix)
        }
