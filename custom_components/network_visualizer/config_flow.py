"""Config flow for Network Visualizer."""
from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow
from homeassistant.data_entry_flow import FlowResult

from .const import (
    CONF_ROUTER_HOST,
    CONF_ROUTER_PASSWORD,
    CONF_SCAN_INTERVAL,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
    MIN_SCAN_INTERVAL,
    MAX_SCAN_INTERVAL,
)

_LOGGER = logging.getLogger(__name__)

STEP_USER_DATA_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_ROUTER_HOST, default="192.168.0.1"): str,
        vol.Required(CONF_ROUTER_PASSWORD): str,
        vol.Optional(
            CONF_SCAN_INTERVAL, default=DEFAULT_SCAN_INTERVAL
        ): vol.All(
            vol.Coerce(int),
            vol.Range(min=MIN_SCAN_INTERVAL, max=MAX_SCAN_INTERVAL),
        ),
    }
)


class NetworkVisualizerConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Network Visualizer."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Handle the initial step."""
        errors: dict[str, str] = {}

        if user_input is not None:
            # Test connection to the router
            try:
                await self._test_connection(
                    user_input[CONF_ROUTER_HOST],
                    user_input[CONF_ROUTER_PASSWORD],
                )
            except Exception:
                errors["base"] = "cannot_connect"
            else:
                return self.async_create_entry(
                    title=f"Router ({user_input[CONF_ROUTER_HOST]})",
                    data=user_input,
                )

        return self.async_show_form(
            step_id="user",
            data_schema=STEP_USER_DATA_SCHEMA,
            errors=errors,
        )

    async def _test_connection(self, host: str, password: str) -> None:
        """Test if we can connect to the router."""
        def _test():
            from tplinkrouterc6u import TplinkRouter
            router = TplinkRouter(host, password)
            try:
                router.authorize()
            finally:
                try:
                    router.logout()
                except Exception:
                    pass

        await self.hass.async_add_executor_job(_test)
