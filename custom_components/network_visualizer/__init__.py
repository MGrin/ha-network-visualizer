"""Home Network Visualizer integration."""
from __future__ import annotations

import logging
import os

from homeassistant.components.frontend import async_register_built_in_panel
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import DOMAIN, PLATFORMS
from .coordinator import NetworkVisualizerCoordinator

_LOGGER = logging.getLogger(__name__)

CARD_URL = "/network-visualizer/network-visualizer-card.js"


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up the Network Visualizer component."""
    # Serve the frontend card JS from the integration's dist/ directory
    card_path = os.path.join(os.path.dirname(__file__), "dist", "network-visualizer-card.js")
    if os.path.exists(card_path):
        await hass.http.async_register_static_paths(
            [StaticPathConfig(CARD_URL, card_path, True)]
        )
        # Register as Lovelace resource
        hass.http.register_redirect("/local/network-visualizer-card.js", CARD_URL)
        _LOGGER.info("Network Visualizer card registered at %s", CARD_URL)
    else:
        _LOGGER.warning("Network Visualizer card JS not found at %s", card_path)

    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Network Visualizer from a config entry."""
    coordinator = NetworkVisualizerCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()

    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][entry.entry_id] = coordinator

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id)
    return unload_ok
