import ForceGraph3D from "3d-force-graph";
import * as THREE from "three";
import { NODE_COLORS, NODE_SIZES, GRAPH_CONFIG, SIGNAL_THRESHOLDS } from "./constants";
import type { HomeAssistant, CardConfig, GraphData, NetworkNode, NetworkLink, ActionItem } from "./types";

// Device icon mappings (Unicode symbols for canvas rendering)
const DEVICE_ICONS: Record<string, string> = {
  router: "📡", mesh: "📶", ha: "🏠", internet: "🌐",
  "zha-coordinator": "⬡", "zigbee-router": "⬡", "zigbee-enddevice": "⬡",
  // WiFi devices by hostname patterns
  iphone: "📱", ipad: "📱", macbook: "💻", mac: "💻",
  switch: "💡", light: "💡", lamp: "💡", led: "💡",
  plug: "🔌", socket: "🔌",
  speaker: "🔊", alica: "🔊", yandex: "🔊",
  vacuum: "🤖", robot: "🤖",
  sensor: "🌡️", remote: "📺", camera: "📷", doorbell: "🔔",
  default: "●",
};

function getDeviceIcon(node: NetworkNode): string {
  const name = (node.name || "").toLowerCase();
  for (const [key, icon] of Object.entries(DEVICE_ICONS)) {
    if (key === "default") continue;
    if (name.includes(key)) return icon;
  }
  if (node.type.includes("zigbee") || node.type.includes("zha")) return "⬡";
  if (node.type === "router" || node.type === "mesh") return DEVICE_ICONS.router;
  if (node.type === "ha") return DEVICE_ICONS.ha;
  if (node.type === "internet") return DEVICE_ICONS.internet;
  return DEVICE_ICONS.default;
}

