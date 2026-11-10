"""Things that went wrong on the owner's first real solo hunt, so they stay fixed. Run it:  python tests/test_live_bugs.py"""
import json
import shutil
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import msgwatch as mw  # noqa: E402
import ocr  # noqa: E402
from itemwatch import ItemReader  # noqa: E402
from platforms.windows import admin_command  # noqa: E402

failures = 0


def check(name, ok, detail=""):
    global failures
    print(("PASS " if ok else "FAIL ") + name + (f"   {detail}" if detail and not ok else ""))
    failures += not ok


# A sliver of a picture got kept as "Bubbling's Huge Bubble", and then every Etc line after it threw an error and was lost.
with tempfile.TemporaryDirectory() as folder:
    saved = Path(folder) / "names.npz"
    items = ItemReader(ROOT / "assets", saved)
    before = len(items.names)
    items.learned_path = None
    items.learn("Bubbling's Huge Bubble", "Etc", np.zeros((43, 1), np.float32))
    check("a sliver of a name isn't kept", len(items.names) == before)
    items.learn("Bubbling's Huge Bubble", "Etc", np.zeros((43, 240), np.float32))
    check("the whole of one is", len(items.names) == before + 1)
    items.names.append(["Sliver", "Etc", np.zeros((43, 1), np.float32)])    # (one saved before this was fixed)
    F = np.random.default_rng(1).random((43, 400)).astype(np.float32)
    try:
        items.known(F, 380, "Etc", 1.0)
        check("reading a name with a sliver in the list doesn't throw", True)
    except Exception as e:
        check("reading a name with a sliver in the list doesn't throw", False, repr(e))

# One "+66" line, fading for 6 seconds while the player runs and the scenery behind it changes: real footage, one line.
stacked = cv2.imread(str(ROOT / "tests" / "frames" / "one_line_moving.jpg"))
times = json.loads((ROOT / "tests" / "frames" / "one_line_moving.json").read_text(encoding="utf-8"))
frames = np.split(stacked, len(times))
watcher = mw.MessageWatcher(mw.Font(ROOT / "assets"), None)
heard = []
for frame, t in zip(frames, times):
    heard += [line.amount for line in watcher.look(frame, 40 / 3, t) if line.kind in ("exp", "bonus")]
check("one line is one line, however the scenery moves behind it", heard == [66], heard)

# A row that's all past where lines end used to throw, and lost the whole look.
blank = np.zeros_like(frames[0])
blank[:, :8] = 255
watcher = mw.MessageWatcher(mw.Font(ROOT / "assets"), None)
watcher.edge = 4.0
try:
    watcher.rows(blank, 40 / 3)
    check("a row with nothing inside where lines end doesn't throw", True)
except Exception as e:
    check("a row with nothing inside where lines end doesn't throw", False, repr(e))

# Names, from a hunt at 2560x1440: Silver and Sapphire Ore came out as Iron Ore. Word gaps there are wider than was allowed for, so only "Ore" got
# kept as the picture of Iron Ore, and a name was compared by its end alone. And Tesseract was asked the map's likely drops first.
s = (40 / 3) / 20
LINES = ROOT / "tests" / "frames" / "item_lines"


def line(name):
    """A real line: its row, and where it starts and ends."""
    band = cv2.imread(str(LINES / f"{name}.png"))
    return band, (12, band.shape[1] - 12)


def says(text):
    return lambda images, chars=None: [text] * len(images)


with tempfile.TemporaryDirectory() as folder:
    r = ItemReader(ROOT / "assets", Path(folder) / "n.npz")
    silver, iron, sapphire = line("silver_ore"), line("iron_ore"), line("sapphire_ore")
    check("a new name's read", r.read(*iron, s, says("Iron Ore")) == ("item", "Iron Ore", 1, "Etc"))
    kept = [p for n, _, p in r.names if n == "Iron Ore"]
    check("and all of it's kept, not just its last word", len(kept) == 1 and kept[0].shape[1] > 90, [p.shape for p in kept])
    check("known by sight now", r.read(*iron, s) == ("item", "Iron Ore", 1, "Etc"))
    check("Silver Ore isn't Iron Ore", r.read(*silver, s) is None, r.read(*silver, s))
    check("nor Sapphire Ore", r.read(*sapphire, s) is None, r.read(*sapphire, s))
    check("it's read for itself", r.read(*silver, s, says("Silver Ore")) == ("item", "Silver Ore", 1, "Etc"))
    check("then both are told apart", r.read(*silver, s)[1] == "Silver Ore" and r.read(*iron, s)[1] == "Iron Ore")
    r.names.append(["Bronze Ore", "Etc", kept[0][:, -50:]])
    check("a short picture doesn't fit the end of a longer name", r.read(*sapphire, s) is None, r.read(*sapphire, s))
    r.names.pop()
    before = len(r.names)
    r.learn("Garnet Ore", "Etc", kept[0][:, -50:])
    check("a sliver of a name isn't kept", len(r.names) == before)

