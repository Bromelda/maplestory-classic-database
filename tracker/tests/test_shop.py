"""NPC shops (shopwatch.py), from pictures of the owner's real game, and what they do to the run's account (daybook.py).

Run it:  python tests/test_shop.py"""
import json
import shutil
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import ocr  # noqa: E402
import shopwatch as sw  # noqa: E402
from daybook import DayBook  # noqa: E402

failures = 0


def check(name, ok, detail=""):
    global failures
    print(("PASS " if ok else "FAIL ") + name + (f"   {detail}" if detail and not ok else ""))
    failures += not ok


FRAMES = ROOT / "tests" / "frames"
before, amount_box, after = [cv2.imread(str(FRAMES / f"shop_{n}.png")) for n in (1, 2, 3)]
PRICES = json.loads((ROOT / "assets" / "scan_data.json").read_text(encoding="utf-8"))["shop_prices"]
KNOWN = [ln.split("\t")[1].strip() for ln in (ROOT / "assets" / "items.txt").read_text(encoding="utf-8").splitlines() if "\t" in ln]

# Finding it.
for name, pic in (("the shop", before), ("with the amount box up", amount_box), ("after buying", after)):
    check(f"{name}: found", sw.find_shop(pic) is not None, sw.find_shop(pic))
check("the field isn't a shop", sw.find_shop(np.full((720, 880, 3), 40, np.uint8)) is None)
where = sw.find_shop(after)
check("the row clicked in the shop's list", sw.selected_row(after, where, "left") is not None)
check("and in your own", sw.selected_row(after, where, "right") is not None)
check("no row clicked yet", sw.selected_row(before, where, "left") is None and sw.selected_row(before, where, "right") is None)
check("the amount box covers your side's row, so it doesn't count", sw.selected_row(amount_box, where, "right") is None)

# Prices as they're written.
check("a price", sw.price_of("150 Mesos") == 150)
check("a price with a comma", sw.price_of("1,500 Mesos") == 1500)
check("a citizen's discount is the second number", sw.price_of("35 33 Mesos") == 33)
check("no price", sw.price_of("Mesos") is None)


class Scripted(sw.ShopWatch):
    """Row and mesos readings given, to go through what it does with them."""
    def __init__(self, mesos, rows=None):
        super().__init__(lambda images, chars=None: [], KNOWN, PRICES)
        self.script, self.fixed_rows = list(mesos), rows or {}

    def read_mesos(self, bgr):
        return self.script.pop(0) if self.script else self.mesos

    def read_row(self, row, s):
        return ("Red Potion", 5) if row.shape and self._side() == "right" else ("Lemon", 150)

    def _side(self):
        self.turn = getattr(self, "turn", 0) + 1
        return "left" if self.turn % 2 else "right"

    def _changed(self, old, new):
        return True


w = Scripted([69468, 69493, 69493])
check("first look: where the mesos are", w.look(after) == [{"kind": "mesos", "mesos": 69468}], w.mesos)
check("a new reading has to read the same twice", w.look(after) == [])
got = w.look(after)
check("mesos rise: sold what's clicked on your side", got and got[0]["kind"] == "sold" and got[0]["name"] == "Red Potion" and got[0]["qty"] == 5 and got[0]["total"] == 25, got)
w = Scripted([69468, 69168, 69168])
w.look(after)
w.look(after)
got = w.look(after)
check("mesos fall: bought what's clicked in the shop's list", got and got[0]["kind"] == "bought" and got[0]["name"] == "Lemon" and got[0]["qty"] == 2, got)
w = Scripted([69468, 9468, 69468])      # (9,468 would fit 400 Lemons)
w.look(after)
check("a misread doesn't count", w.look(after) == [] and w.mesos == 69468, w.mesos)
check("and it's not counted when it reads right again", w.look(after) == [] and w.mesos == 69468, w.mesos)
w = Scripted([69468, 69400, 69400])
w.look(after)
check("a change that fits no price waits to be read again", w.look(after) == [])
check("then it's only a change in the mesos", w.look(after) == [{"kind": "mesos", "mesos": 69400}], w.mesos)
w = Scripted([69468])
w.look(after)
check("it knows the shop's open", w.open)
check("the shop closed", w.look(np.full(after.shape, 40, np.uint8)) == [] and not w.open and w.mesos is None and w.rows["left"] is None)

