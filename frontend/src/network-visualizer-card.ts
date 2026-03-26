import ForceGraph3D from "3d-force-graph";
import {
  NODE_COLORS,
  NODE_SIZES,
  GRAPH_CONFIG,
  SIGNAL_THRESHOLDS,
} from "./constants";
import type {
  HomeAssistant,
  CardConfig,
  GraphData,
  NetworkNode,
  NetworkLink,
  ActionItem,
} from "./types";

class NetworkVisualizerCard extends HTMLElement {
  private hass_?: HomeAssistant;
  private config_?: CardConfig;
  private graph: any = null;
  private graphData: GraphData = { nodes: [], links: [] };
  private actionItems: ActionItem[] = [];
  private selectedNode: NetworkNode | null = null;
  private zhaDevices: any[] | null = null;
  private initialized = false;
  private updateTimeout: number | null = null;
  private shadow: ShadowRoot;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: "open" });
  }

  set hass(hass: HomeAssistant) {
    this.hass_ = hass;
    if (!this.zhaDevices) this.fetchZHADevices();
    this.scheduleUpdate();
  }

  setConfig(config: CardConfig) {
    this.config_ = { ...config, height: config.height || 550 };
    this.render();
  }

  getCardSize() {
    return 8;
  }

  getGridOptions() {
    return { columns: 12, rows: 8, min_columns: 6, min_rows: 4 };
  }

  connectedCallback() {
    this.render();
  }

  disconnectedCallback() {
    if (this.graph) {
      this.graph._destructor?.();
      this.graph = null;
    }
    this.initialized = false;
    if (this.updateTimeout) clearTimeout(this.updateTimeout);
  }

  private scheduleUpdate() {
    if (this.updateTimeout) clearTimeout(this.updateTimeout);
    this.updateTimeout = window.setTimeout(() => this.updateData(), 2000);
  }

  private async fetchZHADevices() {
    if (!this.hass_) return;
    try {
      this.zhaDevices = await this.hass_.callWS({ type: "zha/devices" });
    } catch {
      this.zhaDevices = null;
    }
  }

  private render() {
    if (!this.config_) return;

    const height = this.config_.height || 550;
    const wifiCount = this.graphData.nodes.filter((n) => n.type.startsWith("wifi")).length;
    const zigbeeCount = this.graphData.nodes.filter((n) => n.type.startsWith("zigbee") || n.type === "zha-coordinator").length;
    const onlineCount = this.graphData.nodes.filter((n) => n.online && !["internet", "router", "mesh", "ha"].includes(n.type)).length;
    const alertCount = this.actionItems.filter((a) => a.severity !== "info").length;

    this.shadow.innerHTML = `
      <style>${STYLES}</style>
      <ha-card>
        <div class="stats-bar">
          <div class="stat"><span class="count">${onlineCount}</span> devices online</div>
          <div class="stat"><span class="count">${wifiCount}</span> WiFi</div>
          <div class="stat"><span class="count">${zigbeeCount}</span> Zigbee</div>
          ${alertCount > 0 ? `<div class="stat"><span class="count" style="color:#ff9800">${alertCount}</span> alerts</div>` : ""}
        </div>
        <div class="card-container">
          <div id="graph" class="graph-container" style="height:${height}px">
            <div class="legend">
              ${this.renderLegend()}
            </div>
          </div>
          ${this.selectedNode ? this.renderDetailPanel() : this.actionItems.length > 0 ? this.renderActionItems() : ""}
        </div>
      </ha-card>
    `;

    // Initialize 3D graph after DOM is ready
    requestAnimationFrame(() => this.initGraph());
  }

  private renderLegend(): string {
    const items = [
      { color: NODE_COLORS.router, label: "Router" },
      { color: NODE_COLORS["wifi-client"], label: "WiFi" },
      { color: NODE_COLORS["wifi-unknown"], label: "Unknown" },
      { color: NODE_COLORS["zha-coordinator"], label: "Zigbee" },
      { color: NODE_COLORS.offline, label: "Offline" },
    ];
    return items
      .map((i) => `<div class="legend-item"><span class="legend-dot" style="background:${i.color}"></span>${i.label}</div>`)
      .join("");
  }

  private renderDetailPanel(): string {
    const n = this.selectedNode!;
    const signalClass = this.getSignalClass(n);
    const signalUnit = n.type.includes("zigbee") ? "" : " dBm";
    return `
      <div class="detail-panel">
        <h3>${n.name} <button class="close-btn" id="close-detail">&times;</button></h3>
        ${n.ip ? `<div class="detail-row"><span class="label">IP</span><span class="value">${n.ip}</span></div>` : ""}
        ${n.mac ? `<div class="detail-row"><span class="label">MAC</span><span class="value">${n.mac}</span></div>` : ""}
        ${n.signal !== undefined ? `<div class="detail-row"><span class="label">${n.type.includes("zigbee") ? "LQI" : "Signal"}</span><span class="value ${signalClass}">${n.signal}${signalUnit}</span></div>` : ""}
        ${n.band ? `<div class="detail-row"><span class="label">Band</span><span class="value">${n.band}</span></div>` : ""}
        ${n.manufacturer ? `<div class="detail-row"><span class="label">Manufacturer</span><span class="value">${n.manufacturer}</span></div>` : ""}
        ${n.model ? `<div class="detail-row"><span class="label">Model</span><span class="value">${n.model}</span></div>` : ""}
        <div class="detail-row"><span class="label">Status</span><span class="value" style="color:${n.online ? "#4caf50" : "#f44336"}">${n.online ? "Online" : "Offline"}</span></div>
        <div class="detail-row"><span class="label">Type</span><span class="value">${n.type}</span></div>
      </div>
    `;
  }

  private renderActionItems(): string {
    return `
      <div class="detail-panel">
        <h3>Action Items</h3>
        ${this.actionItems
          .slice(0, 12)
          .map(
            (item) => `
          <div class="action-item ${item.severity}">
            <div>
              <div class="title">${item.title}</div>
              <div>${item.description}</div>
            </div>
          </div>
        `,
          )
          .join("")}
      </div>
    `;
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
        .nodeLabel((node: any) => this.buildTooltip(node))
        .nodeColor((node: any) => node.color || NODE_COLORS[node.type as keyof typeof NODE_COLORS] || "#42a5f5")
        .nodeVal((node: any) => node.val || 5)
        .nodeOpacity(0.9)
        .nodeResolution(16)
        .linkColor((link: any) => {
          const s = link.strength || 0.5;
          return `rgba(100,180,255,${0.1 + s * 0.4})`;
        })
        .linkWidth((link: any) => 0.5 + (link.strength || 0.5) * 2)
        .linkOpacity(0.6)
        .onNodeClick((node: any) => {
          this.selectedNode = node;
          this.render();
          // Re-init graph preserves state via graphData
        })
        .onBackgroundClick(() => {
          if (this.selectedNode) {
            this.selectedNode = null;
            this.render();
          }
        })
        .d3AlphaDecay(0.02)
        .d3VelocityDecay(0.3);

      this.graph.d3Force("charge")?.strength(-80);
      this.graph.d3Force("link")?.distance((link: any) => 30 + (1 - (link.strength || 0.5)) * 60);

      this.initialized = true;

      if (this.graphData.nodes.length > 0) {
        this.graph.graphData(this.graphData);
      }
    } catch (e) {
      console.error("NetworkVisualizer: Failed to initialize graph", e);
    }

    // Wire up close button
    this.shadow.getElementById("close-detail")?.addEventListener("click", () => {
      this.selectedNode = null;
      this.render();
    });
  }

  private updateData() {
    if (!this.hass_ || !this.config_) return;

    this.graphData = this.collectData();
    this.actionItems = this.generateActions();

    if (this.graph && this.initialized) {
      this.graph.graphData(this.graphData);
    }

    // Update stats without re-rendering the whole card
    const statsBar = this.shadow.querySelector(".stats-bar");
    if (statsBar) {
      const wifiCount = this.graphData.nodes.filter((n) => n.type.startsWith("wifi")).length;
      const zigbeeCount = this.graphData.nodes.filter((n) => n.type.startsWith("zigbee") || n.type === "zha-coordinator").length;
      const onlineCount = this.graphData.nodes.filter((n) => n.online && !["internet", "router", "mesh", "ha"].includes(n.type)).length;
      const counts = statsBar.querySelectorAll(".count");
      if (counts[0]) counts[0].textContent = String(onlineCount);
      if (counts[1]) counts[1].textContent = String(wifiCount);
      if (counts[2]) counts[2].textContent = String(zigbeeCount);
    }
  }

  private collectData(): GraphData {
    const nodes: NetworkNode[] = [];
    const links: NetworkLink[] = [];

    // Infrastructure
    nodes.push({ id: "internet", name: "Internet", type: "internet", floor: 0, online: true, val: 3 });
    nodes.push({ id: "router-main", name: this.config_?.router_name || "Router", type: "router", floor: 0, ip: "192.168.0.1", online: true, val: 12 });
    links.push({ source: "internet", target: "router-main", strength: 1 });

    if (this.config_?.mesh_name) {
      nodes.push({ id: "router-mesh", name: this.config_.mesh_name, type: "mesh", floor: 1, ip: "192.168.0.150", online: true, val: 10 });
      links.push({ source: "router-main", target: "router-mesh", strength: 0.8 });
    }

    nodes.push({ id: "ha", name: "Home Assistant", type: "ha", floor: 0, ip: "192.168.0.185", online: true, val: 8 });
    links.push({ source: "router-main", target: "ha", strength: 1 });

    // WiFi clients
    const entity = this.hass_?.states[this.config_?.router_entity || "sensor.connected_clients"];
    const clients = entity?.attributes?.clients || [];
    for (const c of clients) {
      const mac = c.mac?.toLowerCase();
      const isOnline = c.online && c.ip !== "0.0.0.0";
      const nodeType = !isOnline ? "offline" as const : "wifi-client" as const;

      nodes.push({
        id: `wifi-${mac}`, name: c.hostname || mac, type: nodeType,
        floor: 0, ip: c.ip, mac, signal: c.signal, band: c.band, online: isOnline,
        val: NODE_SIZES[nodeType], color: isOnline ? NODE_COLORS[nodeType] : NODE_COLORS.offline,
      });

      const strength = c.signal ? Math.max(0.1, Math.min(1, (c.signal + 90) / 50)) : 0.5;
      links.push({ source: "router-main", target: `wifi-${mac}`, strength });
    }

    // Zigbee devices
    if (this.zhaDevices) {
      const coord = this.zhaDevices.find((d: any) => d.device_type === "Coordinator");
      if (coord) {
        nodes.push({
          id: `zha-${coord.ieee}`, name: "ZHA Coordinator", type: "zha-coordinator",
          floor: 0, manufacturer: coord.manufacturer, model: coord.model, online: true, val: 8,
          color: NODE_COLORS["zha-coordinator"],
        });
        links.push({ source: "ha", target: `zha-${coord.ieee}`, strength: 1 });
      }

      for (const dev of this.zhaDevices) {
        if (dev.device_type === "Coordinator") continue;
        const isRouter = dev.device_type === "Router";
        const nodeType = isRouter ? "zigbee-router" as const : "zigbee-enddevice" as const;
        nodes.push({
          id: `zha-${dev.ieee}`, name: dev.name || dev.model || dev.ieee, type: nodeType,
          floor: 0, manufacturer: dev.manufacturer, model: dev.model, signal: dev.lqi,
          online: dev.available !== false, val: NODE_SIZES[nodeType], color: NODE_COLORS[nodeType],
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
      if (n.type === "wifi-client" && n.online && n.signal && n.signal < SIGNAL_THRESHOLDS.WIFI_WEAK) {
        items.push({ severity: "error", icon: "mdi:wifi-strength-1", title: `Weak signal: ${n.name}`, description: `${n.signal} dBm` });
      }
      if (n.type.startsWith("wifi") && n.online && (!n.name || n.name === n.mac)) {
        items.push({ severity: "warning", icon: "mdi:help-circle", title: `Unnamed: ${n.mac}`, description: `IP: ${n.ip}` });
      }
    }
    items.sort((a, b) => (a.severity === "error" ? 0 : 1) - (b.severity === "error" ? 0 : 1));
    return items;
  }

  private buildTooltip(node: NetworkNode): string {
    const lines = [`<b style="color:${node.color || "#fff"}">${node.name}</b>`];
    if (node.ip) lines.push(`IP: ${node.ip}`);
    if (node.mac) lines.push(`MAC: ${node.mac}`);
    if (node.signal !== undefined) lines.push(`Signal: ${node.signal}${node.type.includes("zigbee") ? " LQI" : " dBm"}`);
    if (node.band) lines.push(`Band: ${node.band}`);
    lines.push(`Status: ${node.online ? "Online" : "Offline"}`);
    return lines.join("<br>");
  }

  private getSignalClass(node: NetworkNode): string {
    if (!node.signal) return "";
    if (node.type.includes("zigbee")) return node.signal > 200 ? "signal-good" : node.signal > 100 ? "signal-ok" : "signal-weak";
    return node.signal > -50 ? "signal-good" : node.signal > -70 ? "signal-ok" : "signal-weak";
  }
}

const STYLES = `
  :host { display: block; }
  ha-card { overflow: hidden; background: var(--ha-card-background, #1a1a2e); border-radius: var(--ha-card-border-radius, 12px); }
  .card-container { display: flex; position: relative; width: 100%; }
  .graph-container { flex: 1; min-height: 500px; position: relative; cursor: grab; }
  .graph-container:active { cursor: grabbing; }
  .detail-panel { width: 300px; background: rgba(10,10,30,0.95); border-left: 1px solid rgba(100,150,255,0.2); padding: 16px; overflow-y: auto; max-height: 600px; font-family: system-ui, sans-serif; }
  .detail-panel h3 { margin: 0 0 12px; color: #00e5ff; font-size: 16px; display: flex; align-items: center; }
  .close-btn { margin-left: auto; cursor: pointer; color: rgba(255,255,255,0.5); font-size: 20px; border: none; background: none; }
  .close-btn:hover { color: #fff; }
  .detail-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 13px; }
  .detail-row .label { color: rgba(255,255,255,0.5); }
  .detail-row .value { color: rgba(255,255,255,0.9); font-family: "SF Mono", monospace; }
  .signal-good { color: #4caf50; }
  .signal-ok { color: #ff9800; }
  .signal-weak { color: #f44336; }
  .action-item { display: flex; gap: 8px; padding: 8px; margin-bottom: 6px; border-radius: 8px; background: rgba(255,255,255,0.03); font-size: 12px; color: rgba(255,255,255,0.7); }
  .action-item.warning { border-left: 3px solid #ff9800; }
  .action-item.error { border-left: 3px solid #f44336; }
  .action-item .title { font-weight: 600; color: rgba(255,255,255,0.9); }
  .legend { position: absolute; bottom: 12px; left: 12px; display: flex; gap: 12px; padding: 8px 12px; background: rgba(10,10,30,0.85); border-radius: 8px; border: 1px solid rgba(100,150,255,0.15); font-size: 11px; z-index: 10; flex-wrap: wrap; }
  .legend-item { display: flex; align-items: center; gap: 4px; color: rgba(255,255,255,0.6); }
  .legend-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  .stats-bar { display: flex; gap: 16px; padding: 12px 16px; background: rgba(10,10,30,0.6); border-bottom: 1px solid rgba(100,150,255,0.1); font-size: 13px; color: rgba(255,255,255,0.6); }
  .stat { display: flex; align-items: center; gap: 6px; }
  .stat .count { color: #00e5ff; font-weight: 700; font-size: 18px; }
`;

customElements.define("network-visualizer-card", NetworkVisualizerCard);

(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: "network-visualizer-card",
  name: "Network Visualizer",
  description: "3D interactive home network topology visualization",
  preview: false,
});
