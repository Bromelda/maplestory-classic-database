"""Makes the scanner's data from the fan database's own files: assets/scan_data.json (monsters, EXP,
known drops, which monsters live on which map), assets/mob/ (monster sprites) and assets/icons/ (the
pictures of mesos and of everything monsters drop, which is how drops are spotted on the ground). A picture
the site doesn't have is downloaded from the same game-data service the site uses.

Run it from anywhere after the database updates:  python tracker/tools/make_scan_data.py"""
import json
import re
import shutil
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
SITE = HERE.parent
ICON_API = "https://maplestory.io/api/MCW/1/item/{gid}/icon"
MOB_API = "https://maplestory.io/api/MCW/1/mob/{gid}"
UA = {"User-Agent": "maplestory-classic-db-updater (github.com/Bromelda/maplestory-classic-database)"}
COINS = (9000000, 9000001, 9000002, 9000003)


def load(name):
    return json.loads((SITE / "data" / f"{name}.json").read_text(encoding="utf-8"))


def fetch_icon(gid, path):
    req = urllib.request.Request(ICON_API.format(gid=gid), headers={"User-Agent": "maplestory-classic-db-updater (github.com/Bromelda/maplestory-classic-database)"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            png = r.read()
    except OSError as e:
        print(f"No picture for {gid}: {e}")
        return False
    if not png.startswith(b"\x89PNG"):
        return False
    path.write_bytes(png)
    time.sleep(0.2)                     # (be gentle with the service)
    return True


def heal_of(effect):
    """What an item's "Recovers 100 HP and 50% MP" comes to: {"hp": 100, "mp_pct": 0.5}, or {}."""
    out = {}
    for amount, pct, stat in re.findall(r"(\d+)(%?)\s*(HP|MP)", str(effect or "")):
        out[f"{stat.lower()}_pct" if pct else stat.lower()] = int(amount) / 100 if pct else int(amount)
    return out if str(effect or "").startswith("Recovers") else {}


def make_poses(gids):
    """How each monster looks when it's hit and when it dies, which the site's sprites don't show."""
    folder = HERE / "assets" / "mob_poses"
    folder.mkdir(exist_ok=True)
    made = 0
    for gid in sorted(set(gids)):
        if list(folder.glob(f"{gid}_*.png")):
            continue
        req = urllib.request.Request(MOB_API.format(gid=gid), headers=UA)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                books = json.load(r).get("framebooks") or {}
        except (OSError, ValueError) as e:
            print(f"No poses for monster {gid}: {e}")
            continue
        for book in ("hit1", "die1"):
            for k in range(min(int(books.get(book) or 0), 4)):
                req = urllib.request.Request(f"{MOB_API.format(gid=gid)}/render/{book}/{k}", headers=UA)
                try:
                    with urllib.request.urlopen(req, timeout=30) as r:
                        png = r.read()
                except OSError:
                    continue
                if png.startswith(b"\x89PNG"):
                    (folder / f"{gid}_{book}_{k}.png").write_bytes(png)
                    made += 1
                time.sleep(0.15)
    print(f"Poses: {made} downloaded, {len(list(folder.glob('*.png')))} in all")


def make_icons(gids):
    folder = HERE / "assets" / "icons"
    folder.mkdir(exist_ok=True)
    copied = fetched = 0
    for gid in sorted(set(gids) | set(COINS)):
        path = folder / f"{gid}.png"
        if path.exists():
            continue
        site = SITE / "assets" / "item" / f"{gid}.png"
        if site.exists():
            shutil.copy2(site, path)
            copied += 1
        elif fetch_icon(gid, path):
            fetched += 1
    print(f"Pictures: {copied} copied, {fetched} downloaded, {len(list(folder.glob('*.png')))} in all")


def main():
    all_items = load("items")
    items = {i["id"]: i["name"] for i in all_items}
    gid_by_name = {i["name"]: i["gid"] for i in all_items if i.get("gid")}
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
    item_gids = {n: gid_by_name[n] for m in monsters.values() for n in m["drops"] if n in gid_by_name}
    heals = {i["name"]: heal_of(i.get("effect")) for i in all_items if heal_of(i.get("effect"))}
    heal_gids = {n: gid_by_name[n] for n in heals if n in gid_by_name}
    shop_prices = {}
    for i in all_items:
        asked = [s["price"] for s in i.get("shops") or [] if s.get("price")]
        if i.get("type") == "Use" and (i.get("shop_price") or asked):
            shop_prices[i["name"]] = i.get("shop_price") or min(asked)
    out.write_text(json.dumps({"monsters": monsters, "maps": maps, "item_gids": item_gids, "heals": heals, "heal_gids": heal_gids, "shop_prices": shop_prices}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    make_icons(list(item_gids.values()) + list(heal_gids.values()))
    make_poses(m["gid"] for m in monsters.values())
    sprites = HERE / "assets" / "mob"
    sprites.mkdir(exist_ok=True)
    n = 0
    for gif in (SITE / "assets" / "mob").glob("*.gif"):
        shutil.copy2(gif, sprites / gif.name)
        n += 1
    print(f"{len(monsters)} monsters, {len(maps)} maps, {n} sprites")


if __name__ == "__main__":
    main()
