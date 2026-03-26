"""Data coordinator for Network Visualizer."""
from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import (
    CONF_ROUTER_HOST,
    CONF_ROUTER_PASSWORD,
    CONF_SCAN_INTERVAL,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
)

_LOGGER = logging.getLogger(__name__)


class NetworkVisualizerCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Coordinator that polls TP-Link router for connected clients."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialize the coordinator."""
        self._host = entry.data[CONF_ROUTER_HOST]
        self._password = entry.data[CONF_ROUTER_PASSWORD]
        scan_interval = entry.data.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL)

        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=timedelta(seconds=scan_interval),
        )

    async def _async_update_data(self) -> dict[str, Any]:
        """Fetch data from TP-Link router with explicit login/logout."""
        try:
            return await self.hass.async_add_executor_job(self._poll_router)
        except Exception as err:
            raise UpdateFailed(f"Error communicating with router: {err}") from err

    def _poll_router(self) -> dict[str, Any]:
        """Poll the router (runs in executor thread). Login → fetch → logout."""
        from tplinkrouterc6u import TplinkRouterSG

        router = TplinkRouterSG(self._host, self._password, verify_ssl=False)

        try:
            router.authorize()
            status = router.get_status()

            clients = []
            if status and hasattr(status, "devices"):
                for dev in status.devices:
                    ip = str(dev.ipaddr) if hasattr(dev, "ipaddr") else ""
                    # Skip devices with no IP (disconnected/mesh relays)
                    is_online = ip != "0.0.0.0" and ip != ""

                    clients.append({
                        "mac": str(dev.macaddr) if hasattr(dev, "macaddr") else "",
                        "ip": ip,
                        "hostname": str(dev.hostname) if hasattr(dev, "hostname") else "",
                        "online": is_online,
                        "band": str(dev.type).replace("Connection.", "") if hasattr(dev, "type") else "",
                        "signal": int(dev.signal) if hasattr(dev, "signal") and dev.signal else None,
                        "up_speed": int(dev.up_speed) if hasattr(dev, "up_speed") and dev.up_speed else 0,
                        "down_speed": int(dev.down_speed) if hasattr(dev, "down_speed") and dev.down_speed else 0,
                        "traffic_usage": int(dev.traffic_usage) if hasattr(dev, "traffic_usage") and dev.traffic_usage else 0,
                    })

            router_info = {
                "host": self._host,
                "client_count": status.clients_total if status else 0,
                "wifi_clients": status.wifi_clients_total if status else 0,
                "wired_clients": status.wired_total if status else 0,
                "cpu_usage": status.cpu_usage if status else 0,
                "mem_usage": status.mem_usage if status else 0,
                "wan_ip": str(status.wan_ipv4_addr) if status else "",
                "lan_ip": str(status.lan_ipv4_addr) if status else "",
                "wan_uptime": status.wan_ipv4_uptime if status else 0,
            }

            internet_online = bool(
                status and status.wan_ipv4_uptime and status.wan_ipv4_uptime > 0
            )

            return {
                "clients": clients,
                "router": router_info,
                "internet_online": internet_online,
            }

        except Exception as err:
            _LOGGER.error("Failed to poll router %s: %s", self._host, err)
            raise
        finally:
            try:
                router.logout()
            except Exception:
                _LOGGER.debug("Failed to logout from router")
