import { NODE_COLORS, NODE_SIZES, GRAPH_CONFIG } from "./constants";
import type { HomeAssistant, CardConfig, GraphData, NetworkNode, NetworkLink } from "./types";

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

class NetworkVisualizerCard extends HTMLElement {
  private hass_?: HomeAssistant;
  private config_?: CardConfig;
  private graphData: GraphData = { nodes: [], links: [] };
  private selectedNode: NetworkNode | null = null;
  private zhaDevices: any[] | null = null;
  private haDevices: any[] | null = null;
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
  private simTick = 0;

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

  setConfig(config: CardConfig) { this.config_ = { ...config }; this.renderShell(); }
  getCardSize() { return 12; }
  connectedCallback() { this.renderShell(); }
  disconnectedCallback() { if (this.animFrame) cancelAnimationFrame(this.animFrame); }

  private scheduleUpdate() {
    if (this.updateTimeout) clearTimeout(this.updateTimeout);
    this.updateTimeout = window.setTimeout(() => this.updateData(), this.dataLoaded ? 10000 : 500);
  }

  private async fetchZHADevices() {
    if (!this.hass_) return;
    try { this.zhaDevices = await this.hass_.callWS({ type: "zha/devices" }); } catch {}
  }

  private async fetchHADevices() {
    if (!this.hass_) return;
    try { this.haDevices = await this.hass_.callWS({ type: "config/device_registry/list" }); } catch {}
  }

  private renderShell() {
    if (!this.config_) return;
    this.shadow.innerHTML = `<style>${STYLES}</style>
      <div class="root">
        <div class="stats-bar">
          <div class="stat"><span class="count" id="s-online">-</span> online</div>
          <div class="stat"><span class="count" id="s-wifi">-</span> WiFi</div>
          <div class="stat"><span class="count" id="s-zigbee">-</span> Zigbee</div>
        </div>
        <div class="canvas-wrap" id="wrap">
          <canvas id="c"></canvas>
          <div id="tip" class="tip hidden"></div>
          <div id="det" class="det hidden"></div>
          <div id="load" class="load">Connecting to network...</div>
        </div>
        <div class="legend">
          <span class="li"><span class="ld" style="background:${NODE_COLORS.router}"></span>Router</span>
          <span class="li"><span class="ld" style="background:${NODE_COLORS["wifi-client"]}"></span>WiFi</span>
          <span class="li"><span class="ld" style="background:${NODE_COLORS["zha-coordinator"]}"></span>Zigbee</span>
          <span class="li"><span class="ld" style="background:${NODE_COLORS.ha}"></span>HA</span>
        </div>
      </div>`;
    requestAnimationFrame(() => this.initCanvas());
  }

  private initCanvas() {
    const wrap = this.shadow.getElementById("wrap");
    const canvas = this.shadow.getElementById("c") as HTMLCanvasElement;
    if (!wrap || !canvas) return;
    this.canvas = canvas;

    const resize = () => {
      const r = wrap.getBoundingClientRect();
      canvas.width = r.width * devicePixelRatio;
      canvas.height = r.height * devicePixelRatio;
      canvas.style.width = r.width + "px";
      canvas.style.height = r.height + "px";
      // Reposition nodes when resized
      if (this.dataLoaded) this.spreadNodes();
    };
    resize();
    new ResizeObserver(resize).observe(wrap);

    canvas.addEventListener("mousemove", (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouseX = e.clientX - r.left;
      this.mouseY = e.clientY - r.top;
      this.handleHover();
      if (this.dragNode) {
        const p = this.nodePositions.get(this.dragNode.id);
        if (p) { p.x = this.mouseX; p.y = this.mouseY; p.vx = 0; p.vy = 0; }
      }
    });
    canvas.addEventListener("mousedown", () => { if (this.hoverNode) this.dragNode = this.hoverNode; });
    canvas.addEventListener("mouseup", () => {
      if (this.hoverNode) this.showDetail(this.hoverNode);
      else if (!this.dragNode) this.hideDetail();
      this.dragNode = null;
    });
    canvas.addEventListener("mouseleave", () => {
      this.hoverNode = null;
      this.shadow.getElementById("tip")?.classList.add("hidden");
      this.dragNode = null;
    });

    this.animate();
  }

