"""Makes assets/quick_digits.npz: the quick bar's digits, cut from real pictures of it whose counts were read by eye
(tests/frames/quickbar*.png, listed in tests/frames/quickbar.json). Add a picture and run this again to teach it a digit
or an item. It also makes assets/quick_icons.npz: what each item named there looks like in its slot.
A digit with no real picture yet keeps the shape from assets/pot_digits.npz, which doesn't fit well enough to be read,
so a count with it is left out rather than guessed.

Run it:  python tools/make_quick_digits.py"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import quickbar as qb  # noqa: E402

frames = ROOT / "tests" / "frames"
truth = json.loads((frames / "quickbar.json").read_text(encoding="utf-8"))
base = np.load(str(ROOT / "assets" / "pot_digits.npz"), allow_pickle=False)
shapes = {str(d): base[f"d{d}"].astype(np.float32) for d in range(10)}


def fit(ink, text, start, row):
    """How well the known text fits at this place, and where each digit is."""
    total, spots, pos = 0.0, [], start
    for ch in text:
        t = shapes[ch]
        s, at = max((qb.fit_at(ink, t, x, row), x) for x in range(pos - 1, pos + 2))
        total += s
        spots.append(at)
        pos = at + qb.step_of(ch)
    return total / len(text), spots


cells = {}
items = {}
for name, slots in truth.items():
    img = cv2.imread(str(frames / name))
    for key, want in slots.items():
        if want.get("item"):
            x, y = qb._slot_at(key)
            items.setdefault(want["item"], img[y:y + qb.ICON_TOP, x:x + qb.SLOT_W])
        text = str(want["count"])
        ink = qb.soft_ink(qb.count_band(img, key))
        score, spots, row = max(((*fit(ink, text, start, row), row) for start in qb.STARTS for row in qb.COUNT_ROWS), key=lambda v: v[0])
        print(f"{name} {key}: {text} fits {score:.2f} at row {row}, {spots}")
        for ch, at in zip(text, spots):
            cells.setdefault(ch, []).append(ink[row:row + 26, at:at + shapes[ch].shape[1]])
out = {f"d{d}": np.mean(cells[str(d)], axis=0).astype(np.float32) if str(d) in cells else shapes[str(d)] for d in range(10)}
print("From real pictures:", {d: len(v) for d, v in sorted(cells.items())}, " Still missing:", [str(d) for d in range(10) if str(d) not in cells])
np.savez_compressed(ROOT / "assets" / "quick_digits.npz", **out)
np.savez_compressed(ROOT / "assets" / "quick_icons.npz", **items)
print("Items:", sorted(items))
