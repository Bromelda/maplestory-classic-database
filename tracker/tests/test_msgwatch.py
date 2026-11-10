"""The message watcher (msgwatch.py): reading message lines by the game's font, and finding the new
lines in the stack look after look. The lines are real ones out of 4K game pictures, cropped to
their right end (tests/frames/msg_rows*.png); the stacks are made from them the way the game
moves and dims its lines. Run from the project folder:  py -3 tests/test_msgwatch.py"""
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import msgwatch as mw  # noqa: E402

failures = 0


def check(name, ok):
    global failures
    print(("PASS " if ok else "FAIL ") + name)
    failures += not ok


FRAMES = ROOT / "tests" / "frames"
font = mw.Font(ROOT / "assets")


def mosaic(name):
    """[(row picture (lightness), kind, amount or None)] from one of the msg_rows pictures."""
    grey = cv2.imread(str(FRAMES / f"{name}.png"), cv2.IMREAD_GRAYSCALE)
    labels = [x.split() for x in (FRAMES / f"{name}.txt").read_text(encoding="utf-8").split("\n") if x.strip()]
    return [(grey[i * 34:(i + 1) * 34], k, None if a == "-" else int(a)) for i, (k, a) in enumerate(labels)]


def read(row):
    band = np.pad(cv2.merge([row, row, row]), ((4, 4), (0, 0), (0, 0)))
    edge, _ = mw.edges(band, 1.0)
    return font.read(band, 1.0, int(np.nonzero(edge.sum(axis=0) >= 2)[0][-1]) + 1)


