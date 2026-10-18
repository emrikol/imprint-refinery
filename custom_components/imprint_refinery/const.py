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
ZHA_BRIDGE = "zha_bridge"

DEFAULT_ENDPOINT_ID = 1
DEFAULT_CLUSTER_ID = 0xE004
DEFAULT_CAPTURE_TIMEOUT = 60
DEFAULT_CAPTURE_REASSERT_INTERVAL = 8
# Core's receiver subscription has no readiness event. This margin lets the
# compatibility provider enter learning mode before the requested listening
# window consumes the outer service deadline.
CAPTURE_ARMING_GRACE_SECONDS = 5
# The panel deadline must end after the compatibility provider deadline. A
# signal found on the provider's final poll still needs time to cross the
# Core callback before the panel stops waiting.
CAPTURE_DELIVERY_GRACE_SECONDS = 10
# Learn start must succeed within this phase. A receiver that never accepts
# learn mode fails here with a clear error instead of consuming the whole
# listening window.
CAPTURE_ARMING_DEADLINE_SECONDS = 45

# Stable machine-readable failures. These are intentionally terse translation keys.
ERROR_CATALOG_UNAVAILABLE = "catalog_unavailable"
ERROR_CLUSTER_NOT_FOUND = "cluster_not_found"
ERROR_CODE_EMPTY = "code_empty"
ERROR_CODE_INVALID = "code_invalid"
ERROR_COMMAND_EXPIRED = "command_expired"
ERROR_COMMAND_NOT_FOUND = "command_not_found"
ERROR_GUIDED_SESSION = "guided_session_error"
ERROR_CAPTURE_FAILED = "capture_failed"
ERROR_CAPTURE_TIMEOUT = "capture_timeout"
ERROR_CAPTURE_UNREACHABLE = "capture_unreachable"
ERROR_SEND_FAILED = "send_failed"
ERROR_STORAGE_ERROR = "storage_error"
ERROR_EMITTER_NOT_CONFIGURED = "emitter_not_configured"
ERROR_EMITTER_REQUIRED = "emitter_required"
ERROR_UNEXPECTED = "unexpected_error"
ERROR_UNKNOWN_DRIVER = "unknown_driver"
ERROR_ZHA_DEVICE_NOT_FOUND = "zha_device_not_found"
ERROR_ZHA_UNAVAILABLE = "zha_unavailable"
