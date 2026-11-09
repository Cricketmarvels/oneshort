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
    """Holds the client and database handle. One instance per process.

    Failover behaviour (see docs/design/DATABASE_RELIABILITY.md):
    - writes are acknowledged only once a majority of the replica set has them (and journalled), so an
      acknowledged write survives the loss of the primary;
    - reads use majority read concern, so a reader never sees data that a failover could roll back;
    - retryable reads and writes resend an operation once on a new primary after a network error or election;
    - server selection waits long enough to ride out an election (about 10-12 s after a primary dies) instead
      of failing requests while a new primary is chosen.
    """

    def __init__(
        self,
        uri: str,
        db_name: str,
        *,
        server_selection_timeout_ms: int = 15_000,
        connect_timeout_ms: int = 5_000,
        max_pool_size: int = 100,
        app_name: str = "playr-api",
    ) -> None:
        self.client: AsyncMongoClient[Doc] = AsyncMongoClient(
            uri,
            tz_aware=True,
            uuidRepresentation="standard",
            serverSelectionTimeoutMS=server_selection_timeout_ms,
            connectTimeoutMS=connect_timeout_ms,
            maxPoolSize=max_pool_size,
            retryWrites=True,
            retryReads=True,
            w="majority",
            journal=True,
            readConcernLevel="majority",
            appname=app_name,
        )
        self.db: AsyncDatabase[Doc] = self.client[db_name]

    def __getitem__(self, name: str) -> AsyncCollection[Doc]:
        return self.db[name]

    async def ping(self) -> bool:
        await self.client.admin.command("ping")
        return True

    async def topology(self) -> dict[str, Any]:
        """Replica-set health for monitoring: is there a writable primary, and how many members answer."""
        hello = await self.client.admin.command("hello")
        return {
            "replica_set": hello.get("setName"),
            "writable_primary": bool(hello.get("primary")),
            "members": len(hello.get("hosts", [])),
        }

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
