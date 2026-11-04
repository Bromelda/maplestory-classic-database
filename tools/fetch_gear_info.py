#!/usr/bin/env python3
"""Download icons and stat requirements for the calculator's gear, stars and arrows.

Club FM's item list has neither, so they come from maplestory.io (Classic World game files):
icons go to assets/item/<id>.png and requirements to data/gear_info.json.
Only items that aren't done yet are fetched, so new items cost a few requests and old ones none.

Usage: python3 tools/fetch_gear_info.py
"""
import base64
import json
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "gear_info.json"
ICONS = ROOT / "assets" / "item"
API = "https://maplestory.io/api/MCW/1/item"
THREADS = 4


def fetch(gid):
    req = urllib.request.Request(f"{API}/{gid}", headers={"User-Agent": "maplestory-classic-database-fan-site"})
    with urllib.request.urlopen(req, timeout=60) as res:
        info = json.loads(res.read()).get("metaInfo") or {}  # a few items have no details there
    if info.get("iconRaw"):
        (ICONS / f"{gid}.png").write_bytes(base64.b64decode(info["iconRaw"]))
    return gid, {k: info[f"req{k}"] for k in ("STR", "DEX", "INT", "LUK") if info.get(f"req{k}")}


def main():
    gids = []
    for name in ("gear", "ammo"):
        path = ROOT / "data" / f"{name}.json"
        if path.exists():
            gids += [g["gid"] for g in json.loads(path.read_text(encoding="utf-8"))]
    ICONS.mkdir(parents=True, exist_ok=True)
    known = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    todo = [g for g in gids if str(g) not in known]
    failed = []

    def safe(gid):
        try:
            return fetch(gid)
        except Exception as err:
            failed.append(f"{gid}: {err}")
            return None

    with ThreadPoolExecutor(THREADS) as pool:
        for result in pool.map(safe, todo):
            if result:
                known[str(result[0])] = result[1]
    OUT.write_text(json.dumps(known, separators=(",", ":"), sort_keys=True), encoding="utf-8")
    print(f"{len(todo) - len(failed)} items fetched, {len(known)} known")
    if failed:
        print("failed:", "; ".join(failed[:20]), f"({len(failed)} in total)")
        sys.exit(1)  # what worked is kept, and the rest is tried again next run


if __name__ == "__main__":
    main()