# The real thing, with Tesseract, on the real pictures: 100 Lemons and then 1.
exe = shutil.which("tesseract") or r"C:\Program Files\Tesseract-OCR\tesseract.exe"
if Path(exe).exists():
    w = sw.ShopWatch(ocr.Tesseract(exe).read_lines, KNOWN, PRICES)
    check("real: the mesos when it opens", w.look(before) == [{"kind": "mesos", "mesos": 84618}], w.mesos)
    w.look(amount_box)
    got = w.look(amount_box)
    check("real: 100 Lemons for 15,000", got == [{"kind": "bought", "name": "Lemon", "qty": 100, "price": 150, "total": 15000, "mesos": 69618}], got)
    w.look(after)
    got = w.look(after)
    check("real: 1 Lemon for 150", got == [{"kind": "bought", "name": "Lemon", "qty": 1, "price": 150, "total": 150, "mesos": 69468}], got)
    check("real: what's clicked on your side", w.rows["right"] == ("Red Potion", 5), w.rows)
    check("real: nothing new, nothing counted", w.look(after) == [])
    import maple_exp
    maple_exp.TESS = ocr.Tesseract(exe)
    bar = cv2.imread(str(FRAMES / "map_bar.png"))
    box = maple_exp.find_map_bar(bar)
    check("real: a collapsed minimap's bar is found", box is not None, box)
    if box:
        x, y, width, height = box
        check("real: and its name's read, without the region", maple_exp.read_map_bar(bar[y:y + height, x:x + width]) == "Kerning City Pharmacy")
    check("a picture with no bar", maple_exp.find_map_bar(np.full((200, 600, 3), 40, np.uint8)) is None)
    blue = cv2.cvtColor(np.uint8([[[100, 64, 204]]]), cv2.COLOR_HSV2BGR)[0, 0]
    wall = np.full((300, 900, 3), 40, np.uint8)
    wall[:60, :600] = bar
    wall[120:280, 650:880] = blue
    check("a pale blue wall isn't the minimap, with the bar showing", maple_exp.find_map_area(wall, 14) == (box, True), maple_exp.find_map_area(wall, 14))
    opened = wall.copy()
    opened[120:280, 650:880] = 40
    opened[30:150, 2:590] = blue
    area, is_bar = maple_exp.find_map_area(opened, 14)
    check("the open minimap's box, under its bar, is the box", area is not None and not is_bar, (area, is_bar))
else:
    print("SKIP the real pictures: no Tesseract here")


# The account.
def book():
    folder = Path(tempfile.mkdtemp())
    return DayBook(folder / "daybook.json", {"Lemon": {"mp": 150}, "Red Potion": {"hp": 50}}, today=lambda: "day", prices={"Lemon": 150, "Red Potion": 50}), folder


def look(b, name, value, t, times=1):
    for i in range(times):
        b.count(name, value, now=t + i * 0.25)


b, folder = book()
b.mesos(84618, now=0.0)
look(b, "Lemon", 318, 1.0, 3)
b.shop_trade("bought", "Lemon", 100, 15000, 69618, now=5.0)
d = b.days["day"]
it = d["items"]["Lemon"]
check("bought: the account knows at once", it["bought"] == 100 and it["cost"] == 15000 and d["spent"] == 15000 and d["now"] == 69618, (it, d["spent"], d["now"]))
look(b, "Lemon", 318, 5.5, 3)
check("while the count hasn't shown it yet, none are 'used'", it["used"] == 0, it)
look(b, "Lemon", 418, 6.0)
check("the count showing it takes one look, and adds nothing", it["bought"] == 100 and it["count"] == 418 and it["picked"] == 0 and it["used"] == 0, it)
look(b, "Lemon", 418, 20.0, 3)
check("and nothing more later", it["bought"] == 100 and it["cost"] == 15000 and it["used"] == 0 and it["picked"] == 0, it)
b.shop_trade("bought", "Lemon", 1, 150, 69468, now=21.0)
look(b, "Lemon", 419, 21.5)
look(b, "Lemon", 419, 30.0, 3)
check("buying 1 is buying, not picking one up", it["bought"] == 101 and it["picked"] == 0 and it["cost"] == 15150, it)
b.mesos(69468, now=31.0)
check("the inventory saying the same adds nothing", d["spent"] == 15150 and d["sold"] == 0, (d["spent"], d["sold"]))
b.shop_trade("sold", "Lemon", 5, 75, 69543, now=40.0)
look(b, "Lemon", 414, 40.5)
look(b, "Lemon", 414, 50.0, 3)
check("selling some isn't using them", it["sold"] == 5 and it["used"] == 0 and it["seen"] == 414, it)
check("and the mesos are put down to it", d["sold"] == 75 and d["now"] == 69543, (d["sold"], d["now"]))
b.shop_trade("bought", "Blue Doros Robe", 1, 4500, 65043, now=60.0)
check("an item it doesn't keep a count of isn't a potion", "Blue Doros Robe" not in d["items"], d["items"].keys())
text = "\n".join(b.lines())
check("it's all said", "Lemon ×101 for 15,150" in text and "Lemon ×5 for 75" in text and "Blue Doros Robe ×1 for 4,500" in text and "spent 19,650" in text, text)
saved = json.loads((folder / "daybook.json").read_text(encoding="utf-8"))
check("and saved", saved["day"]["shop"]["bought"]["Lemon"] == [101, 15150], saved["day"]["shop"])

