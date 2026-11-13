"""Failover drill: write through the OneShort Mongo client while the primary steps down and then crashes.

Needs a 3-node replica set "rsft" on 127.0.0.1:27041-27043 (see docs/design/DATABASE_RELIABILITY.md).
Run from backend/:  PYTHONPATH=. uv run python ../scripts/db/failover_test.py
Pass: 0 errors and 0 acknowledged writes lost.
"""
import asyncio
import os
import signal
import subprocess
import time

from pymongo import MongoClient

from app.infrastructure.database.mongo import Mongo

URI = "mongodb://127.0.0.1:27041,127.0.0.1:27042,127.0.0.1:27043/?replicaSet=rsft"
DURATION = 40

def primary_port(sync):
    hello = sync.admin.command("hello"); return int(hello["primary"].split(":")[1]) if hello.get("primary") else None

async def main():
    m = Mongo(URI, "failover_test")
    await m.db.drop_collection("events"); await m["events"].create_index("seq", unique=True)
    sync = MongoClient(URI, serverSelectionTimeoutMS=30000)
    acked, errors, seq = set(), [], 0
    txn_ok = txn_err = 0
    start = time.monotonic(); err_times = []
    async def writer(wid):
        nonlocal seq, txn_ok, txn_err
        while time.monotonic() - start < DURATION:
            seq += 1; s = seq
            try:
                await m["events"].insert_one({"seq": s, "w": wid})
                acked.add(s)
            except Exception as e:
                errors.append(type(e).__name__); err_times.append(time.monotonic() - start)
            if s % 10 == 0:
                try:
                    async def fn(sess, s=s):
                        await m["events"].update_one({"seq": s}, {"$set": {"txn": True}}, session=sess)
                        await m["ledger"].insert_one({"seq": s}, session=sess)
                    await m.transaction(fn); txn_ok += 1
                except Exception as e:
                    txn_err += 1; errors.append("txn:" + type(e).__name__); err_times.append(time.monotonic() - start)
            await asyncio.sleep(0.02)
    async def chaos():
        await asyncio.sleep(8)
        p = primary_port(sync); print(f"t=8s  graceful step-down of primary :{p}")
        try: MongoClient(f"mongodb://127.0.0.1:{p}/?directConnection=true").admin.command("replSetStepDown", 20)
        except Exception: pass
        await asyncio.sleep(14)
        p = primary_port(sync); pid = subprocess.check_output(["lsof", "-ti", f"tcp:{p}", "-sTCP:LISTEN"]).split()[0]
        print(f"t=22s kill -9 the new primary :{p} (pid {int(pid)})"); os.kill(int(pid), signal.SIGKILL)
    await asyncio.gather(*(writer(i) for i in range(8)), chaos())
    stored = {d["seq"] for d in sync.failover_test.events.find({}, {"seq": 1})}
    lost = acked - stored
    print(f"attempted {seq}, acknowledged {len(acked)}, errors {len(errors)} {sorted(set(errors))}")
    print(f"transactions ok {txn_ok}, failed {txn_err}")
    if err_times: print(f"errors between t={min(err_times):.1f}s and t={max(err_times):.1f}s")
    print(f"acknowledged but LOST: {len(lost)}; stored: {len(stored)}; duplicates impossible (unique seq)")
    print("final primary:", sync.admin.command("hello").get("primary"))
asyncio.run(main())
