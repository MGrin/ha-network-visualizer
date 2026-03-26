import { NODE_COLORS, NODE_SIZES, GRAPH_CONFIG } from "./constants";
import type { HomeAssistant, CardConfig, GraphData, NetworkNode, NetworkLink } from "./types";

const ICONS: Record<string, string> = {
  router: "📡", mesh: "📶", ha: "🏠", internet: "🌐",
  "zha-coordinator": "⬡", "zigbee-router": "⬡", "zigbee-enddevice": "⬡",
  iphone: "📱", ipad: "📱", macbook: "💻", mac: "💻",
  switch: "💡", light: "💡", lamp: "💡", led: "💡",
  plug: "🔌", socket: "🔌", speaker: "🔊", alica: "🔊", yandex: "🔊",
  vacuum: "🤖", robot: "🤖", sensor: "🌡️", remote: "📺",
  camera: "📷", doorbell: "🔔", xiaomi: "📱", default: "●",
};

function icon(n: NetworkNode): string {
  const nm = (n.name || "").toLowerCase();
  for (const [k, v] of Object.entries(ICONS)) { if (k !== "default" && nm.includes(k)) return v; }
  if (n.type.includes("zigbee") || n.type.includes("zha")) return "⬡";
  return ICONS[n.type] || ICONS.default;
}

function fmtBytes(b: number): string {
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
  if (b < 1073741824) return (b / 1048576).toFixed(1) + " MB";
  return (b / 1073741824).toFixed(2) + " GB";
}

function fmtBand(b: string): string { return (b || "").replace("HOST_", "").replace("WIRED", "Wired"); }

function fmtSignal(n: NetworkNode): string {
  if (n.band === "WIRED" || n.type === "ha") return "🔗 Wired";
  if (n.type === "router" || n.type === "mesh" || n.type === "internet") return "-";
  if (n.type.includes("zigbee") || n.type.includes("zha")) {
    const lqi = n.signal;
    const rssi = (n as any).rssi;
    if (lqi != null && lqi > 0) return `${lqi} LQI`;
    if (rssi != null && rssi !== 0) return `${rssi} dBm`;
    return "n/a";
  }
  if (n.signal != null) return `${n.signal} dBm`;
  return "-";
}

type ViewMode = "graph" | "table";

class NetworkVisualizerCard extends HTMLElement {
  private h?: HomeAssistant;
  private cfg?: CardConfig;
  private data: GraphData = { nodes: [], links: [] };
  private sel: NetworkNode | null = null;
  private zha: any[] | null = null;
  private haD: any[] | null = null;
  private ut: number | null = null;
  private lh = "";
  private shadow: ShadowRoot;
  private cv?: HTMLCanvasElement;
  private af?: number;
  private np = new Map<string, { x: number; y: number; vx: number; vy: number }>();
  private dn: NetworkNode | null = null;
  private mx = 0; private my = 0;
  private hn: NetworkNode | null = null;
  private loaded = false;
  private st = 0;
  // Zoom/pan
  private camX = 0; private camY = 0; private zoom = 1;
  private isPan = false; private panStartX = 0; private panStartY = 0;
  private camStartX = 0; private camStartY = 0;
  // View
  private view: ViewMode = "table";
  private sortCol = "name"; private sortAsc = true;

  constructor() { super(); this.shadow = this.attachShadow({ mode: "open" }); }

  set hass(hass: HomeAssistant) {
    this.h = hass;
    if (!this.zha) this.fetchZHA();
    if (!this.haD) this.fetchHAD();
    this.schedUp();
  }

  setConfig(c: CardConfig) { this.cfg = { ...c }; this.shell(); }
  getCardSize() { return 12; }
  connectedCallback() { this.shell(); }
  disconnectedCallback() { if (this.af) cancelAnimationFrame(this.af); }

  private schedUp() {
    if (this.ut) clearTimeout(this.ut);
    this.ut = window.setTimeout(() => this.upd(), this.loaded ? 10000 : 500);
  }

  private async fetchZHA() { if (!this.h) return; try { this.zha = await this.h.callWS({ type: "zha/devices" }); } catch {} }
  private async fetchHAD() { if (!this.h) return; try { this.haD = await this.h.callWS({ type: "config/device_registry/list" }); } catch {} }