  private animate() {
    this.simTick++;
    if (this.simTick < 300) this.simulationStep(); // Stop simulation after settling
    this.drawFrame();
    this.animFrame = requestAnimationFrame(() => this.animate());
  }

  private simulationStep() {
    const nodes = this.graphData.nodes;
    const links = this.graphData.links;
    if (!this.canvas) return;
    const w = this.canvas.width / devicePixelRatio;
    const h = this.canvas.height / devicePixelRatio;
    const pad = 50;

    for (const node of nodes) {
      const pos = this.nodePositions.get(node.id);
      if (!pos || node.id === this.dragNode?.id) continue;

      let fx = 0, fy = 0;

      // Repulsion
      for (const other of nodes) {
        if (other.id === node.id) continue;
        const op = this.nodePositions.get(other.id);
        if (!op) continue;
        const dx = pos.x - op.x, dy = pos.y - op.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (dist < 150) {
          const f = 200 / (dist * dist);
          fx += (dx / dist) * f;
          fy += (dy / dist) * f;
        }
      }

      // Link attraction
      for (const link of links) {
        const src = typeof link.source === "string" ? link.source : (link.source as any).id;
        const tgt = typeof link.target === "string" ? link.target : (link.target as any).id;
        let oid: string | null = null;
        if (src === node.id) oid = tgt;
        else if (tgt === node.id) oid = src;
        if (!oid) continue;
        const op = this.nodePositions.get(oid);
        if (!op) continue;
        const dx = op.x - pos.x, dy = op.y - pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (dist - 90) * 0.004 * (link.strength || 0.5);
        fx += (dx / dist) * f;
        fy += (dy / dist) * f;
      }

      // Center gravity (mild)
      fx += (w / 2 - pos.x) * 0.001;
      fy += (h / 2 - pos.y) * 0.001;

      // Bounds
      if (pos.x < pad) fx += 2;
      if (pos.x > w - pad) fx -= 2;
      if (pos.y < pad) fy += 2;
      if (pos.y > h - pad) fy -= 2;

      pos.vx = (pos.vx + fx) * 0.8;
      pos.vy = (pos.vy + fy) * 0.8;
      pos.x += pos.vx;
      pos.y += pos.vy;

      // Hard clamp
      pos.x = Math.max(pad, Math.min(w - pad, pos.x));
      pos.y = Math.max(pad, Math.min(h - pad, pos.y));
    }
  }

  private drawFrame() {
    const canvas = this.canvas;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = devicePixelRatio;
    const w = canvas.width / dpr, h = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background
    ctx.fillStyle = GRAPH_CONFIG.BACKGROUND_COLOR;
    ctx.fillRect(0, 0, w, h);

    // Links
    for (const link of this.graphData.links) {
      const src = typeof link.source === "string" ? link.source : (link.source as any).id;
      const tgt = typeof link.target === "string" ? link.target : (link.target as any).id;
      const sp = this.nodePositions.get(src), tp = this.nodePositions.get(tgt);
      if (!sp || !tp) continue;
      const a = 0.06 + (link.strength || 0.5) * 0.12;
      ctx.strokeStyle = `rgba(100,180,255,${a})`;
      ctx.lineWidth = 0.5 + (link.strength || 0.5) * 1;
      ctx.beginPath();
      ctx.moveTo(sp.x, sp.y);
      ctx.lineTo(tp.x, tp.y);
      ctx.stroke();
    }

    // Nodes (draw smaller nodes first, then larger on top)
    const sorted = [...this.graphData.nodes].sort((a, b) => (a.val || 5) - (b.val || 5));
    for (const node of sorted) {
      const pos = this.nodePositions.get(node.id);
      if (!pos) continue;
      this.drawNode(ctx, node, pos.x, pos.y);
    }
  }

