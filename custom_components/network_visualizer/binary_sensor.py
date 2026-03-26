"""Binary sensor platform for Network Visualizer."""
from __future__ import annotations

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
)
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
    """Set up Network Visualizer binary sensors."""
    coordinator: NetworkVisualizerCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([
        InternetConnectivitySensor(coordinator, entry),
    ])


class InternetConnectivitySensor(
    CoordinatorEntity[NetworkVisualizerCoordinator], BinarySensorEntity
):
    """Binary sensor for internet connectivity."""

    _attr_has_entity_name = True
    _attr_name = "Internet"
    _attr_device_class = BinarySensorDeviceClass.CONNECTIVITY
    _attr_icon = "mdi:web"

    def __init__(self, coordinator: NetworkVisualizerCoordinator, entry: ConfigEntry) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator)
        self._attr_unique_id = f"{entry.entry_id}_internet"
        self._entry = entry

    @property
    def is_on(self) -> bool:
        """Return true if internet is connected."""
        if self.coordinator.data:
            return self.coordinator.data.get("internet_online", False)
        return False
