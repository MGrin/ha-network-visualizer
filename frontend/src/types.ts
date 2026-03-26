export interface NetworkNode {
  id: string;
  name: string;
  type: NodeType;
  floor: number; // 0 = ground, 1 = second floor
  ip?: string;
  mac?: string;
  signal?: number; // dBm for WiFi, LQI for Zigbee
  band?: string; // "2.4GHz" | "5GHz"
  manufacturer?: string;
  model?: string;
  area?: string;
  online: boolean;
  // 3d-force-graph properties
  val?: number; // node size
  color?: string;
  fx?: number; // fixed x position
  fy?: number;
  fz?: number;
}

export interface NetworkLink {
  source: string;
  target: string;
  strength?: number; // 0-1, based on signal/LQI
  color?: string;
  label?: string;
}

export interface GraphData {
  nodes: NetworkNode[];
  links: NetworkLink[];
}

export type NodeType =
  | "internet"
  | "router"
  | "mesh"
  | "ha"
  | "wifi-client"
  | "wifi-unknown"
  | "zha-coordinator"
  | "zigbee-router"
  | "zigbee-enddevice"
  | "offline";

export interface ActionItem {
  severity: "warning" | "error" | "info";
  icon: string;
  title: string;
  description: string;
  entityId?: string;
}

export interface RouterClient {
  mac: string;
  ip: string;
  hostname: string;
  signal?: number;
  band?: string;
  online: boolean;
}

export interface ZHADevice {
  ieee: string;
  nwk: number;
  name: string;
  manufacturer: string;
  model: string;
  lqi?: number;
  rssi?: number;
  device_type: string;
  neighbors?: Array<{ ieee: string; lqi: number }>;
  available: boolean;
}

export interface CardConfig {
  type: string;
  title?: string;
  router_entity?: string; // sensor.network_visualizer_clients
  router_host?: string; // router IP (auto-detected from sensor if not set)
  router_name?: string;
  mesh_name?: string;
  mesh_ip?: string;
  known_devices?: Record<string, { name: string; floor: number; category: string }>;
  known_macs?: string[]; // MACs with DHCP reservations — devices not in this list are highlighted as unknown
  height?: number;
}

export interface HomeAssistant {
  states: Record<string, HassEntity>;
  callWS: (msg: Record<string, any>) => Promise<any>;
  callService: (domain: string, service: string, data?: Record<string, any>) => Promise<any>;
}

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
  last_changed: string;
}
