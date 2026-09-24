"""Canonical public vocabulary for Imprint Refinery 0.1."""


class Actions:
    """Home Assistant service names chosen for the independent product."""

    CREATE_COMMAND = "create_command"
    CREATE_APPLIANCE = "create_appliance"
    CREATE_REMOTE_PROFILE = "create_remote_profile"
    DUPLICATE_COMMAND = "duplicate_command"
    DUPLICATE_REMOTE_PROFILE = "duplicate_remote_profile"
    ANALYZE_SIGNAL = "analyze_signal"
    CONVERT_SIGNAL = "convert_signal"
    GUIDED_ANSWER = "catalog_guided_answer"
    GUIDED_CONTROL = "catalog_guided_control"
    GUIDED_START = "catalog_guided_start"
    GUIDED_TEST = "catalog_guided_test"
    MATCH_CATALOG_SIGNAL = "catalog_match_signal"
    GET_CATALOG_PROFILE = "catalog_profile"
    SEARCH_CATALOG = "catalog_search"
    CANCEL_CAPTURE = "cancel_capture"
    REMOVE_COMMAND = "remove_command"
    REMOVE_APPLIANCE = "remove_appliance"
    REMOVE_REMOTE_PROFILE = "remove_remote_profile"
    ENCODE_SIGNAL = "encode_signal"
    EXPORT_BACKUP = "export_backup"
    EXPORT_PROFILE = "export_profile"
    REBUILD_SIGNAL = "rebuild_signal"
    COMMAND_HISTORY = "command_history"
    INSPECT_IMPORT = "inspect_import"
    IMPORT_BACKUP = "import_backup"
    IMPORT_COMMAND_BACKUP = "import_command_backup"
    CAPTURE_SIGNAL = "capture_signal"
    GET_LIBRARY = "get_library"
    MOVE_COMMAND = "move_command"
    RENAME_COMMAND = "rename_command"
    RESTORE_REVISION = "restore_revision"
    STORE_COMMAND = "store_command"
    SEND_COMMAND = "send_command"
    LABEL_REVISION = "label_revision"
    SEND_SIGNAL = "send_signal"
    UPDATE_COMMAND = "update_command"
    UPDATE_APPLIANCE = "update_appliance"
    UPDATE_REMOTE_PROFILE = "update_remote_profile"


class Fields:
    """Service request keys; installation storage is deliberately separate."""

    BITS = "bits"
    BRAND = "brand"
    CANDIDATE = "candidate_id"
    CARRIER_FREQUENCY = "carrier_frequency"
    CATEGORY = "category"
    CODE = "code"
    COMMAND = "command"
    COMMAND_ID = "command_id"
    CONFIRM = "confirm"
    ADDRESS = "address"
    EXTENDED = "extended"
    ROLE = "role"
    FORMAT = "format"
    ICON = "icon"
    INCLUDE_HISTORY = "include_history"
    APPLIANCE_ID = "appliance_id"
    AREA_ID = "area_id"
    LABEL = "label"
    LIMIT = "limit"
    MODEL = "model"
    NAME = "name"
    OUTPUT_FORMAT = "output_format"
    PAYLOAD = "payload"
    POLL_INTERVAL = "poll_interval"
    PREFERRED_PLATFORM = "preferred_platform"
    CATALOG_PROFILE_ID = "catalog_profile_id"
    REMOTE_PROFILE_ID = "remote_profile_id"
    PROTOCOL = "protocol"
    REPEATS = "repeats"
    REBUILD_ID = "rebuild_id"
    RESULT = "result"
    REVISION_ID = "revision_id"
    SESSION_ACTION = "session_action"
    SESSION_ID = "session_id"
    SOURCE = "source"
    TARGET_REMOTE_PROFILE_ID = "target_remote_profile_id"
    TARGET_COMMAND_ID = "target_command_id"
    TIMEOUT = "timeout"
    TIMINGS = "timings"
    INFRARED_EMITTER_REF = "infrared_emitter_ref"
    INFRARED_RECEIVER_REF = "infrared_receiver_ref"
    APPLIANCE_TYPE = "appliance_type"


class States:
    """Request-local panel and transport states."""

    IDLE = "idle"
    CAPTURING = "capturing"
    SENDING = "sending"
    CAPTURE_READY = "capture_ready"
    SENT_UNCONFIRMED = "sent_unconfirmed"
    ERROR = "error"


SIGNAL_ROLES = (
    "power_toggle",
    "power_on",
    "power_off",
    "play_pause_toggle",
    "play",
    "pause",
    "stop",
    "previous",
    "next",
    "rewind",
    "fast_forward",
    "volume_down",
    "volume_up",
    "mute_toggle",
    "mute",
    "unmute",
    "source",
)

AUTOMATIC_PLATFORM = "auto"
PLATFORM_PREFERENCES = (AUTOMATIC_PLATFORM, "remote", "media_player", "switch")