class NetworkVisualizerCard extends HTMLElement {
  private hass_?: HomeAssistant;
  private config_?: CardConfig;
  private graph: any = null;
  private graphData: GraphData = { nodes: [], links: [] };
  private actionItems: ActionItem[] = [];
  private selectedNode: NetworkNode | null = null;
  private zhaDevices: any[] | null = null;
  private haDevices: any[] | null = null;
  private initialized = false;
  private updateTimeout: number | null = null;
  private lastDataHash = "";
  private shadow: ShadowRoot;
  private nodeObjects = new Map<string, THREE.Object3D>();

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: "open" });
  }

  set hass(hass: HomeAssistant) {
    this.hass_ = hass;
    if (!this.zhaDevices) this.fetchZHADevices();
    if (!this.haDevices) this.fetchHADevices();
    this.scheduleUpdate();
  }

  setConfig(config: CardConfig) {
    this.config_ = { ...config, height: config.height || 550 };
    this.renderShell();
  }

  getCardSize() { return 8; }
  getGridOptions() { return { columns: 12, rows: 8, min_columns: 6, min_rows: 4 }; }

  connectedCallback() { this.renderShell(); }

  disconnectedCallback() {
    this.graph?._destructor?.();
    this.graph = null;
    this.initialized = false;
    this.nodeObjects.clear();
    if (this.updateTimeout) clearTimeout(this.updateTimeout);
  }

  private scheduleUpdate() {
    if (this.updateTimeout) clearTimeout(this.updateTimeout);
    this.updateTimeout = window.setTimeout(() => this.updateData(), 3000);
  }

  private async fetchZHADevices() {
    if (!this.hass_) return;
    try { this.zhaDevices = await this.hass_.callWS({ type: "zha/devices" }); } catch { this.zhaDevices = null; }
  }

  private async fetchHADevices() {
    if (!this.hass_) return;
    try { this.haDevices = await this.hass_.callWS({ type: "config/device_registry/list" }); } catch { this.haDevices = null; }
  }

  // Render the static shell (only once, graph goes inside #graph)
  private renderShell() {
    if (!this.config_) return;
    const height = this.config_.height || 550;

    this.shadow.innerHTML = `
      <style>${STYLES}</style>
      <ha-card>
        <div class="stats-bar" id="stats">
          <div class="stat"><span class="count" id="s-online">0</span> online</div>
          <div class="stat"><span class="count" id="s-wifi">0</span> WiFi</div>
          <div class="stat"><span class="count" id="s-zigbee">0</span> Zigbee</div>
        </div>
        <div class="card-container">
          <div id="graph" class="graph-container" style="height:${height}px"></div>
          <div id="detail-panel" class="detail-panel hidden"></div>
        </div>
        <div class="legend">
          <div class="legend-item"><span class="legend-dot" style="background:${NODE_COLORS.router}"></span>Router</div>
          <div class="legend-item"><span class="legend-dot" style="background:${NODE_COLORS["wifi-client"]}"></span>WiFi</div>
          <div class="legend-item"><span class="legend-dot" style="background:${NODE_COLORS["zha-coordinator"]}"></span>Zigbee</div>
        </div>
      </ha-card>
    `;

    // Wire up click-outside to close detail panel
    this.shadow.getElementById("graph")?.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest?.("#detail-panel")) return;
    });

    requestAnimationFrame(() => this.initGraph());
  }

  private initGraph() {
    const container = this.shadow.getElementById("graph");
    if (!container || this.initialized) return;
    const width = container.clientWidth || 800;
    const height = this.config_?.height || 550;

    try {
      this.graph = ForceGraph3D()(container)
        .width(width)
        .height(height)
        .backgroundColor(GRAPH_CONFIG.BACKGROUND_COLOR)
        .showNavInfo(false)
        // Custom node rendering with icons
        .nodeThreeObject((node: any) => this.createNodeObject(node))
        .nodeThreeObjectExtend(false)
        // Disable default tooltip (we'll use our own overlay)
        .nodeLabel("")
        .linkColor((link: any) => `rgba(100,180,255,${0.1 + (link.strength || 0.5) * 0.4})`)
        .linkWidth((link: any) => 0.3 + (link.strength || 0.5) * 1.5)
        .linkOpacity(0.6)
        .onNodeHover((node: any) => this.showTooltip(node))
        .onNodeClick((node: any) => this.showDetail(node))
        .onBackgroundClick(() => this.hideDetail())
        .d3AlphaDecay(0.05)
        .d3VelocityDecay(0.4)
        .warmupTicks(50)
        .cooldownTicks(100);

      this.graph.d3Force("charge")?.strength(-60);
      this.graph.d3Force("link")?.distance((link: any) => 25 + (1 - (link.strength || 0.5)) * 50);

      this.initialized = true;

      // Create hover tooltip overlay
      const tooltip = document.createElement("div");
      tooltip.id = "tooltip";
      tooltip.className = "tooltip hidden";
      container.appendChild(tooltip);

      if (this.graphData.nodes.length > 0) {
        this.graph.graphData(this.graphData);
      }
    } catch (e) {
      console.error("NetworkVisualizer: init failed", e);
    }
  }

  private createNodeObject(node: any): THREE.Object3D {
    const n = node as NetworkNode;
    const size = (NODE_SIZES[n.type] || 5) * 1.5;
    const color = NODE_COLORS[n.type] || "#42a5f5";
    const icon = getDeviceIcon(n);

    // Create a canvas-based sprite
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;

    // Draw circle background
    ctx.beginPath();
    ctx.arc(64, 64, 56, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 3;
    ctx.stroke();

    // Draw icon
    ctx.font = "48px serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff";
    ctx.fillText(icon, 64, 64);

    // Draw name below
    ctx.font = "bold 16px system-ui, sans-serif";
    ctx.fillStyle = "#fff";
    const shortName = (n.name || "").length > 15 ? (n.name || "").substring(0, 13) + "…" : (n.name || "");
    ctx.fillText(shortName, 64, 118);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(size, size, 1);

    this.nodeObjects.set(n.id, sprite);
    return sprite;
  }

  private showTooltip(node: any) {
    const tooltip = this.shadow.getElementById("tooltip");
    if (!tooltip) return;

    if (!node) {
      tooltip.classList.add("hidden");
      return;
    }

    const n = node as NetworkNode;
    const lines = [`<b>${n.name}</b>`];
    if (n.ip) lines.push(`IP: ${n.ip}`);
    if (n.mac) lines.push(`MAC: ${n.mac}`);
    if (n.signal !== undefined) lines.push(`Signal: ${n.signal}${n.type.includes("zigbee") ? " LQI" : " dBm"}`);
    if (n.band) lines.push(`Band: ${n.band}`);
    tooltip.innerHTML = lines.join("<br>");
    tooltip.classList.remove("hidden");
  }

  private showDetail(node: any) {
    const panel = this.shadow.getElementById("detail-panel");
    if (!panel || !node) return;

    const n = node as NetworkNode;
    const signalClass = this.getSignalClass(n);

    panel.innerHTML = `
      <h3>${n.name} <button id="close-btn" class="close-btn">&times;</button></h3>
      ${n.ip ? `<div class="detail-row"><span class="label">IP</span><span class="value">${n.ip}</span></div>` : ""}
      ${n.mac ? `<div class="detail-row"><span class="label">MAC</span><span class="value">${n.mac}</span></div>` : ""}
      ${n.signal !== undefined ? `<div class="detail-row"><span class="label">${n.type.includes("zigbee") ? "LQI" : "Signal"}</span><span class="value ${signalClass}">${n.signal}${n.type.includes("zigbee") ? "" : " dBm"}</span></div>` : ""}
      ${n.band ? `<div class="detail-row"><span class="label">Band</span><span class="value">${n.band}</span></div>` : ""}
      ${n.manufacturer ? `<div class="detail-row"><span class="label">Vendor</span><span class="value">${n.manufacturer}</span></div>` : ""}
      ${n.model ? `<div class="detail-row"><span class="label">Model</span><span class="value">${n.model}</span></div>` : ""}
      <div class="detail-row"><span class="label">Type</span><span class="value">${n.type}</span></div>
    `;
    panel.classList.remove("hidden");
    this.selectedNode = n;

    this.shadow.getElementById("close-btn")?.addEventListener("click", () => this.hideDetail());

    // Focus camera
    const dist = 100;
    const ratio = 1 + dist / Math.hypot(node.x || 0, node.y || 0, node.z || 0);
    this.graph?.cameraPosition(
      { x: (node.x || 0) * ratio, y: (node.y || 0) * ratio, z: (node.z || 0) * ratio },
      node, 1200
    );
  }

  private hideDetail() {
    const panel = this.shadow.getElementById("detail-panel");
    if (panel) panel.classList.add("hidden");
    this.selectedNode = null;
  }

  private updateData() {
    if (!this.hass_ || !this.config_) return;

    const newData = this.collectData();
    const newHash = JSON.stringify(newData.nodes.map(n => n.id + n.online).sort());

    // Only update graph if data actually changed (prevents simulation restart)
    if (newHash !== this.lastDataHash) {
      this.lastDataHash = newHash;
      this.graphData = newData;
      this.actionItems = this.generateActions();
      if (this.graph && this.initialized) {
        this.nodeObjects.clear();
        this.graph.graphData(this.graphData);
      }
    }

    // Always update stats (lightweight)
    this.updateStats();
  }

  private updateStats() {
    const wifi = this.graphData.nodes.filter(n => n.type.startsWith("wifi")).length;
    const zigbee = this.graphData.nodes.filter(n => n.type.startsWith("zigbee") || n.type === "zha-coordinator").length;
    const online = this.graphData.nodes.filter(n => n.online && !["internet", "router", "mesh", "ha"].includes(n.type)).length;
    const el = (id: string) => this.shadow.getElementById(id);
    if (el("s-online")) el("s-online")!.textContent = String(online);
    if (el("s-wifi")) el("s-wifi")!.textContent = String(wifi);
    if (el("s-zigbee")) el("s-zigbee")!.textContent = String(zigbee);
  }

  private collectData(): GraphData {
    const nodes: NetworkNode[] = [];
    const links: NetworkLink[] = [];

    // Infrastructure (always shown)
    nodes.push({ id: "internet", name: "Internet", type: "internet", floor: 0, online: true, val: 3 });
    nodes.push({ id: "router-main", name: this.config_?.router_name || "Router", type: "router", floor: 0, ip: "192.168.0.1", online: true, val: 12 });
    links.push({ source: "internet", target: "router-main", strength: 1 });

    if (this.config_?.mesh_name) {
      nodes.push({ id: "router-mesh", name: this.config_.mesh_name, type: "mesh", floor: 1, ip: "192.168.0.150", online: true, val: 10 });
      links.push({ source: "router-main", target: "router-mesh", strength: 0.8 });
    }

    nodes.push({ id: "ha", name: "Home Assistant", type: "ha", floor: 0, ip: "192.168.0.185", online: true, val: 8 });
    links.push({ source: "router-main", target: "ha", strength: 1 });

    // WiFi clients (ONLINE ONLY)
    const entity = this.hass_?.states[this.config_?.router_entity || "sensor.connected_clients"];
    const clients = entity?.attributes?.clients || [];
    for (const c of clients) {
      const isOnline = c.online && c.ip !== "0.0.0.0" && c.ip;
      if (!isOnline) continue; // Skip offline

      const mac = c.mac?.toLowerCase();
      nodes.push({
        id: `wifi-${mac}`, name: c.hostname || mac, type: "wifi-client",
        floor: 0, ip: c.ip, mac, signal: c.signal, band: c.band, online: true,
        val: NODE_SIZES["wifi-client"], color: NODE_COLORS["wifi-client"],
      });
      const strength = c.signal ? Math.max(0.1, Math.min(1, (c.signal + 90) / 50)) : 0.5;
      links.push({ source: "router-main", target: `wifi-${mac}`, strength });
    }

    // Zigbee devices (with HA names)
    if (this.zhaDevices) {
      const coord = this.zhaDevices.find((d: any) => d.device_type === "Coordinator");
      if (coord) {
        nodes.push({
          id: `zha-${coord.ieee}`, name: "ZHA Coordinator", type: "zha-coordinator",
          floor: 0, manufacturer: coord.manufacturer, model: coord.model, online: true, val: 8,
        });
        links.push({ source: "ha", target: `zha-${coord.ieee}`, strength: 1 });
      }

      for (const dev of this.zhaDevices) {
        if (dev.device_type === "Coordinator") continue;
        if (dev.available === false) continue; // Skip offline

        const isRouter = dev.device_type === "Router";
        const nodeType = isRouter ? "zigbee-router" as const : "zigbee-enddevice" as const;

        // Get friendly name from HA device registry
        let friendlyName = dev.name || dev.model || dev.ieee;
        if (this.haDevices) {
          const haDevice = this.haDevices.find((d: any) =>
            d.identifiers?.some((id: any[]) => id[1] === dev.ieee)
          );
          if (haDevice?.name) friendlyName = haDevice.name;
        }

        nodes.push({
          id: `zha-${dev.ieee}`, name: friendlyName, type: nodeType,
          floor: 0, manufacturer: dev.manufacturer, model: dev.model, signal: dev.lqi,
          online: true, val: NODE_SIZES[nodeType],
        });
        if (coord) {
          const lqi = dev.lqi ? Math.min(1, dev.lqi / 255) : 0.5;
          links.push({ source: `zha-${coord.ieee}`, target: `zha-${dev.ieee}`, strength: lqi });
        }
      }
    }

    return { nodes, links };
  }

  private generateActions(): ActionItem[] {
    const items: ActionItem[] = [];
    for (const n of this.graphData.nodes) {
      if (n.type === "wifi-client" && n.signal && n.signal < SIGNAL_THRESHOLDS.WIFI_WEAK)
        items.push({ severity: "error", icon: "📶", title: `Weak: ${n.name}`, description: `${n.signal} dBm` });
      if (n.type.startsWith("wifi") && (!n.name || n.name === n.mac))
        items.push({ severity: "warning", icon: "❓", title: `Unnamed: ${n.mac}`, description: `IP: ${n.ip}` });
    }
    return items;
  }

  private getSignalClass(node: NetworkNode): string {
    if (!node.signal) return "";
    if (node.type.includes("zigbee")) return node.signal > 200 ? "signal-good" : node.signal > 100 ? "signal-ok" : "signal-weak";
    return node.signal > -50 ? "signal-good" : node.signal > -70 ? "signal-ok" : "signal-weak";
  }
}

