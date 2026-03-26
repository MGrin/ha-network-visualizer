import { LitElement, html, nothing } from "lit";
import { property, state } from "lit/decorators.js";
import { cardStyles } from "./styles";
import { GraphRenderer } from "./graph-renderer";
import { collectGraphData, generateActionItems } from "./data-collector";
import { NODE_COLORS } from "./constants";
import type {
  HomeAssistant,
  CardConfig,
  GraphData,
  NetworkNode,
  ActionItem,
} from "./types";

class NetworkVisualizerCard extends LitElement {
  @property({ attribute: false }) hass?: HomeAssistant;
  @state() private config?: CardConfig;
  @state() private selectedNode: NetworkNode | null = null;
  @state() private actionItems: ActionItem[] = [];
  @state() private graphData: GraphData = { nodes: [], links: [] };
  @state() private zhaDevices: any[] | null = null;

  private graphRenderer: GraphRenderer | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private updateTimeout: number | null = null;
  private initialized = false;

  static styles = cardStyles;

  setConfig(config: CardConfig): void {
    this.config = {
      ...config,
      height: config.height || 550,
    };
  }

  getCardSize(): number {
    return 8;
  }

  getGridOptions() {
    return { columns: 12, rows: 8, min_columns: 6, min_rows: 4 };
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.fetchZHADevices();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.graphRenderer?.dispose();
    this.graphRenderer = null;
    this.resizeObserver?.disconnect();
    this.initialized = false;
    if (this.updateTimeout) clearTimeout(this.updateTimeout);
  }

  protected updated(changedProperties: Map<string, unknown>): void {
    super.updated(changedProperties);

    if (changedProperties.has("hass") && this.hass && this.config) {
      this.scheduleUpdate();
    }

    if (!this.initialized) {
      this.initGraph();
    }
  }

  private scheduleUpdate(): void {
    if (this.updateTimeout) clearTimeout(this.updateTimeout);
    this.updateTimeout = window.setTimeout(() => this.updateGraph(), 1000);
  }

  private async fetchZHADevices(): Promise<void> {
    if (!this.hass) return;
    try {
      const devices = await this.hass.callWS({ type: "zha/devices" });
      this.zhaDevices = devices;
    } catch {
      this.zhaDevices = null;
    }
  }

