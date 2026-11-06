"""The inventory's items (invwatch.py), from a picture of the owner's real Etc tab, and checking the lines against them.

Run it:  python tests/test_inventory.py"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import invwatch as iv  # noqa: E402
from linecount import ExpText  # noqa: E402
from maple_exp import ExpTracker, find_mesos_fields  # noqa: E402

failures = 0


def check(name, ok, detail=""):
    global failures
    print(("PASS " if ok else "FAIL ") + name + (f"   {detail}" if detail and not ok else ""))
    failures += not ok


pic = cv2.imread(str(ROOT / "tests" / "frames" / "inventory_etc.png"))
gids = json.loads((ROOT / "assets" / "scan_data.json").read_text(encoding="utf-8"))["item_gids"]
reader = iv.InventoryReader(ROOT / "assets", gids)
boxes = find_mesos_fields(pic, 14.0)
check("the inventory's found by its mesos box", len(boxes) == 1, boxes)
tab, rows = reader.slots(pic, boxes[0])
check("the tab that's open", tab == "Etc", tab)
got = {s[0]: s[1] for row in rows for s in row if s not in (None, "empty")}
for name, count in (("Tablecloth", 21), ("Bubbling's Huge Bubble", 21), ("Stirge Wing", 36), ("Jr. Necki Skin", 91), ("Leather", 117), ("Fragment of Magic", 10),
                    ("Blue Snail Shell", 4), ("Red Snail Shell", 9), ("Orange Mushroom Cap", 5), ("Slime Bubble", 1), ("Squishy Liquid", 3), ("Topaz Ore", 1), ("Gold Ore", 1), ("Mithril Ore", 1)):
    check(f"{name}: {count}", got.get(name) == count, got.get(name))
check("two stacks add up", sum(s[1] for row in rows for s in row if s not in (None, "empty") and s[0] == "Stiff Feather") == 162)
check("a free slot's seen as one", rows[5][4] == "empty", rows[5][4])
named = sum(1 for row in rows for s in row if s not in (None, "empty"))
truth = [15, 20, 12, 36, 91, 134, 117, 47, 10, 2, 61, 11, 90, 62, 100, 79, 32, 21, 2, 3, 21, 4, 9, 5, 1, 3, 1, 1, 1]
wrong = [(a, b) for a, b in zip([s for row in rows for s in row], truth) if a not in (None, "empty") and a[1] != b]
print(f"     ({named} of 29 slots named and counted)")
check("nothing's read as the wrong number", not wrong, wrong)
check("most of the tab is read", named >= 18, named)
check("not on another tab's items", reader.pictures.by_tab["Etc"] and not any(n == "Red Potion" for n, _ in reader.pictures.by_tab["Etc"]))
blank = np.full_like(pic, 40)
check("no window, nothing read", iv._pink_tab(blank, boxes[0], 1.0) is None)

E, F = "empty", None
ch = iv.InventoryCheck()
A = [[("Tablecloth", 2), ("Leaf", 5), E, E, E]]
ch.look("Etc", A)
check("one look isn't enough (a tooltip, a window being moved)", not ch.start)
ch.look("Etc", A)
check("two the same are", ch.start == {"Tablecloth": 2, "Leaf": 5}, ch.start)
B = [[("Tablecloth", 23), ("Leaf", 5), ("Maple Leaf", 7), E, E]]
ch.look("Etc", B)
ch.look("Etc", B)
rows_now = {r[0]: r for r in ch.rows({"Tablecloth": 21, "Maple Leaf": 6})}
check("what it gained", rows_now["Tablecloth"][4] == 21, rows_now)
check("all the lines read", rows_now["Tablecloth"][6] == 1.0)
check("a new item, in a slot seen free, started at nothing", rows_now["Maple Leaf"][2] == 0 and rows_now["Maple Leaf"][4] == 7, rows_now["Maple Leaf"])
check("missed some of it", abs(rows_now["Maple Leaf"][6] - 6 / 7) < 0.001)
check("what didn't change isn't listed", "Leaf" not in rows_now)
check("it says how it went", "read 27 of 28 (96%)" in ch.summary({"Tablecloth": 21, "Maple Leaf": 6}), ch.summary({"Tablecloth": 21, "Maple Leaf": 6}))
check("lines too many are said", "too many" in ch.summary({"Tablecloth": 27, "Maple Leaf": 7}), ch.summary({"Tablecloth": 27, "Maple Leaf": 7}))
sold = ch.rows({"Tablecloth": 21}, sold={"Tablecloth": 3}, bought={"Maple Leaf": 7})
check("selling and buying are allowed for", [r[4] for r in sold if r[0] == "Tablecloth"] == [24] and not [r for r in sold if r[0] == "Maple Leaf"], sold)
C = [[F, ("Leaf", 5), ("Maple Leaf", 7), E, E]]
ch.look("Etc", C)
ch.look("Etc", C)
check("a slot it can't read keeps what it knew", ch.now["Tablecloth"] == 23, ch.now)
D = [[E, ("Leaf", 5), ("Maple Leaf", 7), E, E]]
ch.look("Etc", D)
ch.look("Etc", D)
check("a slot that's emptied", ch.now["Tablecloth"] == 0, ch.now)
ch.clear()
check("Reset clears it", not ch.start and not ch.tabs and "open a tab" in ch.summary({}))

# Scrolling: the rows are put together by what's in them.
ch = iv.InventoryCheck()
top = [[("A", 1), ("B", 2)], [("C", 3), ("D", 4)]]
down = [[("C", 3), ("D", 4)], [("E", 5), E]]
for rows_seen in (top, top, down, down):
    ch.look("Etc", rows_seen)
check("scrolled down: the same rows aren't added twice", ch.now == {"A": 1, "B": 2, "C": 3, "D": 4, "E": 5}, ch.now)
check("and the rows below are added", len(ch.tabs["Etc"].rows) == 3, ch.tabs["Etc"].rows)
ch = iv.InventoryCheck()
for rows_seen in ([[("A", 1), ("A", 100)]], [[("A", 1), ("A", 100)]]):
    ch.look("Etc", rows_seen)
check("stacks add up", ch.now == {"A": 101}, ch.now)

# The EXP number by the MP bar.
x = ExpText()
check("the first reading is only where it starts", x.seen(9670, 174216) == 0)
check("it goes up", x.seen(9736, 174216) == 66)
check("nothing new", x.seen(9736, 174216) == 0)
check("a level up", x.seen(100, 200000) == 174216 - 9736 + 100)
check("dying loses EXP, and that's not a gain", x.seen(50, 200000) == 0)
check("and it carries on from there", x.seen(116, 200000) == 66)
check("no reading", x.seen(None, None) == 0)
t = ExpTracker()
check("EXP a minute needs a little to go on", t.per_minute() is None)
t.elapsed = lambda: 120.0
t.running = True
t.samples.extend([(30.0, 100), (70.0, 200), (100.0, 300), (119.0, 500)])
check("EXP a minute is the last minute's", t.per_minute() == 400, t.per_minute())
t.elapsed = lambda: 30.0
t.samples.clear()
t.samples.extend([(10.0, 0), (20.0, 100)])
check("less than a minute in, it's still per minute", t.per_minute() == 200, t.per_minute())

print(f"\n{failures} failed" if failures else "\nAll passed")
sys.exit(1 if failures else 0)
