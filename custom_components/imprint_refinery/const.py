"""Integration identity, hardware defaults, and internal error identifiers."""

DOMAIN = "imprint_refinery"
HUB_ENTRY_DATA = {"hub": True}
HUB_TITLE = "Imprint Refinery"
EMITTER_SUBENTRY_TYPE = "emitter"
SIGNAL_REGISTRY_UPDATED = f"{DOMAIN}_registry_updated"

# Home Assistant config-entry keys follow Home Assistant/ZHA terminology.
CONF_IEEE = "ieee"
CONF_DRIVER = "driver"
CONF_TRANSPORT = "transport"
CONF_ENDPOINT_ID = "endpoint_id"
CONF_CLUSTER_ID = "cluster_id"
CONF_DEVICE = "device"
CONF_CAPTURE_TIMEOUT = "capture_timeout"
CONF_CAPTURE_REASSERT_INTERVAL = "capture_reassert_interval"

# Hardware transports. The library stores raw timings; adapters own any
# integration- or vendor-specific conversion.
HOME_ASSISTANT_IR = "home_assistant_ir"
ZHA_BRIDGE = "zha_bridge"

DEFAULT_ENDPOINT_ID = 1
DEFAULT_CLUSTER_ID = 0xE004
DEFAULT_CAPTURE_TIMEOUT = 60
DEFAULT_CAPTURE_REASSERT_INTERVAL = 8

# Stable machine-readable failures. These are intentionally terse translation keys.
ERROR_CATALOG_UNAVAILABLE = "catalog_unavailable"
ERROR_CLUSTER_NOT_FOUND = "cluster_not_found"
ERROR_CODE_EMPTY = "code_empty"
ERROR_CODE_INVALID = "code_invalid"
ERROR_COMMAND_EXPIRED = "command_expired"
ERROR_COMMAND_NOT_FOUND = "command_not_found"
ERROR_QUEUE_STOPPED = "queue_stopped"
ERROR_GUIDED_SESSION = "guided_session_error"
ERROR_CAPTURE_FAILED = "capture_failed"
ERROR_CAPTURE_TIMEOUT = "capture_timeout"
ERROR_QUEUE_FULL = "queue_full"
ERROR_SEND_FAILED = "send_failed"
ERROR_STORAGE_ERROR = "storage_error"
ERROR_EMITTER_NOT_CONFIGURED = "emitter_not_configured"
ERROR_EMITTER_REQUIRED = "emitter_required"
ERROR_EMITTER_UNAVAILABLE = "emitter_unavailable"
ERROR_UNEXPECTED = "unexpected_error"
ERROR_UNKNOWN_DRIVER = "unknown_driver"
ERROR_ZHA_DEVICE_NOT_FOUND = "zha_device_not_found"
ERROR_ZHA_UNAVAILABLE = "zha_unavailable"
