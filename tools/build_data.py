#!/usr/bin/env python3
"""Build data/*.json for MapleStory Classic DB from cross-checked Classic-only sources.

Inputs (pass the folder of a checkout of Club FM's public data, branch `live`):
    git clone --depth 1 --filter=blob:none --sparse --branch live \
        https://github.com/maplefm/maplefm.github.io fm
    cd fm && git sparse-checkout set --no-cone '/data/*' '!/data/sprite/'
    python3 tools/build_data.py path/to/fm/data

Images: copy <fm>/data/minimap/<mapId>.png to assets/minimap/ and <fm>/data/sprite/<mobId>.gif
to assets/mob/ before running (they come from the Classic World game files).

Source rules (see README "Data sources"):
  * Monster stats come from the Classic World game files (via Club FM / maplestory.io)
    and are kept only when a second Classic source (NiaDB, MapleStoryClassic.org /
    MapleClassic Wiki) agrees. Disagreements are resolved in OVERRIDES below, with the
    old value kept in `previous` so nothing is hidden.
  * Drops are player-counted Classic World kills from the MapleClassic Wiki only.
    Old GMS/MSEA tables are never used.
  * Maps, portals and spawns: MapleClassic Wiki + Classic game files.
"""
import json
import re
import sys
from pathlib import Path

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else "fm/data")
OUT = Path(__file__).resolve().parent.parent / "data"

# Monsters changed by a patch, where some sites still show the old number.
# The game files hold the current value; Nexon's v1.1.0 patch notes (Oct 29, 2026)
# confirm these four had their HP lowered. The old value is kept for reference.
PATCHED = {
    "Clang": {"hp": 2899},
    "Copper Drake": {"hp": 2595},
    "Drake": {"hp": 3218},
    "Tortie": {"hp": 2671},
}
PATCH_NOTE = "v1.1.0 patch, Oct 29, 2026"

# Manual Classic-only meso ranges with direct evidence. Keep these small and sourced.
# They are used only when the upstream Classic dataset has no observed meso range.
MESO_OVERRIDES = {
    "Fire Boar": {"min": 63, "max": 77, "basis": "reported"},
}

# Second Classic source that matched each monster's level/HP/EXP.
NIADB_MATCH = "NiaDB"
ORG_MATCH = "MapleStoryClassic.org"
# Only confirmed by game files + MapleStoryClassic.org (not listed on NiaDB's table).
ORG_ONLY = {"Fairy 1", "Orange Slime", "Ultra Jr. Necki 1"}

VARIANT_RE = re.compile(r"\((.+)\)$")


def slug(s):
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")


TOWNS = {"Ellinia", "Florina Beach", "Henesys", "Kerning City", "Perion",
         "Lith Harbor", "Sleepywood", "Amherst", "Southperry"}
ZONE_ALIAS = {
    "Mushroom Town (Nina)": "Mushroom Town",
    "Mushroom Town (Roger)": "Mushroom Town",
    "Mushroom Town - West Entrance": "Mushroom Town",
    "Ellinia Station": "Ellinia",
    "Niora Hospital": "Kerning City",
    "Free Market Entrance": "Free Market",
    "Truth Booth": "Other",
}


BUILD_DAY = __import__("datetime").date.today().isoformat()