# ---- reading
for name, what in (("msg_rows", "the lines the font was made from"),
                   ("msg_rows_test", "other lines (41 of them Tesseract read wrong: +15 as 145, +22 as 272...)")):
    rows = mosaic(name)
    wrong = [(k, a, read(r)[:2]) for r, k, a in rows if read(r)[:2] != (k, a)]
    check(f"{what}: {len(rows) - len(wrong)} of {len(rows)} read right ({wrong[:4] or 'all'})", len(wrong) <= len(rows) // 50)

# ---- the stack, look by look
TRAIN = mosaic("msg_rows")


def full(light):
    """A row as a new line looks: its letters at full brightness (the pictures were taken at different
    moments, some lines a little dimmed already)."""
    edge, L = mw.edges(cv2.merge([light, light, light]), 1.0)
    return np.clip(light.astype(np.float32) * 250 / np.median(L[edge]), 0, 255)


LINES = {"mesos 16": (full(TRAIN[10][0]), "white"), "mesos 15": (full(TRAIN[4][0]), "white"),
         "exp 22": (full(TRAIN[65][0]), "yellow"), "bonus 5": (full(TRAIN[105][0]), "yellow")}
check("(the rows the stacks are made of are what they're named)",
      all(f"{TRAIN[i][1]} {TRAIN[i][2]}" == n for i, n in ((10, "mesos 16"), (4, "mesos 15"), (65, "exp 22"), (105, "bonus 5"))))
x, y, W, H = mw.stack_area((0, 0, 3840, 2160), 20.0)
rng = np.random.default_rng(1)
SCENERY = cv2.GaussianBlur(rng.integers(0, 90, (H, W, 3)).astype(np.uint8), (9, 9), 0) + np.array([10, 50, 20], np.uint8)


def dim(age):
    """How bright a line is, age seconds after it came in."""
    return 1.0 if age < 0.3 else max(0.6, 1.0 - 0.4 * (age - 0.3))


def picture(stack, now, flash=False):
    """The stack area with its lines (newest first: [(name, born)]) as they look at time now."""
    img = SCENERY.copy()
    for k, (name, born) in enumerate(stack):
        if k >= 6 or now - born > 2.5:                       # (the game shows 6 at most, for 2-3 s)
            continue
        light, colour = LINES[name]
        f = dim(now - born)
        band = np.dstack([light * (0.3 if colour == "yellow" else 1.0), light, light]).astype(np.float32) * f
        yc = int(round(mw.row_middles(H, 20.0)[k]))
        right = W - mw.EDGE_IN
        img[yc - 17:yc + 17, right - band.shape[1]:right] = np.clip(band, 0, 255).astype(np.uint8)
    if flash:                                                # (a skill's flash over all of it)
        img = np.clip(img.astype(np.int16) + 120, 0, 255).astype(np.uint8)
    return img


def run(arrivals, until, flashes=()):
    """Looks 10 times a second; returns what the watcher reports: ["mesos 16", ...] and the colours."""
    watch, stack, seen = mw.MessageWatcher(font), [], []
    for i in range(int(until * 10) + 1):
        now = i / 10
        for t, names in arrivals:
            if abs(t - now) < 1e-6:
                stack = [(n, now) for n in names] + stack
        got = watch.look(picture(stack, now, any(abs(f - now) < 1e-6 for f in flashes)), 20.0, now)
        seen += [(f"{line.kind} {line.amount}", line.colour) for line in got]
    return seen


got = run([(0.5, ["mesos 16"])], 4)
check(f"a pickup line is seen once, read, and white ({got})", got == [("mesos 16", "white")])
got = run([(0.5, ["mesos 16"]), (1.2, ["mesos 16"])], 4)
check(f"the same pickup twice, 0.7 s apart: two lines ({[g for g, _ in got]})", [g for g, _ in got] == ["mesos 16"] * 2)
got = run([(0.5, ["mesos 16"]), (0.7, ["mesos 16"])], 4)
check(f"...and 0.2 s apart, while the first is still at full brightness ({[g for g, _ in got]})",
      [g for g, _ in got] == ["mesos 16"] * 2)
got = run([(0.5, ["bonus 5", "exp 22"])], 4)
check(f"a kill's two lines in one look: both, yellow ({got})", sorted(got) == [("bonus 5", "yellow"), ("exp 22", "yellow")])
got = run([(0.5, ["bonus 5", "exp 22"]), (0.9, ["bonus 5", "exp 22"]), (1.3, ["bonus 5", "exp 22"])], 5)
check(f"the same kill three times in a row, 0.4 s apart: 6 lines ({len(got)})", len(got) == 6)
got = run([(0.5, ["mesos 15"]), (0.6, ["mesos 16"]), (0.7, ["bonus 5", "exp 22"])], 4)
check(f"lines in looks one after another ({sorted(g for g, _ in got)})",
      sorted(g for g, _ in got) == ["bonus 5", "exp 22", "mesos 15", "mesos 16"])
got = run([(0.5, ["mesos 16", "mesos 15"]), (1.0, ["bonus 5", "exp 22"])], 4, flashes=(1.5, 1.6))
check(f"a flash over the stack adds nothing ({sorted(g for g, _ in got)})",
      sorted(g for g, _ in got) == ["bonus 5", "exp 22", "mesos 15", "mesos 16"])
got = run([], 3)
check("an empty stack: nothing", got == [])

# A sign behind the stack: a bright row ending further right, again and again. Only lines it's sure of say where lines end.
watch = mw.MessageWatcher(font)
blank = np.zeros((4, 4), np.uint8)
sure = mw.Row(574, 300, "white", 200.0, blank, blank, ("mesos", 5, True))
sign = mw.Row(584, 300, "white", 200.0, blank, blank, ("text", None, False))
watch.rows = lambda img, gh: ([sure, sign, sign, sign], [None] * 4)
watch.look(np.zeros((4, 594, 3), np.uint8), 20.0, 0.0)
check(f"scenery behind the stack doesn't move where lines end ({watch.edge})", watch.edge == 574)
short = mw.Row(562, 300, "white", 200.0, blank, blank, ("mesos", 5, True))
watch = mw.MessageWatcher(font)
watch.rows = lambda img, gh: ([short], [None])
watch.look(np.zeros((4, 594, 3), np.uint8), 20.0, 0.0)
check(f"a line misread short doesn't say where lines end (+51 as +5: then every line after's cut short) ({watch.edge})", watch.edge is None)

# A line's end is known: scenery just past it doesn't change where it's read from.
watch = mw.MessageWatcher(font)
got = run([(0.5, ["mesos 16"])], 4)
check("the known end doesn't stop lines being read", got == [("mesos 16", "white")])

# Looks further apart (a busy PC, or a clip): a new line has had time to dim before it's seen.
watch = mw.MessageWatcher(font)
watch.peak["white"] = 200.0
row = mw.Row(574, 300, "white", 172.0, blank, blank, ("mesos", 5, True))
watch.gap = 0.1
check("a tenth of a second on, a dimmed line isn't new", not watch._fresh(row))
watch.gap = 0.35
check("a third of a second on, it can be", watch._fresh(row))
row.bright = 120.0
check("but not one that's gone this dim", not watch._fresh(row))

# Pale scenery: the shadow's hidden, but the letters still stand out from what's around them.
pale = np.full((36, 120, 3), 200, np.uint8)
cv2.putText(pale, "+8", (50, 26), cv2.FONT_HERSHEY_PLAIN, 1.5, (235, 255, 255), 1)
seen = mw.strokes(pale, 1.0)
check("letters on pale scenery stand out", seen[:, 50:80].max() > 0.9 and seen[:, :40].max() < 0.1)
check("plain scenery has nothing to see", mw.strokes(np.full((36, 120, 3), 200, np.uint8), 1.0).max() == 0)

# Real looks at the stack, where the first live hunts on a low-level character went wrong (tests/frames/msg_lines).
def real_run(name, peak, edge, looks_each=3):
    """What the watcher hears from these frames, looked at about 10 times a second."""
    w = mw.MessageWatcher(font)
    w.peak["white"], w.edge = peak, edge
    heard, t = [], 0.0
    for n in range(3):
        frame = cv2.imread(str(FRAMES / "msg_lines" / f"{name}_{n}.png"))
        for _ in range(looks_each):
            t += 0.1
            heard += [(line.kind, line.amount) for line in w.look(frame, 40 / 3, t)]
    return heard


check("a new line that reads a bit dimmer than the brightest yet is still heard", real_run("missed", 201.0, 573.0) == [("exp", 13)])
check("a 3 isn't read as an 8", ("exp", 13) in real_run("misread", 184.0, 573.0) and ("exp", 18) not in real_run("misread", 184.0, 573.0))
heard = real_run("not_new", 182.0, 573.0)
check("new lines coming in below an old one don't make that one new", ("exp", 12) not in heard and ("mesos", 15) in heard)

print("\nALL PASSED" if not failures else f"\n{failures} FAILED")
sys.exit(1 if failures else 0)
