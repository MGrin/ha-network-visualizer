"""Sensor platform for Network Visualizer."""
from __future__ import annotations

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import NetworkVisualizerCoordinator


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Network Visualizer sensors."""
    coordinator: NetworkVisualizerCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([
        NetworkClientsSensor(coordinator, entry),
        NetworkRouterSensor(coordinator, entry),
    ])


class NetworkClientsSensor(CoordinatorEntity[NetworkVisualizerCoordinator], SensorEntity):
    """Sensor showing connected client count with full client list in attributes."""

    _attr_has_entity_name = True
    _attr_name = "Connected Clients"
    _attr_icon = "mdi:devices"

    def __init__(self, coordinator: NetworkVisualizerCoordinator, entry: ConfigEntry) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator)
        self._attr_unique_id = f"{entry.entry_id}_clients"
        self._entry = entry

    @property
    def native_value(self) -> int:
        """Return number of connected clients."""
        if self.coordinator.data:
            return len(self.coordinator.data.get("clients", []))
        return 0

    @property
    def extra_state_attributes(self) -> dict:
        """Return the full client list as attributes."""
        if self.coordinator.data:
            return {
                "clients": self.coordinator.data.get("clients", []),
            }
        return {"clients": []}


class NetworkRouterSensor(CoordinatorEntity[NetworkVisualizerCoordinator], SensorEntity):
    """Sensor showing router status."""

    _attr_has_entity_name = True
    _attr_name = "Router"
    _attr_icon = "mdi:router-wireless"

    def __init__(self, coordinator: NetworkVisualizerCoordinator, entry: ConfigEntry) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator)
        self._attr_unique_id = f"{entry.entry_id}_router"
        self._entry = entry

    @property
    def native_value(self) -> str:
        """Return router status."""
        if self.coordinator.data:
            return "online"
        return "offline"

    @property
    def extra_state_attributes(self) -> dict:
        """Return router info."""
        if self.coordinator.data:
            return self.coordinator.data.get("router", {})
        return {}