b, _ = book()
b.shop_trade("bought", "Lemon", 100, 15000, 69618, now=1.0)
d = b.days["day"]
check("the first mesos of the run being in a shop: it started before the purchase", d["start"] == 84618 and d["now"] == 69618 and d["spent"] == 15000, d)

b, _ = book()
b.mesos(1000, now=0.0)
look(b, "Red Potion", 30, 1.0, 3)
b.shop_trade("bought", "Red Potion", 10, 500, 500, now=2.0)
look(b, "Red Potion", 30, 30.0, 1)
look(b, "Red Potion", 40, 31.0, 8)
it = b.days["day"]["items"]["Red Potion"]
check("a count that never showed it, given up on: nothing gets lost", it["bought"] >= 10 and it["used"] == 0, it)

# A misread of the mesos mustn't get in the account. These are the real readings that did.
b, _ = book()
b.mesos(84618, now=0.0)
b.shop_trade("bought", "Lemon", 100, 15000, 69618, now=1.0)
b.shop_trade("bought", "Lemon", 1, 150, 69468, now=2.0)
b.picked_mesos(4794)
d = b.days["day"]
b.mesos(5622, now=10.0)
check("a wild reading isn't believed", d["now"] == 69468 and d["spent"] == 15150 and d["sold"] == 0, (d["now"], d["spent"], d["sold"]))
b.mesos(5622, now=12.0)
check("not even twice in a row", d["now"] == 69468 and d["spent"] == 15150, d["now"])
b.mesos(74865, now=13.0)
check("the true reading comes back, and nothing's been wrecked", d["now"] == 74865 and d["spent"] == 15150, (d["now"], d["spent"], d["sold"]))
check("and what the lines missed is put down as extra", d["sold"] == 74865 - 69468 - 4794, d["sold"])
check("nothing's left waiting", b.held is None)
b.mesos(30000, now=20.0)
check("a real big change waits a while", d["now"] == 74865, d["now"])
b.mesos(30000, now=30.0)
check("still waiting", d["now"] == 74865)
b.mesos(30000, now=41.0)
check("then it's believed", d["now"] == 30000 and d["spent"] == 15150 + 44865, (d["now"], d["spent"]))
b, _ = book()
b.mesos(50000, now=0.0)
b.mesos(5000, now=1.0)
b.mesos(5100, now=500.0)
check("seen again much later, a little changed: it's real", b.days["day"]["now"] == 5100, b.days["day"]["now"])
b, _ = book()
b.mesos(50000, now=0.0)
b.mesos(40000, now=1.0)
check("an ordinary spend counts at once", b.days["day"]["now"] == 40000 and b.days["day"]["spent"] == 10000)
b, _ = book()
b.mesos(1000, now=0.0)
b.mesos(1500, now=1.0)
check("small amounts aren't held up by the share alone", b.days["day"]["now"] == 1500)

print(f"\n{failures} failed" if failures else "\nAll passed")
sys.exit(1 if failures else 0)
