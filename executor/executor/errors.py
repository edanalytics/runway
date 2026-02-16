# Errors are how the executor structures diagnostic information in the event of a failure.
#
# Note that these are not intended to be raised as Python exceptions
#
# As the executor evolves, this list is likely to expand and deepen. Currently, a typical error includes a
# code and python stacktrace. The aim is for them to become more structured over time.

from copy import deepcopy

class ExecutorError:
    def __init__(self, code, stacktrace):
        self.code = code
        self.stacktrace = stacktrace
    
    def to_json(self):
        all_keys = deepcopy(vars(self))
        del all_keys["code"]
        return {"code": self.code, "payload": all_keys}

class UnknownError(ExecutorError):
    def __init__(self, stacktrace=None):
        super().__init__("unknown", stacktrace)

class ExecutorTimeout(ExecutorError):
    def __init__(self, timeout_seconds, stacktrace=None):
        super().__init__("executor_timeout", stacktrace)
        self.timeout_seconds = timeout_seconds

class InvalidJobError(ExecutorError):
    def __init__(self, message, stacktrace=None):
        super().__init__("invalid_job", stacktrace)
        self.message = message

class LightbeamFetchError(ExecutorError):
    def __init__(self, resource, stacktrace=None):
        super().__init__("lightbeam_fetch", stacktrace)
        self.resource = resource

class MissingOdsRosterError(ExecutorError):
    def __init__(self, stacktrace=None):
        super().__init__("missing_ods_roster", stacktrace)

class LightbeamSendError(ExecutorError):
    def __init__(self, stacktrace=None):
        super().__init__("lightbeam_send", stacktrace)

class InputS3DownloadError(ExecutorError):
    def __init__(self, name, path, stacktrace=None):
        super().__init__("input_s3_download", stacktrace)
        self.name = name
        self.path = path

class GitPullError(ExecutorError):
    def __init__(self, stacktrace=None):
        super().__init__("bundle_git_pull", stacktrace)

class ArtifactNotFoundError(ExecutorError):
    def __init__(self, name, path, stacktrace=None):
        super().__init__("artifact_not_found", stacktrace)
        self.name = name
        self.path = path

class ArtifactEmptyError(ExecutorError):
    def __init__(self, name, path, stacktrace=None):
        super().__init__("artifact_empty", stacktrace)
        self.name = name
        self.path = path

class ArtifactS3UploadError(ExecutorError):
    def __init__(self, name, path, stacktrace=None):
        super().__init__("artifact_s3_upload", stacktrace)
        self.name = name
        self.path = path

class EarthmoverDepsError(ExecutorError):
    def __init__(self, stacktrace=None):
        super().__init__("earthmover_deps", stacktrace)

class EarthmoverRunError(ExecutorError):
    def __init__(self, stacktrace=None):
        super().__init__("earthmover_run", stacktrace)

# TODO: these names... I prefer to keep them in terms of earthmover_ and not be too declarative
# Like if we say "input_file_error" I worry that ascribes too much certainty when we are not always certain
# could be easily swayed the other way though

# TODO: there's a potential for a hierarchy of errors here but I don't think it buys us anything
class EarthmoverWrongFileError(ExecutorError):
    def __init__(self, stacktrace=None):
        super().__init__("earthmover_txt", stacktrace)
class EarthmoverExcelFileError(ExecutorError):
    def __init__(self, stacktrace=None):
        super().__init__("earthmover_excel", stacktrace)

class EarthmoverTxtFileError(ExecutorError):
    def __init__(self, stacktrace=None):
        super().__init__("earthmover_txt", stacktrace)

class EarthmoverMissingColspecError(ExecutorError):
    def __init__(self, stacktrace=None):
        super().__init__("earthmover_colspec", stacktrace)

class EarthmoverDateFormatError(ExecutorError):
    def __init__(self, stacktrace=None):
        super().__init__("earthmover_date", stacktrace)

class InsufficientMatchesError(ExecutorError):
    def __init__(self, match_rate, match_threshold, id_name, id_type, stacktrace=None):
        self.match_rate = match_rate
        self.match_threshold = match_threshold
        self.id_name = id_name
        self.id_type = id_type
        super().__init__("insufficient_matches", stacktrace)