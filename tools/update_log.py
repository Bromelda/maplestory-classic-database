#!/usr/bin/env python3
"""Compare yesterday's data with today's and add what changed to data/log.json.

    python3 tools/update_log.py OLD_DATA_DIR NEW_DATA_DIR data/log.json

Logged: new or removed drops, new monsters, monster stat changes, new maps,
new or removed quests (for example events starting or ending) and new NPCs.
Drop-rate wobble from extra kills being counted is not logged; only drops that
appear or disappear are.
"""
import datetime
import json
import sys
from pathlib import Path

STATS = ["level", "hp", "exp", "atk", "matk", "wdef", "mdef", "acc", "avoid"]


def load(d, name):
    p = Path(d) / f"{name}.json"
    return {e["id"]: e for e in json.loads(p.read_text())} if p.exists() else {}


def main(old_dir, new_dir, log_path):
    today = datetime.date.today().isoformat()
    old = {n: load(old_dir, n) for n in ("monsters", "maps", "quests", "npcs", "items")}
    new = {n: load(new_dir, n) for n in ("monsters", "maps", "quests", "npcs", "items")}
    entries = []

    def add(kind, **kw):
        entries.append({"date": today, "type": kind, **kw})

    # monsters + drops
    for mid, m in new["monsters"].items():
        o = old["monsters"].get(mid)
        if not o:
            add("monster_new", monster=mid, text=f"New monster: {m['name']} (Lv {m['level']})")
            continue
        for f in STATS:
            if o.get(f) != m.get(f):
                add("monster_changed", monster=mid, field=f, old=o.get(f), new=m.get(f),
                    text=f"{m['name']}: {f.upper()} {o.get(f)} → {m.get(f)}")
        od = {d["item"]: d for d in o.get("drops", [])}
        nd = {d["item"]: d for d in m.get("drops", [])}
        for item in nd.keys() - od.keys():
            name = new["items"].get(item, {}).get("name", item)
            add("drop_new", monster=mid, item=item, rate=nd[item].get("rate"),
                text=f"{m['name']} now drops {name}")
        for item in od.keys() - nd.keys():
            name = (new["items"].get(item) or old["items"].get(item) or {}).get("name", item)
            add("drop_removed", monster=mid, item=item, text=f"{m['name']} no longer listed as dropping {name}")

    for map_id, mp in new["maps"].items():
        if map_id not in old["maps"]:
            add("map_new", map=map_id, text=f"New map: {mp['name']}")

    for qid, q in new["quests"].items():
        if qid not in old["quests"]:
            add("quest_new", quest=qid, text=f"New quest: {q['name']} (Lv {q['level']})")
    for qid, q in old["quests"].items():
        if qid not in new["quests"]:
            add("quest_removed", text=f"Quest removed or ended: {q['name']}")

    for nid, n in new["npcs"].items():
        if nid not in old["npcs"]:
            add("npc_new", npc=nid, text=f"New NPC: {n['name']}")

    log_file = Path(log_path)
    log = json.loads(log_file.read_text()) if log_file.exists() else []
    log = entries + log
    log_file.write_text(json.dumps(log, ensure_ascii=False, indent=1))
    print(f"{len(entries)} new log entries")


if __name__ == "__main__":
    main(*sys.argv[1:4])
