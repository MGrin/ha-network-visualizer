# Home Network Visualizer

A custom Home Assistant integration + Lovelace card that provides an interactive 3D visualization of your home network topology.

## Features

- **3D Force-Directed Graph** — interactive WebGL network topology with rotation, zoom, and click-to-inspect
- **WiFi Clients** — polls TP-Link router (Archer AX73, BE230, etc.) for connected clients with signal strength, IP, MAC, band info
- **Zigbee Network** — visualizes ZHA mesh topology with coordinator, routers, and end devices
- **Multi-Floor Support** — Z-axis represents floors (ground floor vs second floor)
- **Action Items** — automatically flags unnamed devices, missing DHCP reservations, weak signals
- **Detail Panel** — click any node to see full device information
- **Minimal Admin Lockout** — explicit login/logout per poll (~3s session every 5min, vs continuous 30s polling)

## Installation

### HACS (recommended)

1. Open HACS → 3-dot menu → Custom repositories
2. Add `https://github.com/MGrin/ha-network-visualizer` as **Integration**
3. Search "Network Visualizer" and install
4. Restart Home Assistant
5. Go to Settings → Integrations → Add → "Network Visualizer"
6. Enter your TP-Link router IP and admin password
7. Add the `network-visualizer-card` to any dashboard

### Manual

1. Copy `custom_components/network_visualizer/` to your HA `config/custom_components/`
2. Copy `dist/network-visualizer-card.js` to `config/www/`
3. Add as Lovelace resource: `/local/network-visualizer-card.js`
4. Restart and configure the integration

## Card Configuration

```yaml
type: custom:network-visualizer-card
router_entity: sensor.network_visualizer_connected_clients
router_name: Archer AX73
mesh_name: ArcherBE230
height: 600
known_devices:
  "d8:d6:68:43:68:3f":
    name: Kitchen Switch
    floor: 0
    category: switch
```

## Supported Routers

Any router supported by [tplinkrouterc6u](https://github.com/AlexandrErohin/TP-Link-Archer-C6U), including:
- TP-Link Archer AX73, AX55, AX53, AX21, AX20, AX10, AX6000
- TP-Link Archer C6U, C80, C1200, C5400X
- TP-Link Archer BE230, BE3600
- TP-Link Deco series
- Mercusys routers

## Development

```bash
cd frontend
bun install
bun build src/network-visualizer-card.ts --outdir ../dist --minify --target=browser
```

## License

MIT
