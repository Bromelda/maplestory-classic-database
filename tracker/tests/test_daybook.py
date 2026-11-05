"""The day's account (daybook.py) and reading HP and MP (vitals.py). The readings are from the owner's real game.

Run it:  python tests/test_daybook.py"""
import json
import shutil
import sys
import tempfile
import time
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from daybook import DayBook  # noqa: E402
from vitals import VitalsReader  # noqa: E402
import quickbar  # noqa: E402

failures = 0
HEALS = {"Red Potion": {"hp": 100}, "Meat": {"hp": 160}, "Orange Potion": {"hp": 250}, "Lemon": {"mp": 150},
         "Orange": {"mp": 50}, "Blue Potion": {"mp": 200}, "Elixir": {"hp_pct": 0.35, "mp_pct": 0.35}}


def check(name, ok, detail=""):
    global failures
    print(("PASS " if ok else "FAIL ") + name + (f"   {detail}" if detail and not ok else ""))
    failures += not ok


base = Path(tempfile.mkdtemp(prefix="daybook"))
try:
    date = ["2026-11-05"]
    path = base / "day.json"
    b = DayBook(path, HEALS, today=lambda: date[0])
    check("before any reading it asks for the inventory", "open your inventory" in b.lines()[0], b.lines())

    b.picked_mesos(50)
    b.mesos(1_000_000)
    d = b.days["2026-11-05"]
    check("the first reading is where the day starts", d["start"] == 1_000_000 and d["now"] == 1_000_000 and d["pending_mesos"] == 0, d)

    b.picked_mesos(300)
    b.mesos(1_000_300)
    check("what was picked up is what it rose by: nothing spent", d["spent"] == 0 and d["other"] == 0 and d["now"] == 1_000_300, d)

    b.picked_mesos(500)
    b.mesos(996_800)        # picked up 500, then spent 4,000 on potions
    check("a shop trip counts as spent, picked-up mesos included", d["spent"] == 4_000, d)
    check("made today takes out what was spent", "-3,200 mesos" in b.lines()[0] and "spent 4,000" in b.lines()[0], b.lines())

    b.mesos(1_046_800)      # sold something
    check("selling isn't spending", d["spent"] == 4_000 and d["other"] == 50_000, d)
    b.mesos(1_046_800)
    check("the same reading again changes nothing", d["spent"] == 4_000 and d["other"] == 50_000)

    # Potions, using jumps from the real game.
    def read(hp=None, mp=None):
        b.vitals(hp=hp, mp=mp)
        b.vitals(hp=hp, mp=mp)      # (a reading has to be seen twice)

    read(hp=(338, 878), mp=(700, 1688))
    check("the first reading isn't a heal", not d["items"] and not d["jumps"], d)
    read(hp=(498, 878))
    check("HP up by exactly a Meat is a Meat", d["items"]["Meat"]["used"] == 1, d["items"])
    read(hp=(818, 878))
    check("two at once count as two", d["items"]["Meat"]["used"] == 3, d["items"])
    read(hp=(600, 878))
    read(hp=(608, 878))
    check("HP going down, and recovering a little, aren't heals", d["items"]["Meat"]["used"] == 3 and not d["jumps"], d)
    read(hp=(828, 878))
    check("a jump that isn't a potion is kept by its size", d["jumps"].get("HP +220") == 1, d["jumps"])
    read(hp=(600, 878))
    read(hp=(878, 878))
    check("topped up: the size says nothing", d["jumps"].get("HP to full") == 1, d["jumps"])

    read(mp=(746, 1688))
    check("MP recovering by itself (+46) isn't a potion", "Lemon" not in d["items"] and "~Lemon" not in d["items"], d["items"])
    read(mp=(896, 1688))
    check("MP up by exactly a Lemon is a Lemon", d["items"]["Lemon"]["used"] == 1, d["items"])
    read(mp=(1083, 1688))
    check("+187, a boosted Lemon, is probably a Lemon", d["items"]["~Lemon"]["used"] == 1, d["items"])
    read(mp=(1000, 1688))
    read(mp=(1591, 1688))   # 35% of 1688
    check("a share of the most is matched too", d["items"]["Elixir"]["used"] == 1, d["items"])

    read(hp=(100, 900))
    read(hp=(800, 900))
    before = dict(d["jumps"])
    read(hp=(900, 950))
    check("a level up raising the most isn't a heal", d["jumps"] == before, d["jumps"])
    read(hp=(0, 950))
    read(hp=(475, 950))
    check("coming back from dying isn't a heal", d["jumps"] == before, d["jumps"])

    used = d["items"]["Meat"]["used"]
    b.vitals(hp=(900, 950))
    b.vitals(hp=(10, 950))
    b.vitals(hp=(900, 950))
    check("a single misread is ignored", d["items"]["Meat"]["used"] == used and d["jumps"] == before, d["jumps"])

    b.picked_item("Meat", 2, "Use")
    b.picked_item("Stiff Feather", 3, "Etc")
    check("potions picked up are counted", d["items"]["Meat"]["picked"] == 2)
    check("other items aren't", "Stiff Feather" not in d["items"])
    text = " ".join(b.lines())
    check("potions show picked and used", "Meat +2 −3" in text, text)
    check("a probable one is marked", "Lemon? +0 −1" in text, text)

    # Potions by their count: what you had, plus what you picked up, less what's left.
    def seen(name, value, now, looks=3):
        for k in range(looks):
            b.count(name, value, now=now + k * 0.25)

    seen("Red Potion", 200, 1000)
    red = d["items"]["Red Potion"]
    check("the first count is what you had", red["first"] == 200 and red["used"] == 0, red)
    seen("Red Potion", 199, 1010)
    check("a count falling by one is one used", red["used"] == 1 and red["seen"] == 199, red)
    seen("Red Potion", 196, 1020)
    check("falling by three is three", red["used"] == 4, red)
    b.count("Red Potion", 19, now=1030)
    b.count("Red Potion", 196, now=1030.25)
    check("one misread changes nothing", red["used"] == 4 and red["seen"] == 196, red)
    seen("Red Potion", 19, 1040, looks=7)
    check("digits lost need a lot of looks", red["seen"] == 196, red)
    seen("Red Potion", 296, 1041, looks=7)
    check("so does a big rise", red["seen"] == 196, red)
    b.count("Red Potion", 196, now=1042)
    b.picked_item("Red Potion", 5, "Use", now=1050)
    seen("Red Potion", 201, 1050.5)
    b.count("Red Potion", 201, now=1053)
    check("a rise explained by a pickup isn't bought", red["bought"] == 0 and red["used"] == 4 and red["picked"] == 5, red)
    seen("Red Potion", 204, 1060)
    b.picked_item("Red Potion", 3, "Use", now=1061)
    b.count("Red Potion", 204, now=1064)
    check("the pickup line can come after the rise", red["bought"] == 0 and red["used"] == 4 and red["picked"] == 8, red)
    b.picked_item("Red Potion", 2, "Use", now=1070)
    seen("Red Potion", 205, 1070.5)
    b.count("Red Potion", 205, now=1073)
    check("one used while picking up two", red["used"] == 5 and red["bought"] == 0, red)
    seen("Red Potion", 305, 1080, looks=8)
    b.count("Red Potion", 305, now=1085)
    check("a rise with no pickup is bought", red["bought"] == 100 and red["used"] == 5, red)
    check("it adds up", red["first"] + red["picked"] + red["bought"] - red["used"] == red["seen"], red)
    text = " ".join(b.lines())
    check("it shows the whole account", "Red Potion: had 200, picked 10, bought 100, used 5, left 305" in text, text)
    seen("Red Potion", 306, 1090)
    b.count("Red Potion", 306, now=1095)
    check("a rise of one with no line is a pickup whose line was missed", red["picked"] == 11 and red["bought"] == 100, red)
    seen("Red Potion", 305, 1096)
    check("and it still adds up", red["first"] + red["picked"] + red["bought"] - red["used"] == red["seen"], red)

    seen("Magic Potion", 21, 1900)
    b.picked_item("Magic Potion", 2, "Use", now=1910)
    seen("Magic Potion", 23, 1910.5)
    b.count("Magic Potion", 23, now=1913)
    seen("Magic Potion", 22, 1920)
    magic = d["items"]["Magic Potion"]
    check("an item that doesn't heal is counted by its count too", (magic["picked"], magic["bought"], magic["used"]) == (2, 0, 1), magic)

    seen("Salad", 0, 2000)
    b.count_at["Salad"] = -100
    before = dict(d["jumps"])
    read(mp=(100, 1688))
    read(mp=(300, 1688))
    check("a jump can't be a food you have none of", d["items"]["Salad"]["used"] == 0, d["items"]["Salad"])

    # Jumps and counts together, for an item that heals by a known amount.
    seen("Meat", 50, time.monotonic())
    meat = d["items"]["Meat"]
    used_before = meat["used"]
    read(hp=(100, 950))
    read(hp=(260, 950))
    check("while the count's in view, a jump adds nothing", meat["used"] == used_before and meat["from_jumps"] == 0, meat)
    b.count_at["Meat"] = -100
    read(hp=(100, 950))
    read(hp=(260, 950))
    read(hp=(100, 950))
    read(hp=(260, 950))
    check("out of view, jumps keep the tally", meat["used"] == used_before + 2 and meat["from_jumps"] == 2, meat)
    seen("Meat", 48, time.monotonic() + 100)
    b.count("Meat", 48, now=time.monotonic() + 103)
    check("the next count agrees and nothing's counted twice", meat["used"] == used_before + 2 and meat["from_jumps"] == 0 and meat["seen"] == 48, meat)
    b.count_at["Meat"] = -100
    read(hp=(100, 950))
    read(hp=(260, 950))
    check("that jump is on the tally for now", meat["used"] == used_before + 3 and meat["from_jumps"] == 1, meat)
    seen("Meat", 48, time.monotonic() + 200)
    check("a jump the count doesn't back up is taken back", meat["used"] == used_before + 2 and meat["from_jumps"] == 0, meat)
    b.count_at["Meat"] = -100
    read(hp=(100, 950))
    read(hp=(260, 950))
    seen("Meat", 97, time.monotonic() + 300, looks=8)
    b.count("Meat", 97, now=time.monotonic() + 305)
    check("used while out of view and bought more: both show", meat["used"] == used_before + 3 and meat["bought"] == 50 and meat["count"] == 97, meat)

    again = DayBook(path, HEALS, today=lambda: date[0])
    check("it's still there after a restart", again.days["2026-11-05"]["spent"] == 4_000 and again.days["2026-11-05"]["items"]["Meat"]["picked"] == 2)
    date[0] = "2026-11-06"
    b.mesos(2_000_000)
    b.picked_mesos(10)
    b.mesos(2_000_010)
    new = b.days["2026-11-06"]
    check("a new day starts from its own first reading", new["start"] == 2_000_000 and new["spent"] == 0 and "+10 mesos" in b.lines()[0], new)
    check("and the old day is kept", b.days["2026-11-05"]["spent"] == 4_000)

    path.write_text("not json", encoding="utf-8")
    check("a broken file doesn't stop it", DayBook(path, HEALS).days == {})
