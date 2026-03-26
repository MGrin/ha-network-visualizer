import ForceGraph3D from "3d-force-graph";
import type { GraphData, NetworkNode } from "./types";
import { GRAPH_CONFIG, NODE_COLORS } from "./constants";

export class GraphRenderer {
  private graph: any = null;
  private container: HTMLElement;
  private selectedNode: NetworkNode | null = null;
  private onNodeSelect: (node: NetworkNode | null) => void;

  constructor(
    container: HTMLElement,
    onNodeSelect: (node: NetworkNode | null) => void,
  ) {
    this.container = container;
    this.onNodeSelect = onNodeSelect;
  }

  init(width: number, height: number): void {
    this.graph = ForceGraph3D()(this.container)
      .width(width)
      .height(height)
      .backgroundColor(GRAPH_CONFIG.BACKGROUND_COLOR)
      .showNavInfo(false)
      // Node appearance
      .nodeLabel((node: any) => this.buildTooltip(node as NetworkNode))
      .nodeColor((node: any) => {
        const n = node as NetworkNode;
        if (this.selectedNode?.id === n.id) return "#ffffff";
        return n.color || NODE_COLORS[n.type] || "#42a5f5";
      })
      .nodeVal((node: any) => (node as NetworkNode).val || 5)
      .nodeOpacity(0.9)
      .nodeResolution(16)
      // Link appearance
      .linkColor((link: any) => {
        const strength = link.strength || 0.5;
        const alpha = 0.1 + strength * 0.4;
        return `rgba(100, 180, 255, ${alpha})`;
      })
      .linkWidth((link: any) => {
        const strength = link.strength || 0.5;
        return 0.5 + strength * 2;
      })
      .linkOpacity(0.6)
      // Interaction
      .onNodeClick((node: any) => {
        this.selectedNode = node as NetworkNode;
        this.onNodeSelect(this.selectedNode);
        // Focus camera on clicked node
        const distance = 120;
        const distRatio =
          1 + distance / Math.hypot(node.x || 0, node.y || 0, node.z || 0);
        this.graph.cameraPosition(
          {
            x: (node.x || 0) * distRatio,
            y: (node.y || 0) * distRatio,
            z: (node.z || 0) * distRatio,
          },
          node,
          1500,
        );
      })
      .onBackgroundClick(() => {
        this.selectedNode = null;
        this.onNodeSelect(null);
      })
      // Force configuration
      .d3AlphaDecay(0.02)
      .d3VelocityDecay(0.3);

    // Configure forces
    this.graph.d3Force("charge")?.strength(-80);
    this.graph.d3Force("link")?.distance((link: any) => {
      const strength = link.strength || 0.5;
      return 30 + (1 - strength) * 60;
    });
  }

  updateData(data: GraphData): void {
    if (!this.graph) return;
    this.graph.graphData(data);
  }

  resize(width: number, height: number): void {
    if (!this.graph) return;
    this.graph.width(width).height(height);
  }

  dispose(): void {
    if (this.graph) {
      this.graph._destructor?.();
      this.graph = null;
    }
  }

  private buildTooltip(node: NetworkNode): string {
    const lines = [`<b style="color:${node.color}">${node.name}</b>`];
    if (node.ip) lines.push(`IP: ${node.ip}`);
    if (node.mac) lines.push(`MAC: ${node.mac}`);
    if (node.signal !== undefined) {
      const unit = node.type.includes("zigbee") ? "LQI" : "dBm";
      lines.push(`Signal: ${node.signal} ${unit}`);
    }
    if (node.band) lines.push(`Band: ${node.band}`);
    if (node.manufacturer) lines.push(`${node.manufacturer}`);
    if (node.model) lines.push(`${node.model}`);
    lines.push(`Status: ${node.online ? "Online" : "Offline"}`);
    return lines.join("<br>");
  }
}
