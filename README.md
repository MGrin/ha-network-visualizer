# Home Network Visualizer for Home Assistant

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://github.com/hacs/integration)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A custom Home Assistant integration + Lovelace card that provides an interactive 2D visualization of your home network topology with a sortable device table.

## Features

**Graph View:**
- Interactive 2D force-directed network topology
- Zoom (scroll wheel) and pan (drag background)
- Draggable nodes
- Hover tooltips with device details
- Click-to-inspect detail panel
- Device icons based on type (phone, laptop, switch, speaker, etc.)

**Table View:**
- All connected clients in a sortable table
- IP, MAC, signal strength, WiFi band, traffic, speed, online time
- Color-coded signal strength (green/yellow/red)
- Wired connections shown with 🔗 icon
- Zigbee LQI/RSSI when available

**Backend Integration:**
- Polls TP-Link router for connected clients (IP, MAC, hostname, signal, band, traffic)
- Explicit login/logout per poll (~3 second session every 5 minutes)
- Minimal admin UI lockout compared to the standard TP-Link HA integration
- Also shows ZHA Zigbee network devices with HA friendly names

## Installation

### HACS (recommended)

1. Open HACS → 3-dot menu → **Custom repositories**
2. Add `https://github.com/MGrin/ha-network-visualizer` as **Integration**
3. Search "Network Visualizer" and install
4. **Restart** Home Assistant
5. Go to Settings → Integrations → **Add Integration** → "Network Visualizer"
6. Enter your TP-Link router IP and admin password
7. Add a Lovelace resource: `/network-visualizer/network-visualizer-card.js` (type: Module)
8. Add the card to any dashboard (see configuration below)

### Manual

1. Copy `custom_components/network_visualizer/` to `config/custom_components/`
2. Restart Home Assistant
3. Add the integration via Settings → Integrations
4. Add Lovelace resource: `/network-visualizer/network-visualizer-card.js` (type: Module)

## Card Configuration

```yaml
type: custom:network-visualizer-card
router_entity: sensor.connected_clients
router_name: My Router
mesh_name: Mesh Extender       # Optional: shows mesh node in graph
mesh_ip: 192.168.0.150         # Optional: IP for mesh node display
```

### Full-screen panel view (recommended)

In your dashboard YAML, use `type: panel` for a full-screen network view:

```yaml
views:
  - title: Network
    path: network
    type: panel
    cards:
      - type: custom:network-visualizer-card
        router_entity: sensor.connected_clients
        router_name: Archer AX73
        mesh_name: ArcherBE230
```

## Entities Created

The integration creates the following entities:

| Entity | Description |
|--------|-------------|
| `sensor.connected_clients` | Number of connected clients. Full client list in attributes (MAC, IP, hostname, signal, band, traffic, speed). |
| `sensor.router` | Router status with CPU/RAM usage, WAN IP, uptime. |
| `binary_sensor.internet` | Internet connectivity status. |

## Supported Routers

Any router supported by [tplinkrouterc6u](https://github.com/AlexandrErohin/TP-Link-Archer-C6U), including:

- TP-Link Archer AX73, AX55, AX53, AX21, AX20, AX10, AX6000
- TP-Link Archer C6U, C80, C1200, C5400X
- TP-Link Archer BE230, BE3600
- TP-Link Deco series
- Mercusys routers

> **Note on admin lockout:** TP-Link routers only allow one admin session at a time. This integration polls with explicit login/logout cycles (~3 seconds every 5 minutes by default), so you'll only be briefly locked out during each poll. This is much less disruptive than the standard TP-Link HA integration which polls every 30 seconds.

## Development

### Prerequisites

- [Bun](https://bun.sh/) (v1.0+)

### Build

```bash
cd frontend
bun install
bun build src/network-visualizer-card.ts --outdir ../dist --minify --target=browser
cp ../dist/network-visualizer-card.js ../custom_components/network_visualizer/dist/
```

### Project Structure

```
ha-network-visualizer/
├── custom_components/network_visualizer/   # HA integration (Python)
│   ├── __init__.py                         # Integration setup + static file serving
│   ├── config_flow.py                      # UI configuration flow
│   ├── coordinator.py                      # Data polling coordinator
│   ├── sensor.py                           # Sensor entities
│   ├── binary_sensor.py                    # Internet connectivity sensor
│   └── dist/network-visualizer-card.js     # Built frontend (served by integration)
├── frontend/                               # Lovelace card (TypeScript)
│   └── src/network-visualizer-card.ts      # Main card with graph + table views
├── hacs.json                               # HACS metadata
└── README.md
```

## License

MIT
