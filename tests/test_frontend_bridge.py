"""Stable panel and Lovelace-resource registration behavior."""

import asyncio
from pathlib import Path
from types import SimpleNamespace

from homeassistant.components.lovelace.const import LOVELACE_DATA

from custom_components.imprint_refinery.frontend_bridge import (
    CARD_URL,
    async_sync_resource,
    canonical_resource_url,
    resource_url,
)


def execute(awaitable):
    return asyncio.run(awaitable)


class Resources:
    def __init__(self, items=()) -> None:
        self.items = list(items)
        self.created = []
        self.updated = []
        self.deleted = []

    async def async_get_info(self):
        return {"resources": len(self.items)}

    def async_items(self):
        return list(self.items)

    async def async_create_item(self, value):
        self.created.append(value)

    async def async_update_item(self, item_id, value):
        self.updated.append((item_id, value))

    async def async_delete_item(self, item_id):
        self.deleted.append(item_id)


def home(resources):
    return SimpleNamespace(data={LOVELACE_DATA: SimpleNamespace(resources=resources)})


def test_resource_url_is_stable_and_cache_queries_canonicalize() -> None:
    assert resource_url(Path("different-name.js")) == CARD_URL
    assert canonical_resource_url(f"{CARD_URL}?v=old") == CARD_URL


def test_missing_resource_is_created_once() -> None:
    resources = Resources()
    execute(async_sync_resource(home(resources), Path("card.js")))
    assert resources.created == [{"res_type": "module", "url": CARD_URL}]
    assert resources.updated == []
    assert resources.deleted == []


def test_existing_versions_are_normalized_and_duplicates_removed() -> None:
    resources = Resources(
        [
            {"id": "keep", "type": "module", "url": f"{CARD_URL}?v=1"},
            {"id": "extra", "type": "module", "url": CARD_URL},
            {"id": "other", "type": "module", "url": "/other/card.js"},
        ]
    )
    execute(async_sync_resource(home(resources), Path("card.js")))
    assert resources.updated == [("keep", {"url": CARD_URL})]
    assert resources.deleted == ["extra"]


def test_yaml_or_unavailable_resource_registry_is_a_noop() -> None:
    execute(async_sync_resource(SimpleNamespace(data={}), Path("card.js")))
