"""Things that went wrong on the owner's first real solo hunt, so they stay fixed. Run it:  python tests/test_live_bugs.py"""
import json
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import msgwatch as mw  # noqa: E402
from itemwatch import ItemReader  # noqa: E402

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

print(f"\n{failures} failed" if failures else "\nAll passed")
sys.exit(1 if failures else 0)
