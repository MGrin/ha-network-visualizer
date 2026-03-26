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
        from tplinkrouterc6u import TplinkRouter, Connection

        router = TplinkRouter(self._host, self._password)
        router.single_request_mode = False  # batch operations

        try:
            router.authorize()

            # Get all connected clients
            clients_raw = router.get_status()

            clients = []
            if clients_raw and hasattr(clients_raw, 'clients'):
                for mac, client in clients_raw.clients.items():
                    clients.append({
                        "mac": str(mac),
                        "ip": str(client.ipaddr) if hasattr(client, 'ipaddr') else "",
                        "hostname": str(client.hostname) if hasattr(client, 'hostname') else "",
                        "online": True,
                        "band": str(client.type) if hasattr(client, 'type') else "",
                    })

            # Get basic router info
            router_info = {
                "host": self._host,
                "client_count": len(clients),
            }

            # Check internet connectivity
            internet_online = True
            if clients_raw and hasattr(clients_raw, 'wan_ipv4_uptime'):
                internet_online = clients_raw.wan_ipv4_uptime is not None

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
                _LOGGER.debug("Failed to logout from router (may already be logged out)")
