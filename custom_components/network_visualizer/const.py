"""Constants for Network Visualizer."""
DOMAIN = "network_visualizer"
PLATFORMS = ["sensor", "binary_sensor"]

CONF_ROUTER_HOST = "router_host"
CONF_ROUTER_PASSWORD = "router_password"
CONF_SCAN_INTERVAL = "scan_interval"

DEFAULT_SCAN_INTERVAL = 300  # 5 minutes
MIN_SCAN_INTERVAL = 60  # 1 minute
MAX_SCAN_INTERVAL = 3600  # 1 hour
