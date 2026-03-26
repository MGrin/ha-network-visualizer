import { css } from "lit";

export const cardStyles = css`
  :host {
    display: block;
  }

  ha-card {
    overflow: hidden;
    background: var(--ha-card-background, #1a1a2e);
    border-radius: var(--ha-card-border-radius, 12px);
  }

  .card-container {
    display: flex;
    position: relative;
    width: 100%;
  }

  .graph-container {
    flex: 1;
    min-height: 500px;
    position: relative;
    cursor: grab;
  }

  .graph-container:active {
    cursor: grabbing;
  }

  .detail-panel {
    width: 320px;
    background: rgba(10, 10, 30, 0.95);
    border-left: 1px solid rgba(100, 150, 255, 0.2);
    padding: 16px;
    overflow-y: auto;
    max-height: 600px;
    font-family: "Segoe UI", system-ui, sans-serif;
  }

  .detail-panel.hidden {
    display: none;
  }

  .detail-panel h3 {
    margin: 0 0 12px 0;
    color: #00e5ff;
    font-size: 16px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .detail-panel .close-btn {
    margin-left: auto;
    cursor: pointer;
    color: rgba(255, 255, 255, 0.5);
    font-size: 20px;
    border: none;
    background: none;
    padding: 4px;
  }

  .detail-panel .close-btn:hover {
    color: #fff;
  }

  .detail-row {
    display: flex;
    justify-content: space-between;
    padding: 6px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    font-size: 13px;
  }

  .detail-row .label {
    color: rgba(255, 255, 255, 0.5);
  }

  .detail-row .value {
    color: rgba(255, 255, 255, 0.9);
    font-family: "SF Mono", "Fira Code", monospace;
  }

  .signal-good {
    color: #4caf50;
  }
  .signal-ok {
    color: #ff9800;
  }
  .signal-weak {
    color: #f44336;
  }

  .action-items {
    padding: 16px;
    border-top: 1px solid rgba(100, 150, 255, 0.15);
    background: rgba(10, 10, 30, 0.8);
  }

  .action-items h4 {
    margin: 0 0 8px 0;
    color: rgba(255, 255, 255, 0.7);
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 1px;
  }

  .action-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px;
    margin-bottom: 6px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.03);
    font-size: 12px;
    color: rgba(255, 255, 255, 0.7);
  }

  .action-item.warning {
    border-left: 3px solid #ff9800;
  }

  .action-item.error {
    border-left: 3px solid #f44336;
  }

  .action-item.info {
    border-left: 3px solid #42a5f5;
  }

  .action-item .icon {
    font-size: 16px;
    flex-shrink: 0;
  }

  .action-item .title {
    font-weight: 600;
    color: rgba(255, 255, 255, 0.9);
  }

  .legend {
    position: absolute;
    bottom: 12px;
    left: 12px;
    display: flex;
    gap: 12px;
    padding: 8px 12px;
    background: rgba(10, 10, 30, 0.85);
    border-radius: 8px;
    border: 1px solid rgba(100, 150, 255, 0.15);
    font-size: 11px;
    z-index: 10;
    flex-wrap: wrap;
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: 4px;
    color: rgba(255, 255, 255, 0.6);
  }

  .legend-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
  }

  .stats-bar {
    display: flex;
    gap: 16px;
    padding: 12px 16px;
    background: rgba(10, 10, 30, 0.6);
    border-bottom: 1px solid rgba(100, 150, 255, 0.1);
    font-size: 13px;
    color: rgba(255, 255, 255, 0.6);
  }

  .stat {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .stat .count {
    color: #00e5ff;
    font-weight: 700;
    font-size: 18px;
  }
`;
