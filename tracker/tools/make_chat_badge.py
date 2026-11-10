"""Makes assets/chat_badge.npz, what chatwatch.py reads a speaker's channel with: the shapes of the "CH" on the badge after
a speaker's name, and of the digits after it, from the speaker lines in the owner's open chat box pictures
(tests/frames/chat_lines, kept on the owner's computer only). Each line's channel is listed below, read by eye.

The shapes are of the badge's red letters as chatwatch._badge_map() sees them (green less half the red), in a 1440-tall game.
A digit it isn't sure of is shown as "?". It checks itself: each line is read with shapes made from all the others, and any
line read wrong is listed (a digit seen on one line only can't be checked that way: it's read as "?"). More lines: put a
picture of an open chat box in tests/frames/chat_lines, list its speaker lines below, and run this again.

Run from the project folder:  py -3 tools/make_chat_badge.py"""
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import chatwatch as cw  # noqa: E402

FRAMES = ROOT / "tests" / "frames" / "chat_lines"
RECT = (0, 0, 2560, 1440)
# (picture, where lines start in it, its speaker lines' tops, top to bottom, with their channels)
LINES = (("open_0020_201.png", None, {352: "03", 503: "32"}),
         ("open_0018_22.png", None, {291: "02", 321: "38", 352: "01", 382: "01", 412: "30", 472: "01"}),
         ("buddy_open.png", 54, {334: "37", 394: "09"}),
         ("open_0019_387.png", None, {412: "28"}),
         ("open_0023_243.png", None, {321: "21", 352: "21", 382: "26", 412: "22", 442: "11", 472: "15", 503: "22", 533: "03"}),
         ("open_0023_86.png", None, {291: "01", 321: "26", 352: "38", 412: "40", 442: "40", 503: "38", 533: "11"}))
CH_ROWS = (12, 24)          # the "CH" in the first line's band (from 6 above the line), and right of the badge's left edge:
CH_COLS = (1, 18)


def bands():
    """[(channel, the badge's map: the line's band from the line's start)] for every speaker line listed."""
    out = []
    for name, x0, tops in LINES:
        img = cv2.imread(str(FRAMES / name))
        if img is None:
            sys.exit(f"Missing {FRAMES / name}: the pictures are on the owner's computer only.")
        x0 = cw.text_x(RECT) if x0 is None else x0
        found = {r.top: r for r in cw.rows(img, 1.0, x0) if r.kind == "speaker"}
        for top, ch in tops.items():
            if top not in found:
                sys.exit(f"{name}: no speaker line at {top} (found {sorted(found)})")
            out.append((ch, img[top - 6:found[top].bottom + 6, x0 - 14:x0 + 400]))
    return out


def main():
    lines = bands()
    shapes = make(lines)
    np.savez_compressed(str(cw.BADGE), **shapes)
    print(f"Saved {cw.BADGE.name}: CH and digits {''.join(sorted(k for k in shapes if k != 'CH'))} (from {len(lines)} lines)")
    wrong = 0
    for i, (ch, band) in enumerate(lines):
        got = cw.read_badge(cw._badge_map(band), make(lines[:i] + lines[i + 1:]))
        if got != ch:
            print(f"  line {i + 1} ({ch}) read without it as {got!r}")
            wrong += len(got) != len(ch) or any(a != b and a != "?" for a, b in zip(got, ch))
    print(f"Read wrong (not just unsure) without itself: {wrong} of {len(lines)}")


def make(lines):
    # The "CH": from the first line, where its badge starts (its light inside), then lined up on all of them and averaged.
    ch, band = lines[0]
    lightest = band.min(axis=2).astype(np.float32)
    light = lightest >= max(170, min(215, float(np.median(lightest)) + 50))
    left = int(np.nonzero(light.mean(axis=0) >= 0.4)[0].min())
    shape = cw._badge_map(band)[CH_ROWS[0]:CH_ROWS[1], left + CH_COLS[0]:left + CH_COLS[1]]
    for _ in range(3):
        at = []
        for ch, band in lines:
            g = cw._badge_map(band)
            _, score, _, (x, y) = cv2.minMaxLoc(cv2.matchTemplate(g, shape, cv2.TM_CCOEFF_NORMED))
            at.append((ch, g, x, y, score))
        shape = np.mean([g[y:y + shape.shape[0], x:x + shape.shape[1]] for _, g, x, y, _ in at], axis=0).astype(np.float32)
    h = shape.shape[0]
    digits = {}
    for ch, g, x, y, score in at:
        if score < cw.BADGE_FIND:
            sys.exit(f"A badge wasn't found ({score:.2f})")
        for d, dx in zip(ch, cw.BADGE_DX):
            digits.setdefault(d, []).append(g[y:y + h, x + dx:x + dx + 9])
    return {"CH": shape, **{d: np.mean(v, axis=0).astype(np.float32) for d, v in digits.items()}}


if __name__ == "__main__":
    main()
