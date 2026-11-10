"""The page of which monster drops what (mobbook.py): made-up sessions, and real names from the database."""
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import mobbook  # noqa: E402
from linecount import LineCounter  # noqa: E402
from scandata import SCANNER_VERSION, GameData  # noqa: E402

failures = 0


def check(what, ok):
    global failures
    print(("ok   " if ok else "FAIL ") + what)
    failures += not ok


data = GameData(ROOT / "assets" / "scan_data.json")

# The same pickups counted three ways: the largest, not the sum.
one = {"version": SCANNER_VERSION, "kills": {"Fire Boar": 5}, "drop_list": {"Fire Boar": {"Fire Boar's Tooth": 2}},
       "line": {"solo_kills": {"Fire Boar": 40}, "kills": {"Fire Boar": 10}, "drops": {"Fire Boar": {"Fire Boar's Tooth": 3, "Orange Potion": 1}},
                "listed": {"Fire Boar": {"Fire Boar's Tooth": [9, 40], "Leather": [0, 40]}}, "mesos": {"Fire Boar": [4, 400]},
                "on_maps": {"The Burnt Land I": {"Fire Boar's Tooth": 9, "Orange Potion": 4, "Silver Ore": 1}, "Henesys": {"Red Potion": 1}}}}
two = {"version": SCANNER_VERSION, "line": {"solo_kills": {"Fire Boar": 10}, "listed": {"Fire Boar": {"Fire Boar's Tooth": [1, 10]}},
                                            "on_maps": {"The Burnt Land I": {"Orange Potion": 1}}}}
t = mobbook.add_up([one, two])
boar = t["mobs"]["Fire Boar"]
check("a session's counts of one pickup aren't added together", boar["items"]["Fire Boar's Tooth"] == 10)
check("sessions are added together", boar["kills"] == 50)
check("an item found once is kept", boar["items"]["Orange Potion"] == 1)
check("an item never picked up isn't listed", "Leather" not in boar["items"])
check("mesos are kept", boar["mesos"] == [4, 400])
check("maps are added together", t["maps"]["The Burnt Land I"]["Orange Potion"] == 5)

# What's on the page.
old = {"version": SCANNER_VERSION - 1, "line": {"solo_kills": {"Evil Eye": 50}, "drops": {"Evil Eye": {"Iron Ore": 5}}}}
text = mobbook.page([one, two], [old], data, now="now")
check("the monster's there", "<h3>Fire Boar" in text)
check("with its rough rate", "<td class=n>20%</td>" in text)
check("a drop the site doesn't list says so", "Orange Potion <span" in text or "not on the site" in text)
check("an old hunt's marked as untrustworthy", "names or counts may be off" in text and "Iron Ore" in text)
check("older hunts stay folded when there are new ones", "<details>" in text)
check("a map's picks say who's known to drop them", "Fire Boar" in text.split("Everything picked up")[1])
check("a town isn't a hunting map", "<h3>Henesys" not in text)

too_many = {"version": SCANNER_VERSION, "line": {"solo_kills": {"Dark Axe Stump": 31}, "listed": {"Dark Axe Stump": {"Firewood": [54, 31]}}}}
text = mobbook.page([too_many], [], data, now="now")
check("more picked up than kills named gives no rate", "174%" not in text and "<td class=n>54</td><td class=n></td>" in text)
check("few kills give no rate", "%</td>" not in mobbook.page([{"version": SCANNER_VERSION, "line": {"solo_kills": {"Slime": 3}, "listed": {"Slime": {"Squishy Liquid": [1, 3]}}}}], [], data, now="now"))
check("no new hunts: older ones are open, and it says so", "<details open>" in mobbook.page([], [old], data, now="now") and "No hunts" in mobbook.page([], [old], data, now="now"))
check("a name can't break the page", "<b>" not in mobbook.page([{"version": SCANNER_VERSION, "kills": {"<b>": 1}}], [], None, now="now").split("<h1>")[1].split("<details")[0].replace("<b>(", ""))

# The files.
with tempfile.TemporaryDirectory() as folder:
    folder = Path(folder)
    (folder / "session-1.json").write_text(json.dumps(one), encoding="utf-8")
    (folder / "session-2.json").write_text("not json", encoding="utf-8")
    (folder / "session-3.json").write_text(json.dumps(old), encoding="utf-8")
    new, stale = mobbook.load_sessions(folder)
    check("sessions are sorted by version, and a broken file's skipped", len(new) == 1 and len(stale) == 1)
    out = folder / "a new folder" / mobbook.FILE_NAME
    check("the page's written, and its folder made", mobbook.write_page(folder, out, data) == out and "Fire Boar" in out.read_text(encoding="utf-8"))
    check("nothing left behind", not out.with_suffix(".tmp").exists())
    blocked = folder / "session-1.json" / mobbook.FILE_NAME
    check("not being able to write doesn't stop anything", mobbook.write_page(folder, blocked, data) is None)

# Every pickup goes on the map's list.
c = LineCounter(data)
c.set_map("The Burnt Land I", 0.0)
c.pickup("Orange Potion", 1, 1.0)
c.pickup("mesos", 50, 2.0)
c.set_map(None, 3.0)
c.pickup("Red Potion", 1, 4.0)
check("a pickup goes on its map's list, without mesos or an unknown map", c.results(5.0)["on_maps"] == {"The Burnt Land I": {"Orange Potion": 1}})

# The scanner keeps it up to date as it saves.
with tempfile.TemporaryDirectory() as folder:
    from dropscan import DropScan
    folder = Path(folder)
    out = folder / "book" / mobbook.FILE_NAME
    scan = DropScan(ROOT / "assets", folder / "drops", book=out)
    scan.map_seen("The Burnt Land I", 1.0)
    scan.lines.kill(data.exp_of("fire_boar"), 2.0)
    scan.lines.pickup("Red Viper", 1, 3.0)
    scan.inventory = lambda: [("Red Viper", "Equip", 0, 1, 1, 1, 1.0)]
    scan.save()
    saved = json.loads(next((folder / "drops").glob("session-*.json")).read_text(encoding="utf-8"))
    check("the inventory's check is kept with the session", saved["inventory"] == [["Red Viper", "Equip", 0, 1, 1, 1, 1.0]])
    check("so is how much EXP came all at once", "exp_lump" in saved["line"]["read"])
    text = out.read_text(encoding="utf-8") if out.exists() else ""
    check("saving writes the page, with this hunt on it", "Red Viper" in text and "The Burnt Land I" in text)
    scan.finish()

print("FAILED" if failures else "All good")
sys.exit(1 if failures else 0)