  private shell() {
    if (!this.cfg) return;
    this.shadow.innerHTML = `<style>${CSS}</style>
    <div class="root">
      <div class="bar">
        <div class="tabs">
          <button class="tab ${this.view === "graph" ? "active" : ""}" data-v="graph">Graph</button>
          <button class="tab ${this.view === "table" ? "active" : ""}" data-v="table">Table</button>
        </div>
        <div class="stats">
          <span class="st"><b id="s-on">-</b> online</span>
          <span class="st"><b id="s-wi">-</b> WiFi</span>
          <span class="st"><b id="s-zb">-</b> Zigbee</span>
        </div>
      </div>
      <div class="body">
        <div id="gv" class="gv ${this.view === "graph" ? "" : "hid"}">
          <canvas id="c"></canvas>
          <div id="tip" class="tip hid"></div>
          <div id="det" class="det hid"></div>
          <div id="ld" class="ld">Connecting to network...</div>
        </div>
        <div id="tv" class="tv ${this.view === "table" ? "" : "hid"}"></div>
      </div>
      <div class="leg">
        <span class="li"><span class="ld2" style="background:${NODE_COLORS.router}"></span>Router</span>
        <span class="li"><span class="ld2" style="background:${NODE_COLORS["wifi-client"]}"></span>WiFi</span>
        <span class="li"><span class="ld2" style="background:${NODE_COLORS["zha-coordinator"]}"></span>Zigbee</span>
        <span class="li"><span class="ld2" style="background:${NODE_COLORS.ha}"></span>HA</span>
      </div>
    </div>`;

    // Tab switching
    this.shadow.querySelectorAll(".tab").forEach(btn => {
      btn.addEventListener("click", () => {
        this.view = (btn as HTMLElement).dataset.v as ViewMode;
        this.shadow.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", (b as HTMLElement).dataset.v === this.view));
        this.shadow.getElementById("gv")?.classList.toggle("hid", this.view !== "graph");
        this.shadow.getElementById("tv")?.classList.toggle("hid", this.view !== "table");
        if (this.view === "table") this.renderTable();
      });
    });

    requestAnimationFrame(() => this.initCV());
  }

