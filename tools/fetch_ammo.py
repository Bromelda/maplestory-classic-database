#!/usr/bin/env python3
"""Download throwing stars and arrows for the calculator into data/ammo.json.

Club FM's item list has these items but not their attack, so it comes from each item's game data
on maplestory.io (Classic World game files). Plain arrows have no attack bonus.
Items that can't be read keep what's already in the file.

Usage: python3 tools/fetch_ammo.py path/to/fm/data/itemdb.json
"""
import json
import sys
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "ammo.json"
API = "https://maplestory.io/api/MCW/1/item"
KINDS = {"Use:Arrow": "Bow", "Use:Crossbow Bolt": "Crossbow", "Use:Thrown": "Claw"}


def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "maplestory-classic-database-fan-site"})
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read())


def main():
    itemdb = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    old = {a["gid"]: a for a in json.loads(OUT.read_text(encoding="utf-8"))} if OUT.exists() else {}
    rows, failed = [], []
    for r in itemdb["items"]:
        weapon = KINDS.get(itemdb["kinds"][r[5]]) if r[5] < len(itemdb["kinds"]) else None
        if not weapon:
            continue
        try:
            info = get_json(f"{API}/{r[1]}")["metaInfo"]
            attack = info.get("incWAT")
            rows.append({
                "gid": r[1], "name": r[0], "slot": "ammo", "weapon": weapon,
                "level": info.get("reqLevel") or 0,
                "stats": {"ATT": attack} if attack else {},
            })
        except Exception as err:
            failed.append(f"{r[0]}: {err}")
            if r[1] in old:
                rows.append(old[r[1]])
    if not rows:
        sys.exit("No ammo found, so the existing file was left alone")
    rows.sort(key=lambda a: (a["weapon"], a["stats"].get("ATT", 0), a["name"]))
    OUT.write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(rows)} stars and arrows saved")
    if failed:
        print("failed:", "; ".join(failed))
        sys.exit(1)


if __name__ == "__main__":
    main()