def job_text(ids):
    """Game job ids -> readable requirement ('' = any job)."""
    if not ids or len(ids) > 20:
        return None
    names = {0: "Beginner", 1: "Warrior", 2: "Magician", 3: "Bowman", 4: "Thief"}
    out = []
    for j in ids:
        n = names.get(0 if j == 0 else j // 100)
        if n and n not in out:
            out.append(n)
    return " / ".join(out) or None


def zone_for(m):
    """Group a map into one clickable area of the world map."""
    name, area = m["name"], m["area"]
    if area:
        return ZONE_ALIAS.get(area, area)
    if name in TOWNS:
        return name
    if name.startswith("1st Accompaniment"):
        return "Kerning City PQ"
    if name.startswith("Free Market"):
        return "Free Market"
    if name == "The Grave of Mushmom":
        return "Sleepywood"
    return "Other"


def main():
    world = json.loads((SRC / "world.json").read_text())
    guide = json.loads((SRC / "itemguide.json").read_text())
    itemdb = json.loads((SRC / "itemdb.json").read_text())
    kinds = itemdb["kinds"]
    item_rows = {}
    for r in itemdb["items"]:
        item_rows.setdefault(r[1], r)
    guide_ids = guide["ids"]

    mobs_src = world["mobs"]
    maps_src = world["maps"]
    gid_to_mob = {m["id"]: name for name, m in mobs_src.items()}

    # ---------- drops (Classic kill counts only) ----------
    drops_by_mob = {}
    used_items = {}
    for item_name, info in guide["items"].items():
        for row in info.get("d", []):
            mob_name, _lv, rate, kills, _map, _x, mob_gid = row
            mob = gid_to_mob.get(mob_gid, mob_name)
            drops_by_mob.setdefault(mob, []).append({
                "item": slug(item_name),
                "rate": rate,
                "kills": kills or None,
            })
            used_items[item_name] = guide_ids.get(item_name)

    # ---------- monsters ----------
    monsters = []
    for name, m in sorted(mobs_src.items(), key=lambda kv: (kv[1]["lv"], kv[0])):
        variant = None
        vm = VARIANT_RE.search(name)
        if vm:
            variant = vm.group(1)
        hp = m["hp"]
        previous = None
        sources = ["Classic game files"]
        sources.append(ORG_MATCH if name in ORG_ONLY else NIADB_MATCH)
        if name in PATCHED:
            previous = {"hp": PATCHED[name]["hp"], "until": PATCH_NOTE}
            sources = ["Classic game files", "Nexon patch notes (HP lowered)"]
        meso = None
        if m.get("meso") and m["meso"][0] is not None:
            meso = {"min": m["meso"][0], "max": m["meso"][1], "basis": m["meso"][3]}
        elif name in MESO_OVERRIDES:
            meso = dict(MESO_OVERRIDES[name])
        d = sorted(drops_by_mob.get(name, []), key=lambda x: -(x["rate"] or 0))
        monsters.append({
            "id": slug(name),
            "gid": m["id"],
            "name": name,
            "variant": variant,
            "level": m["lv"],
            "hp": hp,
            "exp": m["exp"],
            "atk": m["atk"],
            "matk": m["matk"],
            "acc": m["acc"],
            "avoid": m["eva"],
            "wdef": m["wdef"],
            "mdef": m["mdef"],
            "knockback": m["kb"],
            "weak": m["weak"] or None,
            "resist": m["resist"] or None,
            "undead": m["undead"],
            "boss": m["boss"],
            "sprite": (OUT.parent / "assets" / "mob" / f"{m['id']}.gif").exists(),
            "meso": meso,
            "drops": d,
            "sources": sources,
            "previous": previous,
        })

    # ---------- quests ----------
    name_to_gid = {}
    for r in itemdb["items"]:
        name_to_gid.setdefault(r[0], r[1])
    map_npc_names = {n[0] for mp in maps_src.values() for n in mp["npcs"]}
    gid_name = {}
    for q in guide["quests"]:
        gid_name.setdefault(q["gid"], q["g"])

    def npc_ref(name):
        if not name:
            return None
        if name in map_npc_names:
            return slug(name)
        base = re.sub(r"\s*\(.*\)$", "", name)
        return slug(base) if base in map_npc_names else slug(name)

    def use_item(name):
        used_items.setdefault(name, guide_ids.get(name) or name_to_gid.get(name))
        return slug(name)

    quests = []
    skipped = {"ended": 0, "unreleased": 0}
    for q in guide["quests"]:
        if q.get("ended") or (q.get("to") and q["to"] < BUILD_DAY):
            skipped["ended"] += 1
            continue
        if q["a"] == "Forgotten Hollow" or (q.get("from") and q["from"] > BUILD_DAY):
            skipped["unreleased"] += 1
            continue
        kills = []
        for name, count, mob_gid in q["kill"]:
            kills.append({"monster": slug(gid_to_mob.get(mob_gid, name)), "count": count})
        choice = [{"item": use_item(n), "count": c, "note": note} for n, c, note in (q.get("get2") or [])]
        end_name = gid_name.get(q["end"])
        quests.append({
            "id": f"q{q['id']}",
            "name": q["n"],
            "level": q["lv"],
            "max_level": q.get("lv2"),
            "area": q["a"],
            "where": q.get("town"),
            "giver": npc_ref(q["g"]),
            "giver_name": q["g"],
            "ender": npc_ref(end_name),
            "ender_name": end_name,
            "jobs": job_text(q["jobs"]),
            "repeatable": bool(q["rep"]),
            "pre": [f"q{x}" for x in q["pre"]],
            "start_items": [{"item": use_item(n), "count": c} for n, c in (q.get("start") or [])],
            "need": [{"item": use_item(n), "count": c} for n, c in q["need"]],
            "kill": kills,
            "cost": q.get("cost"),
            "skill": q.get("skill"),
            "prof": q.get("prof"),
            "steps": q.get("steps"),
            "exp": q["exp"],
            "meso": q["meso"],
            "fame": q["fame"],
            "rewards": [{"item": use_item(n), "count": c} for n, c in q["get"]],
            "choice": choice,
            "event": q["a"] == "Event",
            "unconfirmed": q.get("unconfirmed"),
        })
    qids = {q["id"] for q in quests}
    for q in quests:
        q["pre"] = [x for x in q["pre"] if x in qids]

    # ---------- items (Classic drops + quest items) ----------
    items = []
    for name, gid in sorted(used_items.items()):
        row = item_rows.get(gid) if gid else None
        kind = kinds[row[5]] if row and row[5] < len(kinds) else None
        pot = world["pots"].get(name)
        effect = None
        if pot:
            parts = []
            if pot.get("hp"):
                parts.append(f"{pot['hp']}{'%' if pot['pct'] else ''} HP")
            if pot.get("mp"):
                parts.append(f"{pot['mp']}{'%' if pot['pct'] else ''} MP")
            effect = "Recovers " + " and ".join(parts) if parts else None
        items.append({
            "id": slug(name),
            "gid": gid,
            "name": name,
            "type": kind.split(":")[0] if kind else None,
            "category": kind.split(":")[1] if kind else None,
            "level": (row[2] or None) if row else None,
            "sell": (row[6] or None) if row else None,
            "shop_price": pot.get("npc") if pot else None,
            "effect": effect,
            "stats": row[7] if row and len(row) > 7 else None,
        })

    # ---------- maps ----------
    maps = []
    for name, mp in maps_src.items():
        portals = []
        for p in mp["portals"]:
            portals.append({"to": slug(p[0]), "kind": p[1], "x": p[2], "y": p[3]})
        spawns = [{"monster": slug(mn), "count": c} for mn, c in mp["mobs"]]
        respawn = {slug(k): v for k, v in (mp.get("respawn") or {}).items()}
        mm = mp.get("mm")
        maps.append({
            "id": slug(name),
            "gid": mp["id"],
            "name": name,
            "region": mp["region"],
            "area": mp["near"] or None,
            "type": mp["type"] or None,
            "levels": mp["lv"] if mp["lv"] and mp["lv"][0] is not None else None,
            "town": mp["town"],
            "spawns": spawns,
            "respawn": respawn or None,
            "portals": portals,
            "npcs": [{"npc": slug(n[0]), "x": n[1], "y": n[2]} for n in mp["npcs"]],
            "size": [mp["w"], mp["h"]],
            "origin": [mm[0], mm[1]] if mm else None,
            "minimap": bool(mm) and (OUT.parent / "assets" / "minimap" / f"{mp['id']}.png").exists(),
            "mobpos": [[slug(gid_to_mob.get(g, str(g))), x, y] for g, x, y in mp["mobpos"]],
        })
    for m in maps:
        m["zone"] = zone_for(m)

    # ---------- NPCs ----------
    npcs = {}
    for mp in maps_src.values():
        for name, x, y, role in mp["npcs"]:
            n = npcs.setdefault(slug(name), {"id": slug(name), "name": name, "role": None, "locations": []})
            n["role"] = n["role"] or role or None
            n["locations"].append({"map": slug(mp["name"]), "x": x, "y": y})
            if name in (mp.get("shops") or []):
                n["shop"] = True
    for q in quests:
        for key, nm in (("giver", "giver_name"), ("ender", "ender_name")):
            if q[key] and q[key] not in npcs:
                npcs[q[key]] = {"id": q[key], "name": re.sub(r"\s*\(.*\)$", "", q[nm]) or q[nm], "role": None, "locations": []}
    npcs = sorted(npcs.values(), key=lambda n: n["name"])
    maps.sort(key=lambda m: (m["region"], m["area"] or "~", m["name"]))

    # sanity: every reference resolves
    mob_ids = {m["id"] for m in monsters}
    map_ids = {m["id"] for m in maps}
    item_ids = {i["id"] for i in items}
    for m in maps:
        for s in m["spawns"]:
            assert s["monster"] in mob_ids, (m["name"], s)
        for p in m["portals"]:
            assert p["to"] in map_ids, (m["name"], p)
    for m in monsters:
        for d in m["drops"]:
            assert d["item"] in item_ids, (m["name"], d)
    npc_ids = {n["id"] for n in npcs}
    for q in quests:
        for k in ("giver", "ender"):
            assert q[k] is None or q[k] in npc_ids, (q["name"], k)
        for lst in ("need", "rewards", "choice", "start_items"):
            for x in q[lst]:
                assert x["item"] in item_ids, (q["name"], x)

    meta = {
        "built_from": f"Club FM public data, built {world.get('built')}",
        "classic_version": "MapleStory Classic World (game version 0.9.0 drop logs)",
    }
    for fname, data in [("monsters", monsters), ("items", items), ("maps", maps), ("npcs", npcs), ("quests", quests)]:
        (OUT / f"{fname}.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    (OUT / "meta.json").write_text(json.dumps(meta, indent=2))
    print(f"monsters {len(monsters)}, items {len(items)}, maps {len(maps)}, "
          f"drop rows {sum(len(m['drops']) for m in monsters)}, npcs {len(npcs)}, "
          f"quests {len(quests)} (skipped {skipped})")


if __name__ == "__main__":
    main()