const STYLES = `
  :host { display: block; }
  ha-card { overflow: hidden; background: var(--ha-card-background, #1a1a2e); border-radius: var(--ha-card-border-radius, 12px); position: relative; }
  .card-container { display: flex; position: relative; width: 100%; }
  .graph-container { flex: 1; min-height: 400px; position: relative; }
  .graph-container canvas { display: block !important; }

  .tooltip { position: absolute; top: 12px; right: 12px; background: rgba(10,10,30,0.9); color: #fff; padding: 10px 14px; border-radius: 8px; font-size: 12px; font-family: system-ui; line-height: 1.5; border: 1px solid rgba(100,150,255,0.2); pointer-events: none; z-index: 20; max-width: 250px; }
  .tooltip.hidden { display: none; }
  .tooltip b { color: #00e5ff; }

  .detail-panel { position: absolute; top: 0; right: 0; width: 280px; height: 100%; background: rgba(10,10,30,0.95); border-left: 1px solid rgba(100,150,255,0.2); padding: 16px; overflow-y: auto; font-family: system-ui; z-index: 15; box-sizing: border-box; }
  .detail-panel.hidden { display: none; }
  .detail-panel h3 { margin: 0 0 12px; color: #00e5ff; font-size: 15px; display: flex; align-items: center; }
  .close-btn { margin-left: auto; cursor: pointer; color: rgba(255,255,255,0.5); font-size: 22px; border: none; background: none; padding: 0 4px; line-height: 1; }
  .close-btn:hover { color: #fff; }
  .detail-row { display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 12px; }
  .detail-row .label { color: rgba(255,255,255,0.4); }
  .detail-row .value { color: rgba(255,255,255,0.9); font-family: "SF Mono", monospace; font-size: 11px; }
  .signal-good { color: #4caf50 !important; }
  .signal-ok { color: #ff9800 !important; }
  .signal-weak { color: #f44336 !important; }

  .legend { display: flex; gap: 12px; padding: 8px 16px; font-size: 11px; border-top: 1px solid rgba(100,150,255,0.08); }
  .legend-item { display: flex; align-items: center; gap: 4px; color: rgba(255,255,255,0.5); }
  .legend-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }

  .stats-bar { display: flex; gap: 16px; padding: 10px 16px; background: rgba(10,10,30,0.5); border-bottom: 1px solid rgba(100,150,255,0.08); font-size: 13px; color: rgba(255,255,255,0.5); }
  .stat { display: flex; align-items: center; gap: 6px; }
  .stat .count { color: #00e5ff; font-weight: 700; font-size: 16px; }
`;

customElements.define("network-visualizer-card", NetworkVisualizerCard);
(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({ type: "network-visualizer-card", name: "Network Visualizer", description: "3D home network topology", preview: false });
