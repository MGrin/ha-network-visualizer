import type { NodeType } from "./types";

export const CARD_VERSION = "0.1.0";

export const NODE_COLORS: Record<NodeType, string> = {
  internet: "#ffffff",
  router: "#00e5ff",
  mesh: "#00bcd4",
  ha: "#4caf50",
  "wifi-client": "#42a5f5",
  "wifi-unknown": "#ff9800",
  "zha-coordinator": "#9c27b0",
  "zigbee-router": "#7c4dff",
  "zigbee-enddevice": "#e040fb",
  offline: "#f44336",
};

export const NODE_SIZES: Record<NodeType, number> = {
  internet: 3,
  router: 12,
  mesh: 10,
  ha: 8,
  "wifi-client": 5,
  "wifi-unknown": 5,
  "zha-coordinator": 8,
  "zigbee-router": 5,
  "zigbee-enddevice": 3,
  offline: 3,
};

export const NODE_LABELS: Record<NodeType, string> = {
  internet: "Internet",
  router: "Router",
  mesh: "Mesh Extender",
  ha: "Home Assistant",
  "wifi-client": "WiFi Device",
  "wifi-unknown": "Unknown Device",
  "zha-coordinator": "Zigbee Coordinator",
  "zigbee-router": "Zigbee Router",
  "zigbee-enddevice": "Zigbee End Device",
  offline: "Offline",
};

export const SIGNAL_THRESHOLDS = {
  WIFI_GOOD: -50,
  WIFI_OK: -65,
  WIFI_WEAK: -75,
  LQI_GOOD: 200,
  LQI_OK: 100,
  LQI_WEAK: 50,
};

export const GRAPH_CONFIG = {
  GROUND_FLOOR_Z: 0,
  SECOND_FLOOR_Z: 80,
  ZIGBEE_CLUSTER_X: 150,
  BACKGROUND_COLOR: "#0a0a1a",
  LINK_COLOR: "rgba(100, 150, 255, 0.15)",
  LINK_HIGHLIGHT_COLOR: "rgba(100, 200, 255, 0.6)",
  FOG_NEAR: 200,
  FOG_FAR: 600,
};