  private drawNode(ctx: CanvasRenderingContext2D, node: NetworkNode, x: number, y: number) {
    const baseSize = NODE_SIZES[node.type] || 5;
    const size = baseSize * 1.8;
    const color = NODE_COLORS[node.type] || "#42a5f5";
    const icon = getDeviceIcon(node);
    const isHov = this.hoverNode?.id === node.id;
    const isSel = this.selectedNode?.id === node.id;

    // Glow
    if (isHov || isSel) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 15;
    }

    // Circle
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = isHov ? 1 : 0.8;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = isSel ? "#fff" : "rgba(255,255,255,0.15)";
    ctx.lineWidth = isSel ? 2.5 : 0.8;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Icon
    const iconSize = Math.max(12, size * 1.0);
    ctx.font = `${iconSize}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff";
    ctx.fillText(icon, x, y);

    // Label
    const fontSize = Math.max(8, Math.min(11, size * 0.5));
    ctx.font = `${fontSize}px system-ui, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const maxLen = 14;
    const label = (node.name || "").length > maxLen ? (node.name || "").substring(0, maxLen - 1) + "…" : (node.name || "");
    ctx.fillText(label, x, y + size + 3);

    // Reset
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
  }

  private handleHover() {
    let closest: NetworkNode | null = null;
    let closestDist = 999;
    for (const node of this.graphData.nodes) {
      const pos = this.nodePositions.get(node.id);
      if (!pos) continue;
      const dx = this.mouseX - pos.x, dy = this.mouseY - pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const hitR = (NODE_SIZES[node.type] || 5) * 1.8 + 8;
      if (dist < hitR && dist < closestDist) { closest = node; closestDist = dist; }
    }
    this.hoverNode = closest;
    const tip = this.shadow.getElementById("tip");
    if (!tip) return;

    if (closest) {
      const lines = [`<b>${closest.name}</b>`];
      if (closest.ip) lines.push(`${closest.ip}`);
      if (closest.signal !== undefined) lines.push(`${closest.signal}${closest.type.includes("zigbee") ? " LQI" : " dBm"}`);
      if (closest.band) lines.push(closest.band.replace("HOST_", ""));
      tip.innerHTML = lines.join(" &middot; ");

      // Position near the node, not the cursor
      const pos = this.nodePositions.get(closest.id)!;
      const nodeSize = (NODE_SIZES[closest.type] || 5) * 1.8;
      tip.style.left = (pos.x + nodeSize + 10) + "px";
      tip.style.top = (pos.y - 12) + "px";
      tip.classList.remove("hidden");
      this.canvas!.style.cursor = "pointer";
    } else {
      tip.classList.add("hidden");
      this.canvas!.style.cursor = "default";
    }
  }

  private showDetail(node: NetworkNode) {
    const panel = this.shadow.getElementById("det");
    if (!panel) return;
    this.selectedNode = node;
    const sc = this.getSignalClass(node);
    panel.innerHTML = `
      <h3>${node.name}<button id="xbtn" class="xbtn">&times;</button></h3>
      ${[
        node.ip && ["IP", node.ip],
        node.mac && ["MAC", node.mac],
        node.signal !== undefined && [node.type.includes("zigbee") ? "LQI" : "Signal", `<span class="${sc}">${node.signal}${node.type.includes("zigbee") ? "" : " dBm"}</span>`],
        node.band && ["Band", node.band.replace("HOST_", "")],
        node.manufacturer && ["Vendor", node.manufacturer],
        node.model && ["Model", node.model],
        ["Type", node.type],
      ].filter(Boolean).map(([l, v]) => `<div class="dr"><span class="dl">${l}</span><span class="dv">${v}</span></div>`).join("")}`;
    panel.classList.remove("hidden");
    this.shadow.getElementById("xbtn")?.addEventListener("click", () => this.hideDetail());
  }

  private hideDetail() {
    this.shadow.getElementById("det")?.classList.add("hidden");
    this.selectedNode = null;
  }

  private updateData() {
    if (!this.hass_ || !this.config_) return;
    const newData = this.collectData();
    const newHash = JSON.stringify(newData.nodes.map(n => n.id).sort());
    if (newHash !== this.lastDataHash) {
      this.lastDataHash = newHash;
      this.graphData = newData;
      this.spreadNodes();
      this.simTick = 0; // Restart simulation
      this.dataLoaded = true;
      this.shadow.getElementById("load")?.classList.add("hidden");
    }
    this.updateStats();
  }

  private spreadNodes() {
    if (!this.canvas) return;
    const w = this.canvas.width / devicePixelRatio;
    const h = this.canvas.height / devicePixelRatio;
    const cx = w / 2, cy = h / 2;

    // Place router at center, others in a circle around it
    const infra = this.graphData.nodes.filter(n => ["router", "mesh", "ha", "internet"].includes(n.type));
    const clients = this.graphData.nodes.filter(n => !["router", "mesh", "ha", "internet"].includes(n.type));

    // Infrastructure
    for (const node of infra) {
      if (this.nodePositions.has(node.id)) continue;
      let x = cx, y = cy;
      if (node.type === "internet") { x = cx; y = 40; }
      else if (node.type === "router") { x = cx; y = cy; }
      else if (node.type === "mesh") { x = cx + 100; y = cy - 60; }
      else if (node.type === "ha") { x = cx - 100; y = cy - 60; }
      this.nodePositions.set(node.id, { x, y, vx: 0, vy: 0 });
    }

    // Clients in a ring around the router
    const radius = Math.min(w, h) * 0.32;
    let i = 0;
    for (const node of clients) {
      if (this.nodePositions.has(node.id)) continue;
      const angle = (i / clients.length) * Math.PI * 2 - Math.PI / 2;
      const r = radius + (Math.random() - 0.5) * radius * 0.4;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      this.nodePositions.set(node.id, { x, y, vx: 0, vy: 0 });
      i++;
    }

    // Clean old
    for (const id of this.nodePositions.keys()) {
      if (!this.graphData.nodes.find(n => n.id === id)) this.nodePositions.delete(id);
    }
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
    const config = this.config_!;

    nodes.push({ id: "internet", name: "Internet", type: "internet", floor: 0, online: true, val: 5 });
    nodes.push({ id: "router", name: config.router_name || "Router", type: "router", floor: 1, ip: "192.168.0.1", online: true, val: 16 });
    links.push({ source: "internet", target: "router", strength: 1 });

    if (config.mesh_name) {
      nodes.push({ id: "mesh", name: config.mesh_name, type: "mesh", floor: 2, ip: "192.168.0.150", online: true, val: 13 });
      links.push({ source: "router", target: "mesh", strength: 0.8 });
    }

    nodes.push({ id: "ha", name: "Home Assistant", type: "ha", floor: 1, ip: "192.168.0.185", online: true, val: 12 });
    links.push({ source: "router", target: "ha", strength: 1 });

    const entity = this.hass_?.states[config.router_entity || "sensor.connected_clients"];
    for (const c of (entity?.attributes?.clients || [])) {
      if (!c.online || c.ip === "0.0.0.0" || !c.ip) continue;
      const mac = c.mac?.toLowerCase();
      nodes.push({
        id: `w-${mac}`, name: c.hostname || mac, type: "wifi-client",
        floor: 1, ip: c.ip, mac, signal: c.signal, band: c.band, online: true, val: 6,
      });
      links.push({ source: "router", target: `w-${mac}`, strength: c.signal ? Math.max(0.1, Math.min(1, (c.signal + 90) / 50)) : 0.5 });
    }

    if (this.zhaDevices) {
      const coord = this.zhaDevices.find((d: any) => d.device_type === "Coordinator");
      if (coord) {
        nodes.push({ id: `z-${coord.ieee}`, name: "ZHA Coordinator", type: "zha-coordinator", floor: 1, manufacturer: coord.manufacturer, model: coord.model, online: true, val: 8 });
        links.push({ source: "ha", target: `z-${coord.ieee}`, strength: 1 });
      }
      for (const dev of this.zhaDevices) {
        if (dev.device_type === "Coordinator" || dev.available === false) continue;
        let name = dev.name || dev.model || dev.ieee;
        if (this.haDevices) {
          const haD = this.haDevices.find((d: any) => d.identifiers?.some((id: any[]) => id[1] === dev.ieee));
          if (haD?.name) name = haD.name;
        }
        const t = dev.device_type === "Router" ? "zigbee-router" as const : "zigbee-enddevice" as const;
        nodes.push({ id: `z-${dev.ieee}`, name, type: t, floor: 1, manufacturer: dev.manufacturer, model: dev.model, signal: dev.lqi, online: true, val: 5 });
        if (coord) links.push({ source: `z-${coord.ieee}`, target: `z-${dev.ieee}`, strength: dev.lqi ? Math.min(1, dev.lqi / 255) : 0.5 });
      }
    }
    return { nodes, links };
  }

  private getSignalClass(n: NetworkNode): string {
    if (!n.signal) return "";
    if (n.type.includes("zigbee")) return n.signal > 200 ? "sg" : n.signal > 100 ? "so" : "sw";
    return n.signal > -50 ? "sg" : n.signal > -70 ? "so" : "sw";
  }
}

