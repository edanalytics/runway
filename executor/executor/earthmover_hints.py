# These messages may be found in Earthmover error logs. Given our already tight coupling to Earthmover, 
# it seems reasonable to use these as hints 

CODEC = "codec can't decode"

COLUMNS_MISSING = "One or more columns specified are not present in the dataset"
INPUT_VALIDATION = "Source `$sources.input` failed expectation"

DATE_FORMAT = "ValueError: time data"
EXCEL = "loading an Excel source requires additional"
TXT_FILE = "No `colspec_file` specified for fixedwidth source"

REGEX_COLUMNS = r"specified .* `columns` but has .* columns" # expecting that this be a number seems like overkill
REGEX_COLSPEC_FILE = r"colspec file .* not found"