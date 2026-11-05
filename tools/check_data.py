#!/usr/bin/env python3
"""Stop the auto-update from saving broken data.

Compares the rebuilt data with the last good copy. Exits with an error, so the workflow stops before
committing, if a file is unreadable, a list shrank sharply, or something points at a record that isn't there.

Usage: python3 tools/check_data.py path/to/old/data path/to/new/data
"""
import json
import sys
from pathlib import Path

MAX_DROP = 0.10  # a list losing more than this looks like a bad source update, not a game change
REQUIRED = ("monsters", "items", "maps", "npcs", "quests", "jobs", "worldmap", "gear")


def load(folder, name):
    return json.loads((Path(folder) / f"{name}.json").read_text(encoding="utf-8"))


def counts(folder):
    out = {}
    for name in REQUIRED:
        try:
            rows = load(folder, name)
        except (OSError, ValueError):
            continue
        out[name] = len(rows)
        if name == "monsters":
            out["drop rows"] = sum(len(m.get("drops", [])) for m in rows)
        if name == "maps":
            out["portals"] = sum(len(m.get("portals", [])) for m in rows)
    return out


def main(old_dir, new_dir):
    problems = []
    data = {}
    for name in REQUIRED:
        try:
            data[name] = load(new_dir, name)
        except (OSError, ValueError) as err:
            problems.append(f"{name}.json can't be read: {err}")
            continue
        if not data[name]:
            problems.append(f"{name}.json is empty")

    old, new = counts(old_dir), counts(new_dir)
    for key, before in old.items():
        after = new.get(key, 0)
        if before and after < before * (1 - MAX_DROP):
            problems.append(f"{key} fell from {before} to {after}")

    if all(k in data for k in ("monsters", "items", "maps", "npcs", "quests")):
        ids = {k: {e["id"] for e in data[k]} for k in ("monsters", "items", "maps", "npcs", "quests")}
        for m in data["monsters"]:
            if not isinstance(m.get("hp"), (int, float)) or m["hp"] <= 0:
                problems.append(f"monster {m.get('name')} has HP {m.get('hp')}")
            problems += [f"{m['name']} drops unknown item {d['item']}" for d in m["drops"] if d["item"] not in ids["items"]]
            problems += [f"{m['name']} drops {d['item']} at {d['rate']}%" for d in m["drops"] if d.get("rate") is not None and not 0 <= d["rate"] <= 100]
        for mp in data["maps"]:
            problems += [f"{mp['name']} spawns unknown monster {s['monster']}" for s in mp["spawns"] if s["monster"] not in ids["monsters"]]
            problems += [f"{mp['name']} has a portal to unknown map {p['to']}" for p in mp["portals"] if p["to"] not in ids["maps"]]
        for it in data["items"]:
            for r in it.get("crafts") or []:
                problems += [f"{it['name']} needs unknown item {x['item']}" for x in r["materials"] if x["item"] not in ids["items"]]
        for q in data["quests"]:
            for key in ("need", "rewards", "choice", "start_items"):
                problems += [f"quest {q['name']} uses unknown item {x['item']}" for x in q.get(key) or [] if x["item"] not in ids["items"]]
    if "gear" in data and not any(g.get("slot") == "weapon" for g in data["gear"]):
        problems.append("gear.json has no weapons")

    if problems:
        print(f"Data check failed, so nothing will be saved ({len(problems)} problems):")
        for p in problems[:40]:
            print(" -", p)
        sys.exit(1)
    print("Data check passed:", ", ".join(f"{k} {v}" for k, v in new.items()))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