with tempfile.TemporaryDirectory() as folder:
    r = ItemReader(ROOT / "assets", Path(folder) / "n.npz")
    r.set_likely(["Iron Ore", "Evil Eye Tail"])
    check("what's read beats what's likely here", r.read(*line("silver_ore"), s, says("Silver Ore"))[1] == "Silver Ore")
    check("what's likely still helps a poor read", r.read(*line("iron_ore"), s, says("Iran Oro"))[1] == "Iron Ore")

    # A line whose next picture is of another line (the stack's move misjudged): as on the hunt, a Speed Potion came out as an Evil Eye Tail.
    tail, potion = line("evil_eye_tail"), line("speed_potion")
    r.read(*tail, s, says("Evil Eye Tail"))
    mixed = mw.Line(0.0, "white", pictures=[potion, tail])
    check("a picture of another line isn't read as this one", r.read_line(mixed, s) is None)
    check("this one's read from its own", r.read_line(mixed, s, says("Speed Potion"))[1] == "Speed Potion")

    # Clean lines were lost when Tesseract misread the bracket. Now it's only asked for the name.
    exe = shutil.which("tesseract") or r"C:\Program Files\Tesseract-OCR\tesseract.exe"
    if Path(exe).exists():
        fresh = ItemReader(ROOT / "assets", None)
        read = ocr.Tesseract(exe).read_lines
        for name, want in (("evil_eye_tail", "Evil Eye Tail"), ("silver_ore", "Silver Ore"), ("iron_ore", "Iron Ore"), ("sapphire_ore", "Sapphire Ore"),
                           ("red_knucklevest", "Red Knucklevest"), ("jr_boogie_horn", "Jr. Boogie Horn"), ("speed_potion", "Speed Potion")):
            got = fresh.read(*line(name), s, read)
            check(f"really read: {want}", got is not None and got[1] == want, got)
    else:
        print("SKIP really read: no Tesseract here")

# Over moving scenery, a line faded and was counted again: dim, a few seconds after the line itself.
with tempfile.TemporaryDirectory() as folder:
    r = ItemReader(ROOT / "assets", Path(folder) / "n.npz")
    wood = line("evil_eye_tail")
    r.read(*wood, s, says("Evil Eye Tail"))

    def came_in(when, fresh=True, name="evil_eye_tail", now=(), before=(), left=False):
        return r.read_line(mw.Line(when, "white", pictures=[line(name)], fresh=fresh, stack=([line(n) for n in now], [[line(n) for n in before]]), left_place=left), s, says("Speed Potion"))

    T, P = "evil_eye_tail", "speed_potion"
    check("a bright line counts", came_in(10.0, now=[T])[0] == "item")
    check("another bright one right after, with the other gone from its place, is the same line", came_in(10.3, now=[T], before=[T], left=True) == ("again", "Evil Eye Tail"))
    check("...with the other still in its place, it's another", came_in(10.4, now=[T, T], before=[T])[0] == "item")
    check("...and later on, it's another: the other's faded", came_in(12.5, now=[T], before=[T], left=True)[0] == "item")
    check("a dim one just after, with no more of them on screen, is the same line", came_in(13.0, False, now=[T], before=[T]) == ("again", "Evil Eye Tail"))
    check("...with more of them on screen, it's another", came_in(13.1, False, now=[T, T], before=[T])[0] == "item")
    check("...counting by the name, not the end of the line", came_in(13.15, False, now=[T, P], before=[T, P]) == ("again", "Evil Eye Tail"))
    check("a dim one of another name counts", came_in(13.2, False, P, now=[P])[1] == "Speed Potion")
    check("a dim one long after counts: it was only seen late", came_in(30.0, False, now=[T], before=[T])[0] == "item")

# Only as administrator: what starts it again.
exe, args, where = admin_command(sys.executable, ["maple_exp.py"], False)
check("from source, the same Python with no console", Path(exe).name == "pythonw.exe" and "maple_exp.py" in args and Path(where).is_absolute(), (exe, args, where))
check("from the download, itself", admin_command(r"C:\A B\Maple.exe", [r"C:\A B\Maple.exe"], True) == (r"C:\A B\Maple.exe", "", r"C:\A B"))

print(f"\n{failures} failed" if failures else "\nAll passed")
sys.exit(1 if failures else 0)
