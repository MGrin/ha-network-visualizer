import type {
  HomeAssistant,
  GraphData,
  NetworkNode,
  NetworkLink,
  ActionItem,
  CardConfig,
  NodeType,
} from "./types";
import {
  NODE_COLORS,
  NODE_SIZES,
  GRAPH_CONFIG,
  SIGNAL_THRESHOLDS,
} from "./constants";

export function collectGraphData(
  hass: HomeAssistant,
  config: CardConfig,
  zhaDevices: any[] | null,
): GraphData {
  const nodes: NetworkNode[] = [];
  const links: NetworkLink[] = [];

  // Infrastructure nodes
  addInfrastructureNodes(nodes, links, config);

  // WiFi clients from router integration sensor
  addWiFiClients(hass, config, nodes, links);

  // Zigbee network
  if (zhaDevices) {
    addZigbeeDevices(zhaDevices, nodes, links);
  }

  // Apply visual properties
  nodes.forEach((node) => {
    node.val = NODE_SIZES[node.type] || 5;
    node.color = node.online
      ? (NODE_COLORS[node.type] || "#42a5f5")
      : NODE_COLORS.offline;
  });

  return { nodes, links };
}

function addInfrastructureNodes(
  nodes: NetworkNode[],
  links: NetworkLink[],
  config: CardConfig,
): void {
  // Internet
  nodes.push({
    id: "internet",
    name: "Internet",
    type: "internet",
    floor: 0,
    online: true,
    fy: -100,
  });

  // Main router
  nodes.push({
    id: "router-main",
    name: config.router_name || "Router",
    type: "router",
    floor: 0,
    ip: "192.168.0.1",
    online: true,
    fy: 0,
  });
  links.push({ source: "internet", target: "router-main", strength: 1 });

  // Mesh extender
  if (config.mesh_name) {
    nodes.push({
      id: "router-mesh",
      name: config.mesh_name,
      type: "mesh",
      floor: 1,
      ip: "192.168.0.150",
      online: true,
      fz: GRAPH_CONFIG.SECOND_FLOOR_Z,
    });
    links.push({ source: "router-main", target: "router-mesh", strength: 0.8 });
  }

  // Home Assistant
  nodes.push({
    id: "ha",
    name: "Home Assistant",
    type: "ha",
    floor: 0,
    ip: "192.168.0.185",
    online: true,
  });
  links.push({ source: "router-main", target: "ha", strength: 1 });
}

function addWiFiClients(
  hass: HomeAssistant,
  config: CardConfig,
  nodes: NetworkNode[],
  links: NetworkLink[],
): void {
  const entityId =
    config.router_entity || "sensor.network_visualizer_clients";
  const entity = hass.states[entityId];
  if (!entity?.attributes?.clients) return;

  const clients: any[] = entity.attributes.clients;
  const knownDevices = config.known_devices || {};

  for (const client of clients) {
    const mac = client.mac?.toLowerCase();
    const known = knownDevices[mac];
    const isOnline = client.online !== false;

    const nodeType: NodeType = !isOnline
      ? "offline"
      : known
        ? "wifi-client"
        : "wifi-unknown";

    const floor = known?.floor ?? 0;

    const node: NetworkNode = {
      id: `wifi-${mac}`,
      name: known?.name || client.hostname || mac,
      type: nodeType,
      floor,
      ip: client.ip,
      mac,
      signal: client.signal,
      band: client.band,
      online: isOnline,
    };

    // Position second floor devices higher
    if (floor === 1) {
      node.fz = GRAPH_CONFIG.SECOND_FLOOR_Z;
    }

    nodes.push(node);

    // Link to appropriate router
    const routerTarget =
      floor === 1 && config.mesh_name ? "router-mesh" : "router-main";
    const signalStrength = client.signal
      ? Math.max(0, Math.min(1, (client.signal + 90) / 50))
      : 0.5;

    links.push({
      source: routerTarget,
      target: `wifi-${mac}`,
      strength: signalStrength,
    });
  }
}

