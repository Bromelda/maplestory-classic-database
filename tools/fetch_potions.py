#!/usr/bin/env python3
"""Download potions and food that raise stats for a while, for the calculator's buff list.

Club FM's item list doesn't have what they do, so it comes from each item's game data on maplestory.io
(Classic World game files): data/potions.json and icons in assets/item. Only new items are fetched.

Usage: python3 tools/fetch_potions.py path/to/fm/data/itemdb.json
"""
import base64
import json
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "potions.json"
CHECKED = ROOT / "data" / "potions_checked.json"  # every item already looked at, buff or not
ICONS = ROOT / "assets" / "item"
API = "https://maplestory.io/api/MCW/1/item"
THREADS = 4
KINDS = {"Use:Potion", "Use:Food and Drink", "Use:Consumable", "Use:Other"}
# game field -> our stat. In the game's own text, "pad" on these items reads "Attack Power".
FIELDS = {"pad": "AP", "mad": "MATT", "acc": "ACC", "eva": "AVOID", "speed": "SPEED", "jump": "JUMP",
          "pdd": "WDEF", "mdd": "MDEF", "str": "STR", "dex": "DEX", "int": "INT", "luk": "LUK"}


def fetch(row):
    req = urllib.request.Request(f"{API}/{row[1]}", headers={"User-Agent": "maplestory-classic-database-fan-site"})
    with urllib.request.urlopen(req, timeout=60) as res:
        info = json.loads(res.read()).get("metaInfo") or {}
    spec = info.get("consumeSpec") or {}
    stats = {FIELDS[k]: spec[k] for k in FIELDS if spec.get(k)}
    if not stats or not spec.get("time"):
        return row[1], None
    if info.get("iconRaw"):
        (ICONS / f"{row[1]}.png").write_bytes(base64.b64decode(info["iconRaw"]))
    return row[1], {"gid": row[1], "name": row[0], "minutes": round(spec["time"] / 60000, 1), "stats": stats}


def main():
    itemdb = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    ICONS.mkdir(parents=True, exist_ok=True)
    rows = {p["gid"]: p for p in json.loads(OUT.read_text(encoding="utf-8"))} if OUT.exists() else {}
    checked = set(json.loads(CHECKED.read_text(encoding="utf-8"))) if CHECKED.exists() else set()
    todo = [r for r in itemdb["items"] if r[5] < len(itemdb["kinds"]) and itemdb["kinds"][r[5]] in KINDS and r[1] not in checked]
    failed = []

    def safe(row):
        try:
            return fetch(row)
        except Exception as err:
            failed.append(f"{row[0]}: {err}")
            return None

    with ThreadPoolExecutor(THREADS) as pool:
        for result in pool.map(safe, todo):
            if result:
                checked.add(result[0])
                if result[1]:
                    rows[result[0]] = result[1]
    if not rows:
        sys.exit("No potions found, so the existing file was left alone")
    OUT.write_text(json.dumps(sorted(rows.values(), key=lambda p: p["name"]), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    CHECKED.write_text(json.dumps(sorted(checked), separators=(",", ":")), encoding="utf-8")
    print(f"{len(rows)} potions with buffs, {len(todo) - len(failed)} items checked")
    if failed:
        print("failed:", "; ".join(failed[:20]))
        sys.exit(1)  # what worked is kept, and the rest is tried again next run


if __name__ == "__main__":
    main()
