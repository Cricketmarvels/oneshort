"""MongoDB client lifecycle and transaction helper (PyMongo Async)."""

from collections.abc import Awaitable, Callable
from typing import Any

from pymongo import AsyncMongoClient
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.read_concern import ReadConcern
from pymongo.write_concern import WriteConcern

Doc = dict[str, Any]


class Mongo:
    """Holds the client and database handle. One instance per process."""

    def __init__(self, uri: str, db_name: str) -> None:
        self.client: AsyncMongoClient[Doc] = AsyncMongoClient(
            uri, tz_aware=True, uuidRepresentation="standard", serverSelectionTimeoutMS=5000
        )
        self.db: AsyncDatabase[Doc] = self.client[db_name]

    def __getitem__(self, name: str) -> AsyncCollection[Doc]:
        return self.db[name]

    async def ping(self) -> bool:
        await self.client.admin.command("ping")
        return True

    async def close(self) -> None:
        await self.client.close()

    async def transaction[T](self, fn: Callable[[AsyncClientSession], Awaitable[T]]) -> T:
        """Run ``fn`` inside a multi-document transaction.

        ``with_transaction`` retries the callback on TransientTransactionError and
        the commit on UnknownTransactionCommitResult. Domain exceptions abort it.
        """
        async with self.client.start_session() as session:
            result: T = await session.with_transaction(
                fn,
                read_concern=ReadConcern("snapshot"),
                write_concern=WriteConcern("majority"),
            )
            return result
