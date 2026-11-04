#!/usr/bin/env python3
"""Build data/*.json for MapleStory Classic DB from cross-checked Classic-only sources.

Inputs (pass the folder of a checkout of Club FM's public data, branch `live`):
    git clone --depth 1 --filter=blob:none --sparse --branch live \
        https://github.com/maplefm/maplefm.github.io fm
    cd fm && git sparse-checkout set --no-cone '/data/*' '!/data/sprite/'
    python3 tools/build_data.py path/to/fm/data

Source rules (see README "Data sources"):
  * Monster stats come from the Classic World game files (via Club FM / maplestory.io)
    and are kept only when a second Classic source (NiaDB, MapleStoryClassic.org /
    MapleClassic Wiki) agrees. Disagreements are resolved in OVERRIDES below, with the
    losing value kept in `disputed` so nothing is hidden.
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

# Monsters whose game-file value differs from two other Classic sources.
# NiaDB + MapleStoryClassic.org agree on these HP values; Club FM's launch game-file
# snapshot shows lower numbers (likely pre-patch).
OVERRIDES = {
    "Clang": {"hp": (2899, 2657)},
    "Copper Drake": {"hp": (2595, 2379)},
    "Drake": {"hp": (3218, 2950)},
    "Tortie": {"hp": (2671, 2226)},
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
        disputed = None
        if name in OVERRIDES:
            hp, alt = OVERRIDES[name]["hp"]
            disputed = {"hp": {"value": alt, "source": "Classic game files (launch snapshot)"}}
        sources = ["Classic game files"]
        sources.append(ORG_MATCH if name in ORG_ONLY else NIADB_MATCH)
        if name in OVERRIDES:
            sources = [NIADB_MATCH, ORG_MATCH]
        meso = None
        if m.get("meso") and m["meso"][0] is not None:
            meso = {"min": m["meso"][0], "max": m["meso"][1], "basis": m["meso"][3]}
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
            "meso": meso,
            "drops": d,
            "sources": sources,
            "disputed": disputed,
        })

    # ---------- items (everything that appears in a Classic drop) ----------
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
            "npcs": [n[0] for n in mp["npcs"]],
            "size": [mp["w"], mp["h"]],
            "origin": [mm[0], mm[1]] if mm else None,
            "mobpos": [[slug(gid_to_mob.get(g, str(g))), x, y] for g, x, y in mp["mobpos"]],
        })
    for m in maps:
        m["zone"] = zone_for(m)
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

    meta = {
        "built_from": f"Club FM public data, built {world.get('built')}",
        "classic_version": "MapleStory Classic World (game version 0.9.0 drop logs)",
    }
    for fname, data in [("monsters", monsters), ("items", items), ("maps", maps)]:
        (OUT / f"{fname}.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    (OUT / "meta.json").write_text(json.dumps(meta, indent=2))
    print(f"monsters {len(monsters)}, items {len(items)}, maps {len(maps)}, "
          f"drop rows {sum(len(m['drops']) for m in monsters)}")


if __name__ == "__main__":
    main()
