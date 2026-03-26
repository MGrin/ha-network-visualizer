import ForceGraph from "3d-force-graph";
import * as THREE from "three";
import { NODE_COLORS, NODE_SIZES, GRAPH_CONFIG, SIGNAL_THRESHOLDS } from "./constants";
import type { HomeAssistant, CardConfig, GraphData, NetworkNode, NetworkLink, ActionItem } from "./types";

const DEVICE_ICONS: Record<string, string> = {
  router: "📡", mesh: "📶", ha: "🏠", internet: "🌐",
  "zha-coordinator": "⬡", "zigbee-router": "⬡", "zigbee-enddevice": "⬡",
  iphone: "📱", ipad: "📱", macbook: "💻", mac: "💻",
  switch: "💡", light: "💡", lamp: "💡", led: "💡",
  plug: "🔌", socket: "🔌", speaker: "🔊", alica: "🔊", yandex: "🔊",
  vacuum: "🤖", robot: "🤖", sensor: "🌡️", remote: "📺",
  camera: "📷", doorbell: "🔔", xiaomi: "📱", default: "●",
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

// Determine floor: mesh-connected = floor 2, router-connected = floor 1
function determineFloor(node: NetworkNode, config: CardConfig): number {
  // Infrastructure positions
  if (node.type === "internet") return 0;
  if (node.type === "router") return 1;
  if (node.type === "mesh") return 2;
  if (node.type === "ha") return 1;
  if (node.type.includes("zigbee") || node.type.includes("zha")) return 1;

  // WiFi clients: if connected to 2.4G with weak signal from main router,
  // likely on floor 2 via mesh. Use known_devices config or band heuristic.
  const mac = node.mac?.toLowerCase() || "";
  const known = config.known_devices?.[mac];
  if (known?.floor !== undefined) return known.floor;

  // Default: floor 1
  return 1;
}

class NetworkVisualizerCard extends HTMLElement {
  private hass_?: HomeAssistant;
  private config_?: CardConfig;
  private graphData: GraphData = { nodes: [], links: [] };
  private selectedNode: NetworkNode | null = null;
  private zhaDevices: any[] | null = null;
  private haDevices: any[] | null = null;
  private initialized = false;
  private updateTimeout: number | null = null;
  private lastDataHash = "";
  private shadow: ShadowRoot;
  private canvas?: HTMLCanvasElement;
  private animFrame?: number;
  private nodePositions = new Map<string, { x: number; y: number; vx: number; vy: number }>();
  private dragNode: NetworkNode | null = null;
  private mouseX = 0;
  private mouseY = 0;
  private hoverNode: NetworkNode | null = null;
  private dataLoaded = false;

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
    this.config_ = { ...config };
    this.renderShell();
  }

  getCardSize() { return 12; }
  getGridOptions() { return { columns: 12, rows: 12, min_columns: 6, min_rows: 8 }; }
  connectedCallback() { this.renderShell(); }

  disconnectedCallback() {
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    this.initialized = false;
  }

  private scheduleUpdate() {
    if (this.updateTimeout) clearTimeout(this.updateTimeout);
    this.updateTimeout = window.setTimeout(() => this.updateData(), this.dataLoaded ? 5000 : 500);
  }

  private async fetchZHADevices() {
    if (!this.hass_) return;
    try { this.zhaDevices = await this.hass_.callWS({ type: "zha/devices" }); } catch { this.zhaDevices = null; }
  }

  private async fetchHADevices() {
    if (!this.hass_) return;
    try { this.haDevices = await this.hass_.callWS({ type: "config/device_registry/list" }); } catch { this.haDevices = null; }
  }

  private renderShell() {
    if (!this.config_) return;
    this.shadow.innerHTML = `<style>${STYLES}</style>
      <div class="root">
        <div class="stats-bar" id="stats">
          <div class="stat"><span class="count" id="s-online">-</span> online</div>
          <div class="stat"><span class="count" id="s-wifi">-</span> WiFi</div>
          <div class="stat"><span class="count" id="s-zigbee">-</span> Zigbee</div>
          <div class="stat"><span class="count" id="s-f1">-</span> Floor 1</div>
          <div class="stat"><span class="count" id="s-f2">-</span> Floor 2</div>
        </div>
        <div class="canvas-wrap" id="canvas-wrap">
          <canvas id="canvas"></canvas>
          <div id="tooltip" class="tooltip hidden"></div>
          <div id="detail" class="detail-panel hidden"></div>
          <div id="loading" class="loading">Connecting to router...</div>
        </div>
        <div class="legend">
          <div class="legend-item"><span class="legend-dot" style="background:${NODE_COLORS.router}"></span>Router</div>
          <div class="legend-item"><span class="legend-dot" style="background:${NODE_COLORS["wifi-client"]}"></span>WiFi</div>
          <div class="legend-item"><span class="legend-dot" style="background:${NODE_COLORS["zha-coordinator"]}"></span>Zigbee</div>
          <div class="legend-item"><span class="legend-dot" style="background:${NODE_COLORS.ha}"></span>Home Assistant</div>
        </div>
      </div>`;

    requestAnimationFrame(() => this.initCanvas());
  }

  private initCanvas() {
    const wrap = this.shadow.getElementById("canvas-wrap");
    const canvas = this.shadow.getElementById("canvas") as HTMLCanvasElement;
    if (!wrap || !canvas) return;

    this.canvas = canvas;
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      canvas.width = rect.width * devicePixelRatio;
      canvas.height = rect.height * devicePixelRatio;
      canvas.style.width = rect.width + "px";
      canvas.style.height = rect.height + "px";
    };
    resize();
    new ResizeObserver(resize).observe(wrap);

    // Mouse events
    canvas.addEventListener("mousemove", (e) => {
      const rect = canvas.getBoundingClientRect();
      this.mouseX = e.clientX - rect.left;
      this.mouseY = e.clientY - rect.top;
      this.handleHover();
      if (this.dragNode) {
        const pos = this.nodePositions.get(this.dragNode.id);
        if (pos) { pos.x = this.mouseX; pos.y = this.mouseY; pos.vx = 0; pos.vy = 0; }
      }
    });
    canvas.addEventListener("mousedown", () => {
      if (this.hoverNode) this.dragNode = this.hoverNode;
    });
    canvas.addEventListener("mouseup", () => {
      if (this.dragNode && !this.hoverNode) { this.hideDetail(); }
      else if (this.hoverNode) { this.showDetail(this.hoverNode); }
      this.dragNode = null;
    });
    canvas.addEventListener("mouseleave", () => {
      this.hoverNode = null;
      this.shadow.getElementById("tooltip")?.classList.add("hidden");
    });

    this.initialized = true;
    this.animate();
  }

  private animate() {
    this.drawFrame();
    this.simulationStep();
    this.animFrame = requestAnimationFrame(() => this.animate());
  }

  private simulationStep() {
    // Simple force simulation
    const nodes = this.graphData.nodes;
    const links = this.graphData.links;

    for (const node of nodes) {
      let pos = this.nodePositions.get(node.id);
      if (!pos) continue;
      if (node.id === this.dragNode?.id) continue;

      let fx = 0, fy = 0;

      // Repulsion between nodes
      for (const other of nodes) {
        if (other.id === node.id) continue;
        const op = this.nodePositions.get(other.id);
        if (!op) continue;
        const dx = pos.x - op.x;
        const dy = pos.y - op.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (dist < 200) {
          const force = 300 / (dist * dist);
          fx += (dx / dist) * force;
          fy += (dy / dist) * force;
        }
      }

      // Attraction along links
      for (const link of links) {
        const src = typeof link.source === "string" ? link.source : (link.source as any).id;
        const tgt = typeof link.target === "string" ? link.target : (link.target as any).id;
        let otherId: string | null = null;
        if (src === node.id) otherId = tgt;
        else if (tgt === node.id) otherId = src;
        if (!otherId) continue;
        const op = this.nodePositions.get(otherId);
        if (!op) continue;
        const dx = op.x - pos.x;
        const dy = op.y - pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (dist - 80) * 0.003 * (link.strength || 0.5);
        fx += (dx / dist) * force;
        fy += (dy / dist) * force;
      }

      // Floor containment: keep nodes in their floor zone
      const canvas = this.canvas!;
      const w = canvas.width / devicePixelRatio;
      const h = canvas.height / devicePixelRatio;
      const floorY = this.getFloorY(node.floor, h);
      const floorForce = (floorY - pos.y) * 0.02;
      fy += floorForce;

      // Keep within bounds
      if (pos.x < 40) fx += 1;
      if (pos.x > w - 40) fx -= 1;

      pos.vx = (pos.vx + fx) * 0.85;
      pos.vy = (pos.vy + fy) * 0.85;
      pos.x += pos.vx;
      pos.y += pos.vy;
    }
  }

  private getFloorY(floor: number, h: number): number {
    // Floor 0 (internet) = very top
    // Floor 1 (ground floor) = upper half
    // Floor 2 (second floor) = lower half
    if (floor === 0) return 50;
    if (floor === 2) return h * 0.72;
    return h * 0.35;
  }

  private drawFrame() {
    const canvas = this.canvas;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = devicePixelRatio;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Clear
    ctx.fillStyle = GRAPH_CONFIG.BACKGROUND_COLOR;
    ctx.fillRect(0, 0, w, h);

    // Draw floor zones
    this.drawFloors(ctx, w, h);

    // Draw links
    ctx.lineWidth = 1;
    for (const link of this.graphData.links) {
      const src = typeof link.source === "string" ? link.source : (link.source as any).id;
      const tgt = typeof link.target === "string" ? link.target : (link.target as any).id;
      const sp = this.nodePositions.get(src);
      const tp = this.nodePositions.get(tgt);
      if (!sp || !tp) continue;
      const alpha = 0.08 + (link.strength || 0.5) * 0.15;
      ctx.strokeStyle = `rgba(100,180,255,${alpha})`;
      ctx.beginPath();
      ctx.moveTo(sp.x, sp.y);
      ctx.lineTo(tp.x, tp.y);
      ctx.stroke();
    }

    // Draw nodes
    for (const node of this.graphData.nodes) {
      const pos = this.nodePositions.get(node.id);
      if (!pos) continue;
      this.drawNode(ctx, node, pos.x, pos.y);
    }
  }

  private drawFloors(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const pad = 20;
    const midY = h * 0.52;
    const houseW = w - pad * 2;

    // Floor 1 (Ground) zone
    ctx.fillStyle = "rgba(40, 80, 120, 0.08)";
    ctx.strokeStyle = "rgba(100, 150, 255, 0.15)";
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    const f1Top = 70;
    const f1Bot = midY - 10;
    this.roundRect(ctx, pad, f1Top, houseW, f1Bot - f1Top, 12);
    ctx.fill();
    ctx.stroke();

    // Floor 1 label
    ctx.setLineDash([]);
    ctx.font = "12px system-ui";
    ctx.fillStyle = "rgba(100, 150, 255, 0.4)";
    ctx.fillText("Floor 1 — Ground", pad + 12, f1Top + 18);

    // Floor 2 zone
    ctx.fillStyle = "rgba(80, 40, 120, 0.08)";
    ctx.strokeStyle = "rgba(180, 100, 255, 0.15)";
    ctx.setLineDash([6, 4]);
    const f2Top = midY + 10;
    const f2Bot = h - 30;
    this.roundRect(ctx, pad, f2Top, houseW, f2Bot - f2Top, 12);
    ctx.fill();
    ctx.stroke();

    // Floor 2 label
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(180, 100, 255, 0.4)";
    ctx.fillText("Floor 2 — Upper", pad + 12, f2Top + 18);

    // Internet zone (very top)
    ctx.fillStyle = "rgba(255,255,255,0.03)";
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.setLineDash([4, 4]);
    this.roundRect(ctx, w / 2 - 60, 5, 120, 55, 8);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.font = "10px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("WAN", w / 2, 18);
    ctx.textAlign = "start";
  }

  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  private drawNode(ctx: CanvasRenderingContext2D, node: NetworkNode, x: number, y: number) {
    const size = (NODE_SIZES[node.type] || 5) * 2;
    const color = NODE_COLORS[node.type] || "#42a5f5";
    const icon = getDeviceIcon(node);
    const isHovered = this.hoverNode?.id === node.id;
    const isSelected = this.selectedNode?.id === node.id;

    // Glow for hovered/selected
    if (isHovered || isSelected) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 20;
    }

    // Circle
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = isHovered ? 1 : 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = isSelected ? "#fff" : "rgba(255,255,255,0.2)";
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Icon
    ctx.font = `${size * 1.1}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff";
    ctx.fillText(icon, x, y);

    // Name label
    ctx.font = `${Math.max(9, size * 0.55)}px system-ui, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const shortName = (node.name || "").length > 18 ? (node.name || "").substring(0, 16) + "…" : (node.name || "");
    ctx.fillText(shortName, x, y + size + 4);
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
  }

  private handleHover() {
    let closest: NetworkNode | null = null;
    let closestDist = 30; // Hover radius

    for (const node of this.graphData.nodes) {
      const pos = this.nodePositions.get(node.id);
      if (!pos) continue;
      const dx = this.mouseX - pos.x;
      const dy = this.mouseY - pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const size = (NODE_SIZES[node.type] || 5) * 2;
      if (dist < size + 10 && dist < closestDist) {
        closest = node;
        closestDist = dist;
      }
    }

    this.hoverNode = closest;
    const tooltip = this.shadow.getElementById("tooltip");
    if (!tooltip) return;

    if (closest) {
      const lines = [`<b>${closest.name}</b>`];
      if (closest.ip) lines.push(`IP: ${closest.ip}`);
      if (closest.mac) lines.push(`MAC: ${closest.mac}`);
      if (closest.signal !== undefined) lines.push(`Signal: ${closest.signal}${closest.type.includes("zigbee") ? " LQI" : " dBm"}`);
      if (closest.band) lines.push(closest.band.replace("HOST_", ""));
      tooltip.innerHTML = lines.join("<br>");
      tooltip.style.left = (this.mouseX + 15) + "px";
      tooltip.style.top = (this.mouseY - 10) + "px";
      tooltip.classList.remove("hidden");
      this.canvas!.style.cursor = "pointer";
    } else {
      tooltip.classList.add("hidden");
      this.canvas!.style.cursor = "default";
    }
  }

  private showDetail(node: NetworkNode) {
    const panel = this.shadow.getElementById("detail");
    if (!panel) return;
    this.selectedNode = node;
    const sc = this.getSignalClass(node);
    panel.innerHTML = `
      <h3>${node.name} <button id="close-btn" class="close-btn">&times;</button></h3>
      ${node.ip ? `<div class="detail-row"><span class="label">IP</span><span class="value">${node.ip}</span></div>` : ""}
      ${node.mac ? `<div class="detail-row"><span class="label">MAC</span><span class="value">${node.mac}</span></div>` : ""}
      ${node.signal !== undefined ? `<div class="detail-row"><span class="label">${node.type.includes("zigbee") ? "LQI" : "Signal"}</span><span class="value ${sc}">${node.signal}${node.type.includes("zigbee") ? "" : " dBm"}</span></div>` : ""}
      ${node.band ? `<div class="detail-row"><span class="label">Band</span><span class="value">${node.band.replace("HOST_", "")}</span></div>` : ""}
      ${node.manufacturer ? `<div class="detail-row"><span class="label">Vendor</span><span class="value">${node.manufacturer}</span></div>` : ""}
      ${node.model ? `<div class="detail-row"><span class="label">Model</span><span class="value">${node.model}</span></div>` : ""}
      <div class="detail-row"><span class="label">Type</span><span class="value">${node.type}</span></div>
      <div class="detail-row"><span class="label">Floor</span><span class="value">${node.floor === 2 ? "Second" : "Ground"}</span></div>`;
    panel.classList.remove("hidden");
    this.shadow.getElementById("close-btn")?.addEventListener("click", () => this.hideDetail());
  }

  private hideDetail() {
    this.shadow.getElementById("detail")?.classList.add("hidden");
    this.selectedNode = null;
  }

  private updateData() {
    if (!this.hass_ || !this.config_) return;
    const newData = this.collectData();
    const newHash = JSON.stringify(newData.nodes.map(n => n.id).sort());

    if (newHash !== this.lastDataHash) {
      this.lastDataHash = newHash;
      this.graphData = newData;
      this.initNodePositions();
      this.dataLoaded = true;
      this.shadow.getElementById("loading")?.classList.add("hidden");
    }
    this.updateStats();
  }

  private initNodePositions() {
    const canvas = this.canvas;
    if (!canvas) return;
    const w = canvas.width / devicePixelRatio;
    const h = canvas.height / devicePixelRatio;

    for (const node of this.graphData.nodes) {
      if (this.nodePositions.has(node.id)) continue;
      const fy = this.getFloorY(node.floor, h);
      const spread = w * 0.35;
      const cx = w / 2;

      // Special positioning for infrastructure
      let x = cx + (Math.random() - 0.5) * spread;
      let y = fy + (Math.random() - 0.5) * 40;

      if (node.type === "internet") { x = cx; y = 35; }
      else if (node.type === "router") { x = cx; y = this.getFloorY(1, h) - 30; }
      else if (node.type === "mesh") { x = cx; y = this.getFloorY(2, h) - 30; }
      else if (node.type === "ha") { x = cx + 80; y = this.getFloorY(1, h) - 30; }
      else if (node.type === "zha-coordinator") { x = cx + 140; y = this.getFloorY(1, h); }

      this.nodePositions.set(node.id, { x, y, vx: 0, vy: 0 });
    }

    // Remove positions for nodes that no longer exist
    for (const id of this.nodePositions.keys()) {
      if (!this.graphData.nodes.find(n => n.id === id)) this.nodePositions.delete(id);
    }
  }

  private updateStats() {
    const wifi = this.graphData.nodes.filter(n => n.type.startsWith("wifi")).length;
    const zigbee = this.graphData.nodes.filter(n => n.type.startsWith("zigbee") || n.type === "zha-coordinator").length;
    const online = this.graphData.nodes.filter(n => n.online && !["internet", "router", "mesh", "ha"].includes(n.type)).length;
    const f1 = this.graphData.nodes.filter(n => n.floor === 1 && !["internet", "router", "mesh", "ha"].includes(n.type)).length;
    const f2 = this.graphData.nodes.filter(n => n.floor === 2).length;
    const el = (id: string) => this.shadow.getElementById(id);
    if (el("s-online")) el("s-online")!.textContent = String(online);
    if (el("s-wifi")) el("s-wifi")!.textContent = String(wifi);
    if (el("s-zigbee")) el("s-zigbee")!.textContent = String(zigbee);
    if (el("s-f1")) el("s-f1")!.textContent = String(f1);
    if (el("s-f2")) el("s-f2")!.textContent = String(f2);
  }

  private collectData(): GraphData {
    const nodes: NetworkNode[] = [];
    const links: NetworkLink[] = [];
    const config = this.config_!;

    nodes.push({ id: "internet", name: "Internet", type: "internet", floor: 0, online: true, val: 4 });
    nodes.push({ id: "router-main", name: config.router_name || "Router", type: "router", floor: 1, ip: "192.168.0.1", online: true, val: 14 });
    links.push({ source: "internet", target: "router-main", strength: 1 });

    if (config.mesh_name) {
      nodes.push({ id: "router-mesh", name: config.mesh_name, type: "mesh", floor: 2, ip: "192.168.0.150", online: true, val: 12 });
      links.push({ source: "router-main", target: "router-mesh", strength: 0.8 });
    }

    nodes.push({ id: "ha", name: "Home Assistant", type: "ha", floor: 1, ip: "192.168.0.185", online: true, val: 10 });
    links.push({ source: "router-main", target: "ha", strength: 1 });

    const entity = this.hass_?.states[config.router_entity || "sensor.connected_clients"];
    const clients = entity?.attributes?.clients || [];
    for (const c of clients) {
      const isOnline = c.online && c.ip !== "0.0.0.0" && c.ip;
      if (!isOnline) continue;
      const mac = c.mac?.toLowerCase();
      const floor = determineFloor({ id: "", name: c.hostname || "", type: "wifi-client", floor: 1, online: true, mac } as NetworkNode, config);
      nodes.push({
        id: `wifi-${mac}`, name: c.hostname || mac, type: "wifi-client",
        floor, ip: c.ip, mac, signal: c.signal, band: c.band, online: true,
        val: NODE_SIZES["wifi-client"],
      });
      const routerTarget = floor === 2 ? "router-mesh" : "router-main";
      const strength = c.signal ? Math.max(0.1, Math.min(1, (c.signal + 90) / 50)) : 0.5;
      links.push({ source: routerTarget, target: `wifi-${mac}`, strength });
    }

    if (this.zhaDevices) {
      const coord = this.zhaDevices.find((d: any) => d.device_type === "Coordinator");
      if (coord) {
        nodes.push({ id: `zha-${coord.ieee}`, name: "ZHA Coordinator", type: "zha-coordinator", floor: 1, manufacturer: coord.manufacturer, model: coord.model, online: true, val: 8 });
        links.push({ source: "ha", target: `zha-${coord.ieee}`, strength: 1 });
      }
      for (const dev of this.zhaDevices) {
        if (dev.device_type === "Coordinator" || dev.available === false) continue;
        const isRouter = dev.device_type === "Router";
        const nodeType = isRouter ? "zigbee-router" as const : "zigbee-enddevice" as const;
        let name = dev.name || dev.model || dev.ieee;
        if (this.haDevices) {
          const haD = this.haDevices.find((d: any) => d.identifiers?.some((id: any[]) => id[1] === dev.ieee));
          if (haD?.name) name = haD.name;
        }
        nodes.push({ id: `zha-${dev.ieee}`, name, type: nodeType, floor: 1, manufacturer: dev.manufacturer, model: dev.model, signal: dev.lqi, online: true, val: NODE_SIZES[nodeType] });
        if (coord) links.push({ source: `zha-${coord.ieee}`, target: `zha-${dev.ieee}`, strength: dev.lqi ? Math.min(1, dev.lqi / 255) : 0.5 });
      }
    }

    return { nodes, links };
  }

  private getSignalClass(n: NetworkNode): string {
    if (!n.signal) return "";
    if (n.type.includes("zigbee")) return n.signal > 200 ? "signal-good" : n.signal > 100 ? "signal-ok" : "signal-weak";
    return n.signal > -50 ? "signal-good" : n.signal > -70 ? "signal-ok" : "signal-weak";
  }
}

