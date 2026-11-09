#!/usr/bin/env python3
"""Download what each equipment scroll does, for the calculator's scroll simulator.

Club FM's item list has the scrolls but not their success rates or stats, so these come from each
item's game data on maplestory.io (Classic World game files): data/scrolls.json. Only new scrolls are fetched.

Usage: python3 tools/fetch_scrolls.py path/to/fm/data/itemdb.json
"""
import json
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "scrolls.json"
API = "https://maplestory.io/api/MCW/1/item"
THREADS = 4
FIELDS = {"incWAT": "ATT", "incPAD": "ATT", "incMAD": "MATT", "incSTR": "STR", "incDEX": "DEX", "incINT": "INT", "incLUK": "LUK", "incACC": "ACC",
          "incEVA": "AVOID", "incPDD": "WDEF", "incMDD": "MDEF", "incMHP": "HP", "incMMP": "MP", "incSpeed": "SPEED", "incJump": "JUMP", "incCRT": "CRIT", "incCRD": "CRITDMG"}


def fetch(row, kind):
    req = urllib.request.Request(f"{API}/{row[1]}", headers={"User-Agent": "maplestory-classic-database-fan-site"})
    with urllib.request.urlopen(req, timeout=60) as res:
        info = json.loads(res.read()).get("metaInfo") or {}
    stats = {FIELDS[k]: v for k, v in info.items() if k in FIELDS and v}
    if not info.get("success") or not stats:
        return None
    return {"gid": row[1], "name": row[0], "category": kind.split(":")[1], "success": info["success"], "destroy": info.get("cursed") or 0, "stats": stats}


def main():
    itemdb = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    rows = {s["gid"]: s for s in json.loads(OUT.read_text(encoding="utf-8"))} if OUT.exists() else {}
    kinds = itemdb["kinds"]
    todo = [(r, kinds[r[5]]) for r in itemdb["items"] if r[5] < len(kinds) and kinds[r[5]].startswith("Use:") and "Scroll" in r[0]
            and kinds[r[5]] != "Use:Teleport Item" and r[1] not in rows]
    failed = []

    def safe(pair):
        try:
            return fetch(*pair)
        except Exception as err:
            failed.append(f"{pair[0][0]}: {err}")
            return None

    with ThreadPoolExecutor(THREADS) as pool:
        for result in pool.map(safe, todo):
            if result:
                rows[result["gid"]] = result
    if not rows:
        sys.exit("No scrolls found, so the existing file was left alone")
    OUT.write_text(json.dumps(sorted(rows.values(), key=lambda s: s["name"]), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(rows)} scrolls saved, {len(todo) - len(failed)} checked")
    if failed:
        print("failed:", "; ".join(failed[:20]))
        sys.exit(1)  # what worked is kept, and the rest is tried again next run


if __name__ == "__main__":
    main()