function addZigbeeDevices(
  zhaDevices: any[],
  nodes: NetworkNode[],
  links: NetworkLink[],
): void {
  // Find coordinator
  const coordinator = zhaDevices.find(
    (d) => d.device_type === "Coordinator",
  );

  if (coordinator) {
    nodes.push({
      id: `zha-${coordinator.ieee}`,
      name: "ZHA Coordinator",
      type: "zha-coordinator",
      floor: 0,
      manufacturer: coordinator.manufacturer,
      model: coordinator.model,
      online: true,
      fx: GRAPH_CONFIG.ZIGBEE_CLUSTER_X,
    });

    // Link coordinator to HA (it's a USB device)
    links.push({
      source: "ha",
      target: `zha-${coordinator.ieee}`,
      strength: 1,
    });
  }

  // Add other Zigbee devices
  for (const device of zhaDevices) {
    if (device.device_type === "Coordinator") continue;

    const isRouter = device.device_type === "Router";
    const nodeType: NodeType = isRouter
      ? "zigbee-router"
      : "zigbee-enddevice";

    nodes.push({
      id: `zha-${device.ieee}`,
      name: device.name || device.model || device.ieee,
      type: nodeType,
      floor: 0,
      manufacturer: device.manufacturer,
      model: device.model,
      signal: device.lqi,
      online: device.available !== false,
    });

    // Link to coordinator or parent router
    const parentId = coordinator
      ? `zha-${coordinator.ieee}`
      : undefined;
    if (parentId) {
      const lqiStrength = device.lqi
        ? Math.min(1, device.lqi / 255)
        : 0.5;
      links.push({
        source: parentId,
        target: `zha-${device.ieee}`,
        strength: lqiStrength,
      });
    }
  }
}

export function generateActionItems(
  hass: HomeAssistant,
  config: CardConfig,
  graphData: GraphData,
): ActionItem[] {
  const items: ActionItem[] = [];

  for (const node of graphData.nodes) {
    // Unknown / unnamed devices
    if (node.type === "wifi-unknown" && node.online) {
      items.push({
        severity: "warning",
        icon: "mdi:help-circle",
        title: `Unknown device: ${node.name}`,
        description: `IP: ${node.ip || "?"}, MAC: ${node.mac || "?"}. Consider naming it in router settings.`,
      });
    }

    // Weak WiFi signal
    if (
      node.signal &&
      node.type.startsWith("wifi") &&
      node.signal < SIGNAL_THRESHOLDS.WIFI_WEAK &&
      node.online
    ) {
      items.push({
        severity: "error",
        icon: "mdi:wifi-strength-1",
        title: `Weak signal: ${node.name}`,
        description: `Signal: ${node.signal} dBm. Consider moving device or adding a mesh node.`,
      });
    }

    // Weak Zigbee LQI
    if (
      node.signal &&
      node.type.startsWith("zigbee") &&
      node.signal < SIGNAL_THRESHOLDS.LQI_WEAK &&
      node.online
    ) {
      items.push({
        severity: "error",
        icon: "mdi:zigbee",
        title: `Weak Zigbee link: ${node.name}`,
        description: `LQI: ${node.signal}. May cause unreliable communication.`,
      });
    }

    // No DHCP reservation (no fixed IP in known devices)
    const knownDevices = config.known_devices || {};
    if (
      node.mac &&
      !knownDevices[node.mac.toLowerCase()] &&
      node.type.startsWith("wifi") &&
      node.online
    ) {
      items.push({
        severity: "info",
        icon: "mdi:ip-network-outline",
        title: `No DHCP reservation: ${node.name}`,
        description: `MAC: ${node.mac}, IP: ${node.ip}. Device may get a different IP on reconnect.`,
      });
    }

    // Offline devices that are known
    if (
      !node.online &&
      node.mac &&
      knownDevices[node.mac.toLowerCase()]
    ) {
      items.push({
        severity: "info",
        icon: "mdi:power-plug-off",
        title: `Offline: ${node.name}`,
        description: `Known device is not connected.`,
      });
    }
  }

  // Sort: errors first, then warnings, then info
  const severityOrder = { error: 0, warning: 1, info: 2 };
  items.sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity],
  );

  return items;
}
