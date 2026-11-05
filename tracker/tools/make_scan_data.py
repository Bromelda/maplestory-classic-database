"""Makes the scanner's data from the fan database's own files: assets/scan_data.json (monsters, EXP,
known drops, which monsters live on which map) and assets/mob/ (monster sprites).

Run it from anywhere after the database updates:  python tracker/tools/make_scan_data.py"""
import json
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
SITE = HERE.parent


def load(name):
    return json.loads((SITE / "data" / f"{name}.json").read_text(encoding="utf-8"))


def main():
    items = {i["id"]: i["name"] for i in load("items")}
    monsters = {}
    for m in load("monsters"):
        drops = [items.get(d["item"], d["item"]) for d in m.get("drops", []) if d.get("item") != "meso"]
        monsters[m["id"]] = {"name": m["name"], "gid": m["gid"], "exp": m.get("exp"), "level": m.get("level"),
                             "boss": bool(m.get("boss")), "size": m.get("sprite_size"), "drops": drops}
    extra = SITE / "tools" / "player_drops.json"
    if extra.is_file():
        names = {m["name"]: mid for mid, m in monsters.items()}
        for name, got in json.loads(extra.read_text(encoding="utf-8")).items():
            if name in names:
                have = monsters[names[name]]["drops"]
                have.extend(g for g in got if g not in have)
    maps = {}
    for mp in load("maps"):
        spawns = [s["monster"] for s in mp.get("spawns", []) if s["monster"] in monsters]
        maps[mp["name"]] = {"id": mp["id"], "spawns": spawns, "size": mp.get("size")}
    out = HERE / "assets" / "scan_data.json"
    out.write_text(json.dumps({"monsters": monsters, "maps": maps}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    sprites = HERE / "assets" / "mob"
    sprites.mkdir(exist_ok=True)
    n = 0
    for gif in (SITE / "assets" / "mob").glob("*.gif"):
        shutil.copy2(gif, sprites / gif.name)
        n += 1
    print(f"{len(monsters)} monsters, {len(maps)} maps, {n} sprites")


if __name__ == "__main__":
    main()
