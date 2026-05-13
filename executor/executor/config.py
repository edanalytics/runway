BUNDLE_DIR = 'bundles'
OUTPUT_DIR = 'output'
OUTPUT_DIR_FIRST_RUN = 'output-first-run' # TODO:
ROSTER_DOWNLOAD_DIR = 'roster-download-dir'
CROSS_YEAR_ROSTER_PATH = 'cross_year_roster.jsonl'

REQUIRED_ID_MATCH_RATE = 0.5
STUDENT_ASSESSMENT_FAIL_THRESHOLD = 0.75

# set of alternate encodings we think are realistic for assessment files
# python has no UTF-16-SIG encoding, and chardet does not distinguish between UTF-16 BE and LE
PLAUSIBLE_NON_UTF8_ENCODINGS = ["UTF-8-SIG", "UTF-16", "ISO-8859-1", "Windows-1252"]
MAX_ENCODING_DETECTION_SECONDS = 300