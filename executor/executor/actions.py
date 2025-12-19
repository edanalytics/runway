# Actions with statuses to specify the executor's state
#
# For now, all of these actions are "mandatory" and considered part of the executor's core logic.
# In the future, some actions may be optional or only conditonally required, depending on external circumstances. 

BUNDLE_REFRESH = "refresh_bundle_code"
GET_ROSTER = "get_student_roster"
GET_FILES = "get_input_files"
EARTHMOVER_DEPS = "earthmover_deps"
EARTHMOVER_RUN = "earthmover_run"
LIGHTBEAM_SEND = "lightbeam_send"
DONE = "done"