const STYLES = `
  :host { display: block; height: 100%; }
  .root { display: flex; flex-direction: column; height: calc(100vh - 56px); background: ${GRAPH_CONFIG.BACKGROUND_COLOR}; }
  .canvas-wrap { flex: 1; position: relative; overflow: hidden; min-height: 0; }
  canvas { display: block; width: 100%; height: 100%; }
  .tip { position: absolute; background: rgba(8,8,25,0.92); color: #ccc; padding: 6px 10px; border-radius: 6px; font-size: 11px; font-family: system-ui; line-height: 1.4; border: 1px solid rgba(100,150,255,0.2); pointer-events: none; z-index: 20; white-space: nowrap; }
  .tip.hidden { display: none; }
  .tip b { color: #00e5ff; }
  .det { position: absolute; top: 8px; right: 8px; width: 240px; background: rgba(8,8,25,0.95); border: 1px solid rgba(100,150,255,0.2); border-radius: 10px; padding: 14px; font-family: system-ui; z-index: 15; }
  .det.hidden { display: none; }
  .det h3 { margin: 0 0 8px; color: #00e5ff; font-size: 13px; display: flex; align-items: center; gap: 4px; }
  .xbtn { margin-left: auto; cursor: pointer; color: rgba(255,255,255,0.4); font-size: 18px; border: none; background: none; line-height: 1; }
  .xbtn:hover { color: #fff; }
  .dr { display: flex; justify-content: space-between; padding: 3px 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 11px; }
  .dl { color: rgba(255,255,255,0.35); }
  .dv { color: rgba(255,255,255,0.85); font-family: "SF Mono", monospace; font-size: 10px; }
  .sg { color: #4caf50 !important; }
  .so { color: #ff9800 !important; }
  .sw { color: #f44336 !important; }
  .legend { display: flex; gap: 14px; padding: 6px 16px; font-size: 10px; background: rgba(8,8,25,0.5); }
  .li { display: flex; align-items: center; gap: 4px; color: rgba(255,255,255,0.4); }
  .ld { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
  .stats-bar { display: flex; gap: 16px; padding: 8px 16px; background: rgba(8,8,25,0.5); font-size: 12px; color: rgba(255,255,255,0.45); }
  .stat { display: flex; align-items: center; gap: 5px; }
  .stat .count { color: #00e5ff; font-weight: 700; font-size: 15px; }
  .load { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); color: rgba(255,255,255,0.35); font-size: 15px; font-family: system-ui; animation: pulse 1.5s infinite; }
  .load.hidden { display: none; }
  @keyframes pulse { 0%,100% { opacity: 0.3; } 50% { opacity: 0.8; } }
`;

customElements.define("network-visualizer-card", NetworkVisualizerCard);
(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({ type: "network-visualizer-card", name: "Network Visualizer", description: "2D network topology", preview: false });