const STYLES = `
  :host { display: block; height: 100%; }
  .root { display: flex; flex-direction: column; height: 100vh; background: ${GRAPH_CONFIG.BACKGROUND_COLOR}; }
  .canvas-wrap { flex: 1; position: relative; overflow: hidden; min-height: 0; }
  canvas { display: block; width: 100%; height: 100%; }
  .tooltip { position: absolute; background: rgba(10,10,30,0.92); color: #fff; padding: 8px 12px; border-radius: 8px; font-size: 11px; font-family: system-ui; line-height: 1.5; border: 1px solid rgba(100,150,255,0.25); pointer-events: none; z-index: 20; white-space: nowrap; }
  .tooltip.hidden { display: none; }
  .tooltip b { color: #00e5ff; }
  .detail-panel { position: absolute; top: 12px; right: 12px; width: 260px; background: rgba(10,10,30,0.95); border: 1px solid rgba(100,150,255,0.2); border-radius: 12px; padding: 16px; font-family: system-ui; z-index: 15; }
  .detail-panel.hidden { display: none; }
  .detail-panel h3 { margin: 0 0 10px; color: #00e5ff; font-size: 14px; display: flex; align-items: center; }
  .close-btn { margin-left: auto; cursor: pointer; color: rgba(255,255,255,0.5); font-size: 20px; border: none; background: none; }
  .close-btn:hover { color: #fff; }
  .detail-row { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 12px; }
  .detail-row .label { color: rgba(255,255,255,0.4); }
  .detail-row .value { color: rgba(255,255,255,0.9); font-family: "SF Mono", monospace; font-size: 11px; }
  .signal-good { color: #4caf50 !important; }
  .signal-ok { color: #ff9800 !important; }
  .signal-weak { color: #f44336 !important; }
  .legend { display: flex; gap: 14px; padding: 8px 16px; font-size: 11px; background: rgba(10,10,30,0.5); }
  .legend-item { display: flex; align-items: center; gap: 5px; color: rgba(255,255,255,0.45); }
  .legend-dot { width: 8px; height: 8px; border-radius: 50%; }
  .stats-bar { display: flex; gap: 18px; padding: 10px 16px; background: rgba(10,10,30,0.5); font-size: 13px; color: rgba(255,255,255,0.5); }
  .stat { display: flex; align-items: center; gap: 6px; }
  .stat .count { color: #00e5ff; font-weight: 700; font-size: 16px; }
  .loading { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: rgba(255,255,255,0.4); font-size: 16px; font-family: system-ui; }
  .loading.hidden { display: none; }
  @keyframes pulse { 0%,100% { opacity: 0.4; } 50% { opacity: 1; } }
  .loading { animation: pulse 1.5s infinite; }
`;

customElements.define("network-visualizer-card", NetworkVisualizerCard);
(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({ type: "network-visualizer-card", name: "Network Visualizer", description: "2D home network topology with floor plan", preview: false });
