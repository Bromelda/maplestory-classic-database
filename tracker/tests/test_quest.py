"""Reading a quest's reward (questwatch.py), from pictures of the owner's real game, and what it does to the account.

Run it:  python tests/test_quest.py"""
import shutil
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import ocr  # noqa: E402
import questwatch as qw  # noqa: E402
from daybook import DayBook  # noqa: E402
from invwatch import InventoryCheck  # noqa: E402
from linecount import LineCounter  # noqa: E402
from scandata import GameData  # noqa: E402

failures = 0


def check(name, ok, detail=""):
    global failures
    print(("PASS " if ok else "FAIL ") + name + (f"   {detail}" if detail and not ok else ""))
    failures += not ok


FRAMES = ROOT / "tests" / "frames"
reward, talk = [cv2.imread(str(FRAMES / n)) for n in ("quest_reward.png", "quest_talk.png")]
shop = cv2.imread(str(FRAMES / "shop_1.png"))
blank = np.full((700, 1100, 3), 40, np.uint8)
check("the chat window's found", qw.find_chat(reward) is not None, qw.find_chat(reward))
check("and on a page with no reward", qw.find_chat(talk) is not None)
check("not in a shop", qw.find_chat(shop) is None)
check("not on nothing", qw.find_chat(blank) is None)
check("a reward has OBTAINED!", qw._obtained_bottom(qw._panel(reward, qw.find_chat(reward))) is not None)
check("other pages don't", qw._obtained_bottom(qw._panel(talk, qw.find_chat(talk))) is None)

exe = shutil.which("tesseract") or r"C:\Program Files\Tesseract-OCR\tesseract.exe"
if Path(exe).exists():
    KNOWN = [ln.split("\t")[1].strip() for ln in (ROOT / "assets" / "items.txt").read_text(encoding="utf-8").splitlines() if "\t" in ln]
    w = qw.QuestWatch(ocr.Tesseract(exe).read_lines, KNOWN)
    check("nothing on a page with no reward", w.look(talk) is None)
    got = w.look(reward)
    check("real: what the quest gave", got == {"items": {"Blue Potion": 20}, "exp": 3937, "mesos": 1082}, got)
    check("told the once", w.look(reward) is None)
    w.look(blank)
    check("the next quest counts even if it's the same", w.look(reward) == got)
    check("not in a shop", w.look(shop) is None)
else:
    print("SKIP the real pictures: no Tesseract here")
w = qw.QuestWatch(lambda images, chars=None: [], ["Blue Potion"])
pages = [{"items": {}, "exp": 3937, "mesos": 1082}, {"items": {"Blue Potion": 20}, "exp": 3937, "mesos": 1082}, {"items": {}, "exp": 3937, "mesos": 0},
         {"items": {"Blue Potion": 20}, "exp": 3937, "mesos": 1082}]
w.read_reward = lambda panel, top, k: pages.pop(0)
check("first read of a page, with the potions missed", w.look(reward) == {"items": {}, "exp": 3937, "mesos": 1082})
check("read better: only what's new, not the EXP and mesos again", w.look(reward) == {"items": {"Blue Potion": 20}, "exp": 0, "mesos": 0})
check("read worse: nothing", w.look(reward) is None)
check("read the same: nothing", w.look(reward) is None)
check("the same reward read short isn't another", qw._smaller({"items": {}, "exp": 3937, "mesos": 0}, {"items": {"A": 1}, "exp": 3937, "mesos": 5}))
check("a different one is", not qw._smaller({"items": {}, "exp": 4000, "mesos": 0}, {"items": {}, "exp": 3937, "mesos": 5}))

# The account: as on the real run, 20 potions from a quest came out as 20 bought.
folder = Path(tempfile.mkdtemp())
b = DayBook(folder / "d.json", {"Blue Potion": {"mp": 100}}, today=lambda: "day", prices={"Blue Potion": 220})
b.mesos(69178, now=0.0)
for i in range(3):
    b.count("Blue Potion", 245, now=1.0 + i * 0.25)
b.quest_reward({"Blue Potion": 20, "Tablecloth": 1}, 3937, 1082, now=2.0)
d = b.days["day"]
it = d["items"]["Blue Potion"]
b.count("Blue Potion", 265, now=2.5)
for i in range(3):
    b.count("Blue Potion", 265, now=10.0 + i)
check("a quest's potions aren't bought", it["bought"] == 0 and it["cost"] == 0 and it["used"] == 0 and it["seen"] == 265, it)
check("nor picked up", it["picked"] == 0, it)
b.mesos(70260, now=11.0)
check("its mesos aren't sold or spent", d["sold"] == 0 and d["spent"] == 0 and d["now"] == 70260, (d["sold"], d["spent"], d["now"]))
check("what's said", any("From quests (1)" in x and "Blue Potion ×20" in x and "3,937 EXP" in x and "1,082 mesos" in x for x in b.lines()), b.lines())
check("for the inventory check, it's not from lines", b.traded()[1].get("Tablecloth") == 1 and b.traded()[1].get("Blue Potion") == 20, b.traded())
ch = InventoryCheck()
for _ in range(2):
    ch.look("Etc", [[("Tablecloth", 2), "empty"]])
for _ in range(2):
    ch.look("Etc", [[("Tablecloth", 3), "empty"]])
check("so the check doesn't call it a missed line", not ch.rows({}, *b.traded()), ch.rows({}, *b.traded()))

# The reading meter.
c = LineCounter(GameData(ROOT / "assets" / "scan_data.json"))
c.meter.add("exp_lines", 66, 0.5)
c.meter.mesos_seen(69178, 1.0)
c.quest_reward(200, 50, 2.0)
c.exp_number(266, 3.0)
check("a small quest's EXP is left out as well", c.meter.total["exp_bar"] == 66 and c.meter.total["exp_lump"] == 200, c.meter.total)
c.meter.mesos_seen(69228, 4.0)
check("and its mesos", c.meter.total["mesos_box"] == 0, c.meter.total)

print(f"\n{failures} failed" if failures else "\nAll passed")
sys.exit(1 if failures else 0)