finally:
    shutil.rmtree(base, ignore_errors=True)

# ---------- reading the real status bar ----------
reader = VitalsReader(ROOT / "assets")
frames = json.loads((ROOT / "tests" / "frames" / "vitals.json").read_text(encoding="utf-8"))
for name, want in frames.items():
    strip = cv2.imread(str(ROOT / "tests" / "frames" / name))
    got = reader.read_area(strip, 1.0)
    check(f"reads {name}", got["hp"] == tuple(want["hp"]) and got["mp"] == tuple(want["mp"]), got)
frame = cv2.imread(str(ROOT / "tests" / "frames" / next(iter(frames))))
check("a picture with nothing in it reads as nothing", reader.read_area(frame * 0, 1.0) == {"hp": None, "mp": None})
check("the place to look scales with the window", reader.area((100, 50, 2560, 1440)) == (100 + 1280 - 310, 50 + 1440 - 56, 334, 18) and reader.area((0, 0, 1920, 1080))[3] == 14)

# ---------- reading the real quick bar ----------
scan = json.loads((ROOT / "assets" / "scan_data.json").read_text(encoding="utf-8"))
bar = quickbar.QuickBar(ROOT / "assets", scan["heal_gids"])
for name, want in json.loads((ROOT / "tests" / "frames" / "quickbar.json").read_text(encoding="utf-8")).items():
    got = bar.read(cv2.imread(str(ROOT / "tests" / "frames" / name)))
    check(f"reads every count in {name}", all(k in (got or {}) and (got[k][1] == w["count"] or (w.get("may_skip") and got[k][1] is None)) for k, w in want.items()), got)
    check(f"knows every item in {name}", all(k in (got or {}) and got[k][0] == w["item"] for k, w in want.items()), got)
closed = cv2.imread(str(ROOT / "tests" / "frames" / "quickbar_closed.png"))
check("a closed bar reads as nothing", bar.read(closed) is None)
blank = bar.read(cv2.imread(str(ROOT / "tests" / "frames" / next(iter(json.loads((ROOT / "tests" / "frames" / "quickbar.json").read_text(encoding="utf-8")))))))
check("empty slots are left out", "F1" not in blank and "C" not in blank, blank)
check("the place to look is at the bar", quickbar.area((0, 0, 2560, 1440)) == (1737, 1101, 298, 229), quickbar.area((0, 0, 2560, 1440)))

print(f"\n{failures} failed" if failures else "\nAll passed")
sys.exit(1 if failures else 0)
