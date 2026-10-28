# An OutputSet describes one collection of Earthmover output files that a job
# produces and uploads to S3. Every job produces at least one output set, which
# may or may not be sent to the ODS. Jobs that perform cross-year matching produce
# two output sets.

import json
import os


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
        what the ODS actually accepted). For sideloaded sets, we count the number of lines in each resource's corresponding jsonl output.
        """
        if self.sent_to_ods:
            with open(self.lb_send_results_path) as f:
                return json.load(f)["resources"]

        resources = {}
        # Earthmover produces a bunch of files; the summary must only contain
        # information about the data outputs, i.e. JSONL
        for dir_entry in os.scandir(self.local_dir):
            count = 0
            if not (dir_entry.is_file() and dir_entry.name.endswith(".jsonl")):
                continue
            with open(dir_entry.path) as file:
                for line in file:
                    count += 1 if line.strip() else 0
            name = dir_entry.name[:-len(".jsonl")]
            resources[name] = {"records_processed": count}
        return resources

    def has_output(self) -> bool:
        """Check whether an Output set has output to send. Returns a boolean. Used to determine whether lightbeam needs to run."""
        output_check = any(
            entry.is_file() and entry.name.endswith('.jsonl') and entry.stat().st_size > 0
            for entry in os.scandir(self.local_dir)
        )

        return output_check
    