  private initGraph(): void {
    const container = this.shadowRoot?.getElementById("graph");
    if (!container || this.initialized) return;

    this.graphRenderer = new GraphRenderer(container, (node) => {
      this.selectedNode = node;
    });

    const rect = container.getBoundingClientRect();
    const width = rect.width || container.clientWidth || 800;
    const height = this.config?.height || 550;
    this.graphRenderer.init(width, height);
    this.initialized = true;

    // Resize observer
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        this.graphRenderer?.resize(w, this.config?.height || 550);
      }
    });
    this.resizeObserver.observe(container);

    // Initial data load
    this.updateGraph();
  }

  private updateGraph(): void {
    if (!this.hass || !this.config) return;

    this.graphData = collectGraphData(
      this.hass,
      this.config,
      this.zhaDevices,
    );
    this.actionItems = generateActionItems(
      this.hass,
      this.config,
      this.graphData,
    );
    this.graphRenderer?.updateData(this.graphData);
  }

  protected render() {
    if (!this.config) return nothing;

    const wifiCount = this.graphData.nodes.filter((n) =>
      n.type.startsWith("wifi"),
    ).length;
    const zigbeeCount = this.graphData.nodes.filter((n) =>
      n.type.startsWith("zigbee") || n.type === "zha-coordinator",
    ).length;
    const onlineCount = this.graphData.nodes.filter(
      (n) => n.online && n.type !== "internet" && n.type !== "router" && n.type !== "mesh" && n.type !== "ha",
    ).length;
    const alertCount = this.actionItems.filter(
      (a) => a.severity !== "info",
    ).length;

    return html`
      <ha-card>
        <div class="stats-bar">
          <div class="stat">
            <span class="count">${onlineCount}</span> devices online
          </div>
          <div class="stat">
            <span class="count">${wifiCount}</span> WiFi
          </div>
          <div class="stat">
            <span class="count">${zigbeeCount}</span> Zigbee
          </div>
          ${alertCount > 0
            ? html`<div class="stat">
                <span class="count" style="color: #ff9800"
                  >${alertCount}</span
                >
                alerts
              </div>`
            : nothing}
        </div>

        <div class="card-container">
          <div
            id="graph"
            class="graph-container"
            style="height: ${this.config.height}px"
          >
            <div class="legend">
              ${this.renderLegend()}
            </div>
          </div>

          ${this.selectedNode
            ? this.renderDetailPanel()
            : this.actionItems.length > 0
              ? this.renderActionItems()
              : nothing}
        </div>
      </ha-card>
    `;
  }

  private renderLegend() {
    const items = [
      { color: NODE_COLORS.router, label: "Router" },
      { color: NODE_COLORS["wifi-client"], label: "WiFi" },
      { color: NODE_COLORS["wifi-unknown"], label: "Unknown" },
      { color: NODE_COLORS["zha-coordinator"], label: "Zigbee" },
      { color: NODE_COLORS.offline, label: "Offline" },
    ];
    return items.map(
      (item) => html`
        <div class="legend-item">
          <span
            class="legend-dot"
            style="background: ${item.color}"
          ></span>
          ${item.label}
        </div>
      `,
    );
  }

  private renderDetailPanel() {
    const node = this.selectedNode!;
    return html`
      <div class="detail-panel">
        <h3>
          ${node.name}
          <button class="close-btn" @click=${() => (this.selectedNode = null)}>
            &times;
          </button>
        </h3>
        ${node.ip
          ? html`<div class="detail-row">
              <span class="label">IP</span>
              <span class="value">${node.ip}</span>
            </div>`
          : nothing}
        ${node.mac
          ? html`<div class="detail-row">
              <span class="label">MAC</span>
              <span class="value">${node.mac}</span>
            </div>`
          : nothing}
        ${node.signal !== undefined
          ? html`<div class="detail-row">
              <span class="label"
                >${node.type.includes("zigbee") ? "LQI" : "Signal"}</span
              >
              <span class="value ${this.getSignalClass(node)}"
                >${node.signal}
                ${node.type.includes("zigbee") ? "" : " dBm"}</span
              >
            </div>`
          : nothing}
        ${node.band
          ? html`<div class="detail-row">
              <span class="label">Band</span>
              <span class="value">${node.band}</span>
            </div>`
          : nothing}
        ${node.manufacturer
          ? html`<div class="detail-row">
              <span class="label">Manufacturer</span>
              <span class="value">${node.manufacturer}</span>
            </div>`
          : nothing}
        ${node.model
          ? html`<div class="detail-row">
              <span class="label">Model</span>
              <span class="value">${node.model}</span>
            </div>`
          : nothing}
        ${node.area
          ? html`<div class="detail-row">
              <span class="label">Area</span>
              <span class="value">${node.area}</span>
            </div>`
          : nothing}
        <div class="detail-row">
          <span class="label">Status</span>
          <span
            class="value"
            style="color: ${node.online ? "#4caf50" : "#f44336"}"
            >${node.online ? "Online" : "Offline"}</span
          >
        </div>
        <div class="detail-row">
          <span class="label">Type</span>
          <span class="value">${node.type}</span>
        </div>
        <div class="detail-row">
          <span class="label">Floor</span>
          <span class="value">${node.floor === 0 ? "Ground" : "Second"}</span>
        </div>
      </div>
    `;
  }

  private renderActionItems() {
    return html`
      <div class="detail-panel">
        <h3>Action Items</h3>
        ${this.actionItems.slice(0, 15).map(
          (item) => html`
            <div class="action-item ${item.severity}">
              <div>
                <div class="title">${item.title}</div>
                <div>${item.description}</div>
              </div>
            </div>
          `,
        )}
      </div>
    `;
  }

  private getSignalClass(node: NetworkNode): string {
    if (!node.signal) return "";
    if (node.type.includes("zigbee")) {
      if (node.signal > 200) return "signal-good";
      if (node.signal > 100) return "signal-ok";
      return "signal-weak";
    }
    if (node.signal > -50) return "signal-good";
    if (node.signal > -70) return "signal-ok";
    return "signal-weak";
  }
}

customElements.define(
  "network-visualizer-card",
  NetworkVisualizerCard,
);

// Register with HA card picker
(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: "network-visualizer-card",
  name: "Network Visualizer",
  description: "3D interactive home network topology visualization",
  preview: false,
});
