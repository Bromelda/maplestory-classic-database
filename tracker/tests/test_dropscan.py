"""The scanner's front door (dropscan.py) and the report (tools/drop_report.py): real map names, real
database data, the files it writes. Run it:  python tests/test_dropscan.py"""
import json
import shutil
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))
from dropscan import DropScan  # noqa: E402
import drop_report  # noqa: E402
import numpy as np  # noqa: E402

failures = 0


def check(name, ok, detail=""):
    global failures
    print(("PASS " if ok else "FAIL ") + name + (f"   {detail}" if detail and not ok else ""))
    failures += not ok


def line(kind, amount, born):
    return SimpleNamespace(kind=kind, amount=amount, born=born)


folder = Path(tempfile.mkdtemp(prefix="dropscan"))
try:
    scan = DropScan(ROOT / "assets", folder)
    d = scan.data
    check("knows 283 maps' monsters", len(d.maps) >= 200 and len(d.monsters) >= 80)
    check("a real map's monsters", "wild_boar" in d.species_on("The Land of Wild Boar II"), d.species_on("The Land of Wild Boar II"))
    check("a slightly misread map name still finds it", d.find_map("The Land of Wild Boar Il") == "The Land of Wild Boar II", d.find_map("The Land of Wild Boar Il"))
    check("a name that's nothing like a map isn't one", d.find_map("Zzz qqq") is None)
    check("database drops are known", d.known_drop("slime", "Hat Accuracy Scroll: Lesser"))
    check("the owner's own drops count as known", d.known_drop("pig", "Dark Nightshift"))
    check("a name cut short matches by its start", d.known_drop("slime", "Hat Accuracy..."))
    check("something unknown isn't", not d.known_drop("slime", "Dragon Scale"))

    one_kind = next(name for name, m in d.maps.items() if len(m["spawns"]) == 1)
    species = d.maps[one_kind]["spawns"][0]
    scan.map_seen(one_kind, 1.0)
    check("a new map loads its sprites", species in scan.field.bank.raw and scan.ledger.species_here == [species], scan.ledger.species_here)
    scan.map_seen("Zzz qqq", 2.0)
    check("a misread name doesn't change the map", scan.map == one_kind, scan.map)

    # No monsters visible on a blank picture, just the message lines: a one-monster map's list still works.
    frame = np.full((1080, 1920, 3), 80, np.uint8)
    scan.look(frame, 3.0)
    scan.heard([line("exp", d.exp_of(species), 10.0)], [], 10.0)
    scan.heard([], [("item", "Dragon Scale", 1, "Etc")], 12.0)
    scan.heard([], [("mesos", 25)], 13.0)
    for t in range(14, 40):
        scan.look(frame, float(t))
    name = d.name_of(species)
    res = scan.results()
    check("the list from the lines", res["drop_list"].get(name, {}).get("Dragon Scale") == 1, res)
    check("flagged as new for the database", "Dragon Scale" in res["new_drops"].get(name, []), res["new_drops"])
    check("not in the rate (nothing watched)", not res["rate_drops"], res["rate_drops"])
    scan.save()
    saved = sorted(folder.glob("session-*.json"))
    check("a session file was written", len(saved) == 1, saved)
    logged = [json.loads(x) for x in (folder / "log.jsonl").read_text(encoding="utf-8").splitlines()]
    check("the log has it", any(e["item"] == "Dragon Scale" and e["monster"] == name for e in logged), logged)

    # A party line, and bonus lines aren't kills.
    before = sum(scan.ledger.kills_seen.values())
    scan.heard([line("bonus", 4, 50.0)], [], 50.0)
    check("a party bonus line isn't a kill", sum(scan.ledger.kills_seen.values()) == before)
    check("...but it does mean a party", scan.ledger._party(55.0))

    # The sprites' size is remembered for each window size, and a new window size starts again.
    scan.field.bank.scale = 0.66
    scan.look(frame, 60.0)
    check("the size is remembered", json.loads((folder / "sprite_sizes.json").read_text())["1080"] == 0.66)
    again = DropScan(ROOT / "assets", folder)
    again.look(frame, 1.0)
    check("...for next time", again.field.bank.scale == 0.66, again.field.bank.scale)
    again.look(np.full((720, 1280, 3), 80, np.uint8), 2.0)
    check("a new window size forgets it", again.field.bank.scale is None, again.field.bank.scale)
    again.look(frame, 3.0)
    check("...and going back brings it back", again.field.bank.scale == 0.66, again.field.bank.scale)

    # What the map tells it.
    m = DropScan(ROOT / "assets", folder)
    m.scales = {}
    check("before a map's read, it says so", "not read yet" in m.map_lines()[0], m.map_lines())
    m.map_seen("Land of Wild Boar", 1.0)
    got = m.map_lines()
    check("it shows the map's monsters and EXP", "Wild Boar (46 EXP, 22 here)" in got[0] and "Dark Axe Stump (43 EXP, 7 here)" in got[0], got)
    check("it says which kinds can't be told apart", any("Jr. Boogie 1 and Jr. Boogie 2" in x for x in got), got)
    check("it says how many items only one kind drops", any("known from only one" in x for x in got), got)
    m.lines.kill(46, 2.0)
    check("a kill named from the map's own numbers", m.lines.open and m.lines.open.species == "wild_boar")
    m.map_lost(3.0)
    check("the map's name out of sight: it says so", "Open the minimap" in m.map_lines()[0], m.map_lines())
    m.lines.kill(46, 4.0)
    check("and kills stop counting", m.lines.skipped["nomap"] == 1 and not m.lines.open, m.lines.skipped)
    m.map_seen(None, 5.0)
    check("still not known with no name", m.blind)
    m.map_seen("Land of Wild Boar", 6.0)
    m.lines.kill(46, 7.0)
    check("the name back: they count again", m.lines.open is not None and not m.blind)
    m.map_seen("The Land of Wild Boar II", 8.0)
    check("a new map starts anew", m.lines.open is None and m.lines.map == "The Land of Wild Boar II", m.lines.map)
    m.map_seen("Henesys Market", 9.0)
    if m.map == "Henesys Market":
        check("a map with no monsters says so", "no monsters" in m.map_lines()[0], m.map_lines())
    told = []
    m.on_map = told.append
    m.map_seen("Land of Wild Boar", 10.0)
    check("the item reader's told what can drop here", told and "Firewood" in told[0], told[:1])
    m.mesos_seen(1000, 11.0)
    m.lines.pickup("mesos", 40, 12.0)
    m.mesos_seen(1040, 13.0)
    check("mesos are checked on a hunting map", m.lines.meter.total["mesos_box"] == 40)
    nomob = next(n for n, v in d.maps.items() if not v["spawns"])
    m.map_seen(nomob, 14.0)
    m.mesos_seen(1500, 15.0)
    check("not on a map with no monsters (it may be a shop)", m.lines.meter.total["mesos_box"] == 40, m.lines.meter.total)

    # Adding up two sessions.
    (folder / "session-a.json").write_text(json.dumps({"counted": 10, "skipped": {"left": 2}, "untied_pickups": 1,
        "drop_list": {"Pig": {"Pig's Ribbon": 3}}, "new_drops": {"Pig": ["Thing"]}, "kills": {"Pig": 10},
        "rate_drops": {"Pig": {"Pig's Ribbon": 3}}, "rate_mesos": {"Pig": [5, 100]}}), encoding="utf-8")
    (folder / "session-b.json").write_text(json.dumps({"counted": 30, "skipped": {"left": 1, "mixed": 4}, "untied_pickups": 0,
        "drop_list": {"Pig": {"Pig's Ribbon": 2, "<b>x</b>": 1}}, "new_drops": {"Pig": ["Thing", "Other"]}, "kills": {"Pig": 30},
        "rate_drops": {"Pig": {"Pig's Ribbon": 2}}, "rate_mesos": {"Pig": [15, 300]}}), encoding="utf-8")
    t = drop_report.add_up(folder)
    check("sessions add up", t["kills"]["Pig"] == 40 and t["drops"]["Pig"]["Pig's Ribbon"] == 5 and t["skipped"]["left"] == 3, t)
    check("new drops merge without repeats", t["new"]["Pig"] == ["Thing", "Other"], t["new"])
    html = drop_report.page(t)
    check("the page shows the rate", "5 in 40 kills (12.5%)" in html, html[:300])
    check("the page shows the skipped count", "kills counted" in html and "skipped" in html)
    check("names are escaped on the page", "<b>x</b>" not in html and "&lt;b&gt;" in html)
finally:
    shutil.rmtree(folder, ignore_errors=True)

print(f"\n{failures} failed" if failures else "\nAll passed")
sys.exit(1 if failures else 0)
