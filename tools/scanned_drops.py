"""Merges the drop scanner's published counts (tools/scanned_drops.json) into the site's drop tables.

The file holds raw counts, written by tracker/tools/publish_drops.py once the data has passed its
checks. Only the owner's own scanner sessions go in there, never lists from other sites.

For each drop of a monster, the rate with the most kills behind it is the one shown:
  * a drop with no rate yet gets the scanner's
  * a counted drop keeps its rate unless the scanner has counted more kills of that monster
  * a counted drop the scanner hasn't seen keeps its rate (too few kills to say it never drops)
"""
import json
import math
from pathlib import Path

DEFAULT = Path(__file__).resolve().parent / "scanned_drops.json"


def rate_range(hits, kills, z=1.96):
    """Where the true chance probably lies, in percent (a 95% Wilson interval)."""
    p, z2 = min(1.0, hits / kills), z * z
    middle = p + z2 / (2 * kills)
    spread = z * math.sqrt(p * (1 - p) / kills + z2 / (4 * kills * kills))
    bottom = 1 + z2 / kills
    return [round(max(0.0, (middle - spread) / bottom) * 100, 2), round(min(1.0, (middle + spread) / bottom) * 100, 2)]


def _row(item_id, hits, kills):
    return {"item": item_id, "rate": round(100 * hits / kills, 2), "kills": kills, "source": "scanned",
            "range": rate_range(hits, kills)}


def _put(rows, row):
    """Adds or updates one drop's row, keeping whichever rate has more kills behind it."""
    for k, have in enumerate(rows):
        if have["item"] == row["item"]:
            if have.get("rate") is None or (have.get("kills") or 0) < row["kills"]:
                if have.get("rate") is not None:    # (kept: the next publish still compares against it)
                    row["was"] = {"rate": have["rate"], "kills": have.get("kills")}
                rows[k] = row
            return
    rows.append(row)


def merge(drops_by_mob, used_items, slug, mob_known, item_known, item_gid, path=DEFAULT):
    """Puts the published counts into drops_by_mob. Returns {monster: average mesos per drop}. A name
    the game data doesn't know stops the build, so a bad file can't reach the site."""
    path = Path(path)
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    mesos = {}

    def check(mob, name):
        if not mob_known(mob):
            raise SystemExit(f"{path.name}: unknown monster {mob!r}")
        if name is not None and not item_known(name):
            raise SystemExit(f"{path.name}: unknown item {name!r}")

    for mob, counts in data.get("monsters", {}).items():
        check(mob, None)
        kills = counts["kills"]
        if not isinstance(kills, int) or kills <= 0:
            raise SystemExit(f"{path.name}: {mob} has {kills!r} kills")
        rows = drops_by_mob.setdefault(mob, [])
        for name, hits in counts.get("drops", {}).items():
            check(mob, name)
            if not isinstance(hits, int) or not 0 < hits <= kills:
                raise SystemExit(f"{path.name}: {mob} dropped {name} {hits!r} times in {kills} kills")
            _put(rows, _row(slug(name), hits, kills))
            used_items.setdefault(name, item_gid(name))
        m = counts.get("mesos")
        if m and m.get("times"):
            if not 0 < m["times"] <= kills:
                raise SystemExit(f"{path.name}: {mob} dropped mesos {m['times']!r} times in {kills} kills")
            _put(rows, _row("meso", m["times"], kills))
            used_items.setdefault("Meso", None)
            mesos[mob] = round(m["total"] / m["times"])
    for mob, names in data.get("seen", {}).items():
        for name in names:
            check(mob, name)
            rows = drops_by_mob.setdefault(mob, [])
            if not any(d["item"] == slug(name) for d in rows):
                rows.append({"item": slug(name), "rate": None, "kills": None})
                used_items.setdefault(name, item_gid(name))
    return mesos
