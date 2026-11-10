"""Rebuild the unified search index from users, teams and venues.

    cd backend && uv run python -m scripts.reindex_search

Safe to run any time (idempotent upserts; stale entries for deleted sources are removed).
"""

import asyncio

from app.core.config import get_settings
from app.core.container import build_container
from app.infrastructure.database.indexes import ensure_indexes
from app.modules.search.indexer import SearchIndexer


async def main() -> None:
    c = build_container(get_settings())
    try:
        await ensure_indexes(c.mongo)
        n = await SearchIndexer(c.mongo).reindex_all()
        print(f"search_index rebuilt: {n['player']} players, {n['team']} teams, {n['ground']} grounds")
    finally:
        await c.mongo.close()


if __name__ == "__main__":
    asyncio.run(main())