  private initCV() {
    const wrap = this.shadow.getElementById("gv");
    const cv = this.shadow.getElementById("c") as HTMLCanvasElement;
    if (!wrap || !cv) return;
    this.cv = cv;

    const resize = () => {
      const r = wrap.getBoundingClientRect();
      cv.width = r.width * devicePixelRatio;
      cv.height = r.height * devicePixelRatio;
      cv.style.width = r.width + "px";
      cv.style.height = r.height + "px";
      if (this.loaded) this.spread();
    };
    resize();
    new ResizeObserver(resize).observe(wrap);

    // Mouse: world coords
    const toWorld = (cx: number, cy: number) => ({
      x: (cx - this.camX) / this.zoom,
      y: (cy - this.camY) / this.zoom
    });

    cv.addEventListener("mousemove", (e) => {
      const r = cv.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      if (this.isPan && !this.dn) {
        this.camX = this.camStartX + (sx - this.panStartX);
        this.camY = this.camStartY + (sy - this.panStartY);
        return;
      }
      const w = toWorld(sx, sy);
      this.mx = w.x; this.my = w.y;
      this.hover();
      if (this.dn) {
        const p = this.np.get(this.dn.id);
        if (p) { p.x = w.x; p.y = w.y; p.vx = 0; p.vy = 0; }
      }
    });
    cv.addEventListener("mousedown", (e) => {
      const r = cv.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      if (this.hn) { this.dn = this.hn; }
      else { this.isPan = true; this.panStartX = sx; this.panStartY = sy; this.camStartX = this.camX; this.camStartY = this.camY; }
    });
    cv.addEventListener("mouseup", () => {
      if (this.hn && !this.isPan) this.showDet(this.hn);
      else if (!this.dn && !this.isPan) this.hideDet();
      this.dn = null; this.isPan = false;
    });
    cv.addEventListener("mouseleave", () => {
      this.hn = null; this.shadow.getElementById("tip")?.classList.add("hid");
      this.dn = null; this.isPan = false;
    });
    cv.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      const oldZ = this.zoom;
      this.zoom *= e.deltaY < 0 ? 1.1 : 0.9;
      this.zoom = Math.max(0.3, Math.min(5, this.zoom));
      // Zoom towards cursor
      this.camX = sx - (sx - this.camX) * (this.zoom / oldZ);
      this.camY = sy - (sy - this.camY) * (this.zoom / oldZ);
    }, { passive: false });

    this.anim();
  }

  private anim() {
    if (this.view === "graph") {
      this.st++;
      if (this.st < 300) this.sim();
      this.draw();
    }
    this.af = requestAnimationFrame(() => this.anim());
  }

  private sim() {
    const nodes = this.data.nodes, links = this.data.links;
    if (!this.cv) return;
    const w = this.cv.width / devicePixelRatio / this.zoom;
    const h = this.cv.height / devicePixelRatio / this.zoom;

    for (const node of nodes) {
      const p = this.np.get(node.id);
      if (!p || node.id === this.dn?.id) continue;
      let fx = 0, fy = 0;
      for (const o of nodes) {
        if (o.id === node.id) continue;
        const op = this.np.get(o.id); if (!op) continue;
        const dx = p.x - op.x, dy = p.y - op.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        if (d < 150) { const f = 200 / (d * d); fx += (dx / d) * f; fy += (dy / d) * f; }
      }
      for (const l of links) {
        const s = typeof l.source === "string" ? l.source : (l.source as any).id;
        const t = typeof l.target === "string" ? l.target : (l.target as any).id;
        let oid: string | null = null;
        if (s === node.id) oid = t; else if (t === node.id) oid = s;
        if (!oid) continue;
        const op = this.np.get(oid); if (!op) continue;
        const dx = op.x - p.x, dy = op.y - p.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - 90) * 0.004 * (l.strength || 0.5);
        fx += (dx / d) * f; fy += (dy / d) * f;
      }
      fx += (w / 2 - p.x) * 0.001; fy += (h / 2 - p.y) * 0.001;
      p.vx = (p.vx + fx) * 0.8; p.vy = (p.vy + fy) * 0.8;
      p.x += p.vx; p.y += p.vy;
    }
  }

  private draw() {
    const cv = this.cv; if (!cv) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    const dpr = devicePixelRatio;
    const w = cv.width / dpr, h = cv.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = GRAPH_CONFIG.BACKGROUND_COLOR;
    ctx.fillRect(0, 0, w, h);

    // Apply camera transform
    ctx.save();
    ctx.translate(this.camX, this.camY);
    ctx.scale(this.zoom, this.zoom);

    // Links
    for (const l of this.data.links) {
      const s = typeof l.source === "string" ? l.source : (l.source as any).id;
      const t = typeof l.target === "string" ? l.target : (l.target as any).id;
      const sp = this.np.get(s), tp = this.np.get(t);
      if (!sp || !tp) continue;
      ctx.strokeStyle = `rgba(100,180,255,${0.06 + (l.strength || 0.5) * 0.12})`;
      ctx.lineWidth = (0.5 + (l.strength || 0.5) * 1) / this.zoom;
      ctx.beginPath(); ctx.moveTo(sp.x, sp.y); ctx.lineTo(tp.x, tp.y); ctx.stroke();
    }

    // Nodes
    const sorted = [...this.data.nodes].sort((a, b) => (a.val || 5) - (b.val || 5));
    for (const node of sorted) {
      const p = this.np.get(node.id); if (!p) continue;
      const sz = (NODE_SIZES[node.type] || 5) * 1.8;
      const col = NODE_COLORS[node.type] || "#42a5f5";
      const isH = this.hn?.id === node.id, isS = this.sel?.id === node.id;
      if (isH || isS) { ctx.shadowColor = col; ctx.shadowBlur = 15 / this.zoom; }
      ctx.beginPath(); ctx.arc(p.x, p.y, sz, 0, Math.PI * 2);
      ctx.fillStyle = col; ctx.globalAlpha = isH ? 1 : 0.8; ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = isS ? "#fff" : "rgba(255,255,255,0.15)";
      ctx.lineWidth = (isS ? 2.5 : 0.8) / this.zoom; ctx.stroke(); ctx.shadowBlur = 0;

      const isz = Math.max(12, sz * 1.0);
      ctx.font = `${isz}px serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = "#fff"; ctx.fillText(icon(node), p.x, p.y);

      const fsz = Math.max(8, Math.min(11, sz * 0.5));
      ctx.font = `${fsz}px system-ui`; ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      const lbl = (node.name || "").length > 16 ? (node.name || "").substring(0, 14) + "…" : (node.name || "");
      ctx.fillText(lbl, p.x, p.y + sz + 3);
      ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
    }
    ctx.restore();

    // Zoom indicator
    if (this.zoom !== 1) {
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.font = "11px system-ui";
      ctx.fillText(`${Math.round(this.zoom * 100)}%`, w - 45, h - 10);
    }
  }

  private hover() {
    let closest: NetworkNode | null = null, cd = 999;
    for (const n of this.data.nodes) {
      const p = this.np.get(n.id); if (!p) continue;
      const d = Math.sqrt((this.mx - p.x) ** 2 + (this.my - p.y) ** 2);
      const hr = (NODE_SIZES[n.type] || 5) * 1.8 + 8;
      if (d < hr && d < cd) { closest = n; cd = d; }
    }
    this.hn = closest;
    const tip = this.shadow.getElementById("tip"); if (!tip) return;
    if (closest) {
      const lines = [`<b>${closest.name}</b>`];
      if (closest.ip) lines.push(closest.ip);
      const sig = fmtSignal(closest);
      if (sig !== "-") lines.push(sig);
      if (closest.band && closest.band !== "WIRED") lines.push(fmtBand(closest.band));
      tip.innerHTML = lines.join(" &middot; ");
      const p = this.np.get(closest.id)!;
      const sz = (NODE_SIZES[closest.type] || 5) * 1.8;
      tip.style.left = (p.x * this.zoom + this.camX + sz * this.zoom + 10) + "px";
      tip.style.top = (p.y * this.zoom + this.camY - 12) + "px";
      tip.classList.remove("hid");
      this.cv!.style.cursor = "pointer";
    } else { tip.classList.add("hid"); this.cv!.style.cursor = this.isPan ? "grabbing" : "grab"; }
  }

  private showDet(n: NetworkNode) {
    const p = this.shadow.getElementById("det"); if (!p) return;
    this.sel = n;
    // Gather ALL info
    const rows: [string, string][] = [];
    if (n.ip) rows.push(["IP Address", n.ip]);
    if (n.mac) rows.push(["MAC Address", n.mac]);
    const sigStr = fmtSignal(n);
    if (sigStr !== "-") rows.push(["Connection", `<span class="${this.sc(n)}">${sigStr}</span>`]);
    if (n.band && n.band !== "WIRED") rows.push(["WiFi Band", fmtBand(n.band)]);
    if ((n as any).rssi != null && (n as any).rssi !== 0) rows.push(["RSSI", `${(n as any).rssi} dBm`]);
    if (n.manufacturer) rows.push(["Manufacturer", n.manufacturer]);
    if (n.model) rows.push(["Model", n.model]);
    rows.push(["Network Type", n.type]);
    // Extra data from raw client
    if ((n as any).traffic) rows.push(["Total Traffic", fmtBytes((n as any).traffic)]);
    if ((n as any).upSpeed) rows.push(["Upload Speed", fmtBytes((n as any).upSpeed) + "/s"]);
    if ((n as any).downSpeed) rows.push(["Download Speed", fmtBytes((n as any).downSpeed) + "/s"]);
    if ((n as any).onlineTime) rows.push(["Online Duration", Math.round((n as any).onlineTime / 3600) + "h " + Math.round(((n as any).onlineTime % 3600) / 60) + "m"]);
    if ((n as any).haArea) rows.push(["HA Area", (n as any).haArea]);
    if ((n as any).haEntities?.length) rows.push(["HA Entities", (n as any).haEntities.join(", ")]);

    p.innerHTML = `<h3>${icon(n)} ${n.name}<button id="xb" class="xb">&times;</button></h3>
      ${rows.map(([l, v]) => `<div class="dr"><span class="dl">${l}</span><span class="dv">${v}</span></div>`).join("")}`;
    p.classList.remove("hid");
    this.shadow.getElementById("xb")?.addEventListener("click", () => this.hideDet());
  }

  private hideDet() { this.shadow.getElementById("det")?.classList.add("hid"); this.sel = null; }

  // Known DHCP-reserved MACs (from device-mapping.md)
  // Known devices with DHCP reservations (smart home + personal devices)
  private knownMACs = new Set([
    // Smart home devices (from device-mapping.md)
    "d8-d6-68-43-68-3f", "b8-06-0d-18-b3-b5", "b8-06-0d-78-e9-69",
    "38-a5-c9-9c-f3-e4", "3c-0b-59-8e-f5-b5", "3c-0b-59-8e-bd-11",
    "e0-98-06-a6-87-38", "e0-98-06-a6-8b-d3", "70-4a-0e-0c-20-36",
    "ac-ba-c0-02-5d-38", "38-2c-e5-55-47-e4", "f8-17-2d-bb-2e-e6",
    "dc-ed-83-d3-24-9f", "2c-cf-67-2a-57-f0", "68-7f-f0-5f-56-24",
    // Personal devices (private/randomized WiFi MACs)
    "b8-01-1f-25-7d-e7", // iPhone 17 Pro Valeriia
    "28-8f-f6-30-c4-36", // iPhone 14 Pro Valeriia
    "fe-bf-05-f2-7a-fe", // MacBook Air M2 Valeriia
    "8c-33-96-7e-90-13", // iPhone 16e Nikita
    "a6-27-34-5f-05-c1", // MacBook Air M4 Nikita
    "7a-f6-c3-5a-a2-f4", // Xiaomi 12 Pro
  ]);

  private isKnownDevice(n: NetworkNode): boolean {
    if (!n.mac) return true; // Infrastructure nodes are "known"
    return this.knownMACs.has(n.mac.toLowerCase());
  }

  private getGroup(n: NetworkNode): string {
    if (n.type === "router" || n.type === "mesh" || n.type === "ha" || n.type === "internet") return "infra";
    if (n.band === "WIRED") return "wired";
    if (n.band?.includes("5G")) return "5g";
    if (n.band?.includes("2G")) return "2g";
    if (n.type.includes("zigbee") || n.type.includes("zha")) return "zigbee";
    return "other";
  }

  // TABLE VIEW
  private renderTable() {
    const tv = this.shadow.getElementById("tv"); if (!tv) return;
    const clients = this.data.nodes.filter(n => !["internet"].includes(n.type));

    const groups: [string, string, string, NetworkNode[]][] = [
      ["wired", "🔗 Wired", "#4caf50", []],
      ["5g", "📶 WiFi 5GHz", "#42a5f5", []],
      ["2g", "📡 WiFi 2.4GHz", "#ff9800", []],
      ["zigbee", "⬡ Zigbee", "#9c27b0", []],
      ["infra", "🏗️ Infrastructure", "#00e5ff", []],
      ["other", "❓ Other", "#888", []],
    ];

    for (const n of clients) {
      const g = this.getGroup(n);
      const group = groups.find(([id]) => id === g);
      if (group) group[3].push(n);
    }

    // Sort within each group
    for (const [,,,nodes] of groups) {
      nodes.sort((a, b) => {
        let va: any = (a as any)[this.sortCol] ?? "";
        let vb: any = (b as any)[this.sortCol] ?? "";
        if (typeof va === "number" && typeof vb === "number") return this.sortAsc ? va - vb : vb - va;
        return this.sortAsc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
      });
    }

    const cols: [string, string, (n: NetworkNode) => string][] = [
      ["", "icon", n => icon(n)],
      ["Name", "name", n => n.name || "-"],
      ["IP", "ip", n => n.ip || "-"],
      ["MAC", "mac", n => n.mac || "-"],
      ["Signal", "signal", n => fmtSignal(n)],
      ["Type", "type", n => n.type],
      ["Traffic", "traffic", n => (n as any).traffic ? fmtBytes((n as any).traffic) : "-"],
      ["↓ Speed", "downSpeed", n => (n as any).downSpeed ? fmtBytes((n as any).downSpeed) + "/s" : "-"],
      ["↑ Speed", "upSpeed", n => (n as any).upSpeed ? fmtBytes((n as any).upSpeed) + "/s" : "-"],
      ["Online", "onlineTime", n => (n as any).onlineTime ? Math.round((n as any).onlineTime / 3600) + "h" : "-"],
      ["HA Area", "haArea", n => (n as any).haArea || "-"],
    ];

    let html = `<table><thead><tr>${cols.map(([label, key]) =>
      `<th data-col="${key}" class="${this.sortCol === key ? "sorted" : ""}">${label}${this.sortCol === key ? (this.sortAsc ? " ▲" : " ▼") : ""}</th>`
    ).join("")}</tr></thead>`;

    for (const [gid, gLabel, gColor, nodes] of groups) {
      if (nodes.length === 0) continue;
      html += `<tbody><tr class="group-header"><td colspan="${cols.length}"><span class="gh-dot" style="background:${gColor}"></span>${gLabel} <span class="gh-count">${nodes.length}</span></td></tr>`;
      for (const n of nodes) {
        const sigClass = this.sc(n);
        const isUnknown = !this.isKnownDevice(n);
        const rowClass = [
          this.sel?.id === n.id ? "sel" : "",
          isUnknown ? "unknown-device" : "",
        ].filter(Boolean).join(" ");
        html += `<tr class="${rowClass}" data-id="${n.id}">${cols.map(([, key, fn]) => {
          const v = fn(n);
          const cls = key === "signal" ? sigClass : "";
          return `<td class="${cls}">${v}</td>`;
        }).join("")}</tr>`;
      }
      html += `</tbody>`;
    }
    html += `</table>`;
    tv.innerHTML = html;

    // Sort on header click
    tv.querySelectorAll("th").forEach(th => {
      th.addEventListener("click", () => {
        const col = th.dataset.col!;
        if (this.sortCol === col) this.sortAsc = !this.sortAsc;
        else { this.sortCol = col; this.sortAsc = true; }
        this.renderTable();
      });
    });

    // Row click for detail
    tv.querySelectorAll("tr[data-id]").forEach(tr => {
      tr.addEventListener("click", () => {
        const n = this.data.nodes.find(n => n.id === (tr as HTMLElement).dataset.id);
        if (n) { this.sel = n; this.renderTable(); }
      });
    });
  }

  private upd() {
    if (!this.h || !this.cfg) return;
    const nd = this.collect();
    const nh = JSON.stringify(nd.nodes.map(n => n.id).sort());
    if (nh !== this.lh) {
      this.lh = nh; this.data = nd;
      this.spread(); this.st = 0;
      this.loaded = true;
      this.shadow.getElementById("ld")?.classList.add("hid");
      if (this.view === "table") this.renderTable();
    }
    this.upStats();
  }

  private spread() {
    if (!this.cv) return;
    const w = this.cv.width / devicePixelRatio;
    const h = this.cv.height / devicePixelRatio;
    const cx = w / 2, cy = h / 2;
    const infra = this.data.nodes.filter(n => ["router", "mesh", "ha", "internet"].includes(n.type));
    const clients = this.data.nodes.filter(n => !["router", "mesh", "ha", "internet"].includes(n.type));

    for (const n of infra) {
      if (this.np.has(n.id)) continue;
      let x = cx, y = cy;
      if (n.type === "internet") { x = cx; y = 40; }
      else if (n.type === "router") { x = cx; y = cy; }
      else if (n.type === "mesh") { x = cx + 100; y = cy - 60; }
      else if (n.type === "ha") { x = cx - 100; y = cy - 60; }
      this.np.set(n.id, { x, y, vx: 0, vy: 0 });
    }
    const rad = Math.min(w, h) * 0.32;
    let i = 0;
    for (const n of clients) {
      if (this.np.has(n.id)) continue;
      const a = (i / clients.length) * Math.PI * 2 - Math.PI / 2;
      const r = rad + (Math.random() - 0.5) * rad * 0.4;
      this.np.set(n.id, { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, vx: 0, vy: 0 });
      i++;
    }
    for (const id of this.np.keys()) { if (!this.data.nodes.find(n => n.id === id)) this.np.delete(id); }
  }

  private upStats() {
    const wi = this.data.nodes.filter(n => n.type.startsWith("wifi")).length;
    const zb = this.data.nodes.filter(n => n.type.startsWith("zigbee") || n.type === "zha-coordinator").length;
    const on = this.data.nodes.filter(n => n.online && !["internet", "router", "mesh", "ha"].includes(n.type)).length;
    const e = (id: string) => this.shadow.getElementById(id);
    if (e("s-on")) e("s-on")!.textContent = String(on);
    if (e("s-wi")) e("s-wi")!.textContent = String(wi);
    if (e("s-zb")) e("s-zb")!.textContent = String(zb);
  }

  private collect(): GraphData {
    const nodes: NetworkNode[] = [], links: NetworkLink[] = [];
    const cfg = this.cfg!;

    // Get router info from sensor attributes
    const routerSensor = this.h?.states["sensor.router"];
    const routerIP = routerSensor?.attributes?.lan_ip || cfg.router_host || "";
    const haIP = routerSensor?.attributes?.host || "";

    nodes.push({ id: "internet", name: "Internet", type: "internet", floor: 0, online: true, val: 5 });
    nodes.push({ id: "router", name: cfg.router_name || "Router", type: "router", floor: 1, ip: routerIP, online: true, val: 16 });
    links.push({ source: "internet", target: "router", strength: 1 });
    if (cfg.mesh_name) {
      nodes.push({ id: "mesh", name: cfg.mesh_name, type: "mesh", floor: 2, ip: cfg.mesh_ip || "", online: true, val: 13 });
      links.push({ source: "router", target: "mesh", strength: 0.8 });
    }
    nodes.push({ id: "ha", name: "Home Assistant", type: "ha", floor: 1, ip: haIP, online: true, val: 12 });
    links.push({ source: "router", target: "ha", strength: 1 });

    const ent = this.h?.states[cfg.router_entity || "sensor.connected_clients"];
    for (const c of (ent?.attributes?.clients || [])) {
      if (!c.online || c.ip === "0.0.0.0" || !c.ip) continue;
      const mac = c.mac?.toLowerCase();
      // Find HA device for this MAC
      let haArea = "", haEntities: string[] = [];
      if (this.haD) {
        const haDevice = this.haD.find((d: any) =>
          d.connections?.some((conn: any[]) => conn[1]?.toLowerCase() === mac)
        );
        if (haDevice) {
          haArea = haDevice.area_id || "";
          // Find entities for this device
          if (this.h) {
            const allEntities = Object.keys(this.h.states).filter(eid => {
              const s = this.h!.states[eid];
              return s.attributes?.device_id === haDevice.id;
            });
            haEntities = allEntities.slice(0, 5);
          }
        }
      }
      const n: any = {
        id: `w-${mac}`, name: c.hostname || mac, type: "wifi-client" as const,
        floor: 1, ip: c.ip, mac, signal: c.signal, band: c.band, online: true, val: 6,
        traffic: c.traffic_usage || 0,
        upSpeed: c.up_speed || 0,
        downSpeed: c.down_speed || 0,
        onlineTime: c.online_time ? parseFloat(c.online_time) : 0,
        haArea, haEntities,
      };
      nodes.push(n);
      links.push({ source: "router", target: `w-${mac}`, strength: c.signal ? Math.max(0.1, Math.min(1, (c.signal + 90) / 50)) : 0.5 });
    }

    if (this.zha) {
      const coord = this.zha.find((d: any) => d.device_type === "Coordinator");
      if (coord) {
        nodes.push({ id: `z-${coord.ieee}`, name: "ZHA Coordinator", type: "zha-coordinator", floor: 1, manufacturer: coord.manufacturer, model: coord.model, online: true, val: 8 });
        links.push({ source: "ha", target: `z-${coord.ieee}`, strength: 1 });
      }
      for (const dev of this.zha) {
        if (dev.device_type === "Coordinator" || dev.available === false) continue;
        let name = dev.name || dev.model || dev.ieee;
        let haArea = "";
        if (this.haD) {
          const haDevice = this.haD.find((d: any) => d.identifiers?.some((id: any[]) => id[1] === dev.ieee));
          if (haDevice?.name) name = haDevice.name;
          if (haDevice?.area_id) haArea = haDevice.area_id;
        }
        const t = dev.device_type === "Router" ? "zigbee-router" as const : "zigbee-enddevice" as const;
        const n: any = {
          id: `z-${dev.ieee}`, name, type: t, floor: 1, manufacturer: dev.manufacturer, model: dev.model,
          signal: dev.lqi, rssi: dev.rssi, online: true, val: 5,
          haArea: haArea || dev.area_id || "",
          powerSource: dev.power_source,
          lastSeen: dev.last_seen,
          haEntities: dev.entities?.map((e: any) => e.entity_id) || [],
        };
        nodes.push(n);
        if (coord) links.push({ source: `z-${coord.ieee}`, target: `z-${dev.ieee}`, strength: dev.lqi ? Math.min(1, dev.lqi / 255) : 0.5 });
      }
    }
    return { nodes, links };
  }

  private sc(n: NetworkNode): string {
    if (n.band === "WIRED" || n.type === "ha") return "sg"; // Wired is always good
    if (!n.signal) return "";
    if (n.type.includes("zigbee") || n.type.includes("zha")) return n.signal > 200 ? "sg" : n.signal > 100 ? "so" : "sw";
    return n.signal > -50 ? "sg" : n.signal > -70 ? "so" : "sw";
  }
}

const CSS = `
:host{display:block;height:100%}
.root{display:flex;flex-direction:column;height:calc(100vh - 56px);background:${GRAPH_CONFIG.BACKGROUND_COLOR};color:#ccc;font-family:system-ui,sans-serif}
.bar{display:flex;justify-content:space-between;align-items:center;padding:6px 16px;background:rgba(8,8,25,0.5);border-bottom:1px solid rgba(100,150,255,0.08)}
.stats{display:flex;gap:16px;font-size:12px;color:rgba(255,255,255,0.45)}
.st{display:flex;align-items:center;gap:4px}
.st b{color:#00e5ff;font-size:15px}
.tabs{display:flex;gap:2px;background:rgba(255,255,255,0.05);border-radius:6px;padding:2px}
.tab{border:none;background:transparent;color:rgba(255,255,255,0.4);padding:4px 14px;border-radius:5px;font-size:12px;cursor:pointer;font-family:inherit}
.tab.active{background:rgba(100,150,255,0.2);color:#00e5ff}
.tab:hover{color:#fff}
.body{flex:1;position:relative;overflow:hidden;min-height:0}
.gv{position:absolute;inset:0}
.gv.hid{display:none}
canvas{display:block;width:100%;height:100%;cursor:grab}
canvas:active{cursor:grabbing}
.tv{position:absolute;inset:0;overflow:auto;padding:0}
.tv.hid{display:none}
table{width:100%;border-collapse:collapse;font-size:11px}
thead{position:sticky;top:0;z-index:5}
th{background:rgba(15,15,35,0.95);color:rgba(255,255,255,0.5);padding:8px 6px;text-align:left;cursor:pointer;font-weight:500;border-bottom:1px solid rgba(100,150,255,0.15);white-space:nowrap;user-select:none}
th:hover{color:#00e5ff}
th.sorted{color:#00e5ff}
td{padding:6px;border-bottom:1px solid rgba(255,255,255,0.03);color:rgba(255,255,255,0.7);white-space:nowrap}
tr:hover td{background:rgba(100,150,255,0.05)}
tr.sel td{background:rgba(100,150,255,0.1);color:#fff}
tr.unknown-device td{border-left:3px solid #ff9800;color:#ffb74d}
tr.unknown-device td:first-child{border-left:none}
tr.unknown-device:hover td{background:rgba(255,152,0,0.08)}
td:first-child{text-align:center;font-size:16px}
.group-header td{background:rgba(20,20,45,0.9)!important;color:rgba(255,255,255,0.6);font-size:12px;font-weight:600;padding:8px 6px 6px;letter-spacing:0.5px;border-bottom:1px solid rgba(100,150,255,0.12)}
.gh-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle}
.gh-count{color:rgba(255,255,255,0.3);font-weight:400;margin-left:4px}
.tip{position:absolute;background:rgba(8,8,25,0.92);color:#ccc;padding:6px 10px;border-radius:6px;font-size:11px;line-height:1.4;border:1px solid rgba(100,150,255,0.2);pointer-events:none;z-index:20;white-space:nowrap}
.tip.hid{display:none}
.tip b{color:#00e5ff}
.det{position:absolute;top:8px;right:8px;width:260px;background:rgba(8,8,25,0.96);border:1px solid rgba(100,150,255,0.2);border-radius:10px;padding:14px;z-index:15;max-height:calc(100% - 20px);overflow-y:auto}
.det.hid{display:none}
.det h3{margin:0 0 8px;color:#00e5ff;font-size:13px;display:flex;align-items:center;gap:6px}
.xb{margin-left:auto;cursor:pointer;color:rgba(255,255,255,0.4);font-size:18px;border:none;background:none;line-height:1}
.xb:hover{color:#fff}
.dr{display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:11px;gap:8px}
.dl{color:rgba(255,255,255,0.35);white-space:nowrap}
.dv{color:rgba(255,255,255,0.85);font-family:"SF Mono",monospace;font-size:10px;text-align:right;word-break:break-all}
.sg{color:#4caf50!important} .so{color:#ff9800!important} .sw{color:#f44336!important}
.leg{display:flex;gap:14px;padding:5px 16px;font-size:10px;background:rgba(8,8,25,0.5)}
.li{display:flex;align-items:center;gap:4px;color:rgba(255,255,255,0.35)}
.ld2{width:7px;height:7px;border-radius:50%;display:inline-block}
.ld{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:rgba(255,255,255,0.35);font-size:15px;animation:p 1.5s infinite}
.ld.hid{display:none}
@keyframes p{0%,100%{opacity:.3}50%{opacity:.8}}
`;

customElements.define("network-visualizer-card", NetworkVisualizerCard);
(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({ type: "network-visualizer-card", name: "Network Visualizer", description: "Network topology + table", preview: false });
