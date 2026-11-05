"""Reads the keyboard quick bar (the game's Short Cut button): which potion or food is in each slot, and how many
you have, which the game prints over its picture.

The bar sits above the buttons at the bottom right, and is drawn in proportion to the window's height. When it's open
the dark lines between its slots are there; when it's closed they aren't, and nothing is read. A count that isn't
clear is left out rather than guessed. Only pictures are read, like everything else here.

Measured on a real 1440-tall window, and only checked at that size.
"""
from pathlib import Path

import cv2
import numpy as np

# In pixels of a 1440-tall window, from the window's middle and up from its bottom.
COLUMNS = (481, 547, 613, 679)      # each slot's left edge
ROWS = (-323, -259, -196)           # each slot's top edge
SLOT_W, SLOT_H = 60, 56
LEFT, TOP = COLUMNS[0] - 24, ROWS[0] - 16       # the corner of the part of the screen that's looked at
KEYS = ("F1", "F2", "F3", "F4", "A", "S", "C", "D", "1", "2", "3", "4")
LINES_DARK = 0.85                   # how much of the lines between the slots must be dark for the bar to be open
SEEN_OK = 0.9                       # how well a slot must look like a real picture of an item (assets/quick_icons.npz)
ICON_OK, ICON_LEAD = 0.85, 0.1      # the same for the plainer pictures in assets/icons, and how far ahead of the next
ICON_SCALE = 1.75                   # the game draws those pictures this size in a 1440-tall window
ICON_TOP = 36                       # how much of a slot's top has no count over it

# Digits are compared at the size of a 2160-tall window, where they're 26 tall.
COUNT_FX = 1.5
BAND_TOP, BAND_H, BAND_LEFT, BAND_W = 30, 30, -6, 72        # the count's part of a slot, in pixels of a 1440-tall window
STARTS, COUNT_ROWS = range(9, 17), range(10, 16)            # where the first digit can be in that part, at digit size
STEP, ONE_STEP = 22, 14             # how far apart digits are at digit size (a 1 is narrower)
READ_OK = 0.8                       # how well a digit must fit
READ_LEAD = 0.08                    # how much better than the next best it must be
NEAR_MISS = 0.5                     # a poorer fit than READ_OK but better than this, on dark, is a digit that isn't clear
PLATE_DARK = 0.3                    # how much of a digit's place is dark (each digit sits on black)


def area(rect):
    """The part of the screen with the whole bar, for a game window at rect: (x, y, w, h)."""
    wx, wy, ww, wh = rect
    s = wh / 1440
    x0, y0 = int(LEFT * s), int(TOP * s)
    return wx + ww // 2 + x0, wy + wh + y0, int((COLUMNS[-1] + SLOT_W + 16) * s) - x0, int(-y0 - 110 * s)


def _slot_at(key, s=1.0):
    k = KEYS.index(key)
    return int(COLUMNS[k % 4] * s) - int(LEFT * s), int(ROWS[k // 4] * s) - int(TOP * s)


def count_band(img, key, s=1.0):
    """The part of a picture of area() with a slot's count, at digit size."""
    x, y = _slot_at(key, s)
    band = img[y + int(BAND_TOP * s):y + int((BAND_TOP + BAND_H) * s), max(0, x + int(BAND_LEFT * s)):x + int((BAND_LEFT + BAND_W) * s)]
    return cv2.resize(band, None, fx=COUNT_FX / s, fy=COUNT_FX / s, interpolation=cv2.INTER_CUBIC)


def soft_ink(band):
    """How much each pixel looks like a digit's stroke, 0 to 1: light, and colourless or light blue."""
    b, g, r = [band[..., k].astype(np.float32) for k in range(3)]
    v = np.maximum(np.maximum(b, g), r)
    colour = (v - np.minimum(np.minimum(b, g), r)) / np.maximum(v, 1)
    return np.clip((v - 70) / 150, 0, 1) * ((colour < 0.45) | ((b >= g) & (g >= r)))


def fit_at(ink, shape, x, y):
    if x < 0 or y < 0:
        return -1.0
    win = ink[y:y + shape.shape[0], x:x + shape.shape[1]]
    if win.shape != shape.shape or win.std() == 0:
        return -1.0
    return float(cv2.matchTemplate(win, shape, cv2.TM_CCOEFF_NORMED)[0, 0])


def step_of(digit):
    return ONE_STEP if digit == "1" else STEP


class QuickBar:
    def __init__(self, assets, heal_gids=None):
        self.assets = Path(assets)
        data = np.load(str(self.assets / "quick_digits.npz"), allow_pickle=False)
        self.shapes = {str(d): data[f"d{d}"].astype(np.float32) for d in range(10)}
        self.icons = {}                 # name: (picture, mask), at the bar's size
        for name, gid in (heal_gids or {}).items():
            im = cv2.imread(str(self.assets / "icons" / f"{gid}.png"), cv2.IMREAD_UNCHANGED)
            if im is None or im.ndim != 3 or im.shape[2] != 4:
                continue
            sized = cv2.resize(im, None, fx=ICON_SCALE, fy=ICON_SCALE, interpolation=cv2.INTER_LINEAR)
            self.icons[name] = (sized[..., :3].astype(np.float32), (sized[..., 3] > 128).astype(np.float32))
        try:
            seen = np.load(str(self.assets / "quick_icons.npz"), allow_pickle=False)
            self.seen = {name: seen[name].astype(np.float32) for name in seen.files}
        except OSError:
            self.seen = {}              # (real pictures of items, cut by tools/make_quick_digits.py)
        self.known = {}                 # a slot's picture, as bytes: its item, so each look doesn't compare them all
        self.read_before = {}           # a count's picture, as bytes: what it says

    def is_open(self, img, s=1.0):
        """Are the dark lines between the slots there? img is a picture of area()."""
        ox, oy = int(LEFT * s), int(TOP * s)
        v = img.max(axis=2)
        parts = []
        for x in COLUMNS[1:]:
            x0, y0, y1 = int((x - 4) * s) - ox, int(ROWS[0] * s) - oy, int((ROWS[-1] + SLOT_H) * s) - oy
            parts.append(v[y0:y1, x0:x0 + max(1, int(3 * s))].ravel())
        for y in ROWS[1:]:
            y0, x0, x1 = int((y - 5) * s) - oy, int(COLUMNS[0] * s) - ox, int((COLUMNS[-1] + SLOT_W) * s) - ox
            parts.append(v[y0:y0 + max(1, int(3 * s)), x0:x1].ravel())
        lines = np.concatenate(parts)
        return lines.size > 0 and float((lines < 60).mean()) >= LINES_DARK

    def read(self, img, s=1.0):
        """None when the bar's closed; else {slot's key: (item's name or None, count or None)}, leaving out empty slots."""
        if not self.is_open(img, s):
            return None
        out = {}
        for key in KEYS:
            x, y = _slot_at(key, s)
            slot = img[y:y + int(SLOT_H * s), x:x + int(SLOT_W * s)]
            if slot.size == 0 or self._empty(slot):
                continue
            out[key] = (self._name(slot, s), self.count(img, key, s))
        return out

    @staticmethod
    def _empty(slot):
        """An empty slot's middle is all one pale colour, apart from its key's faint letter."""
        h, w = slot.shape[:2]
        hsv = cv2.cvtColor(slot[h // 6:-h // 6, w // 6:-w // 6], cv2.COLOR_BGR2HSV)
        return float((hsv[..., 2] < 170).mean()) < 0.02 and float((hsv[..., 1] > 70).mean()) < 0.02

    def _name(self, slot, s):
        """Which known potion or food a slot's picture is, or None. The part with the count on it is left out."""
        part = slot[:int(ICON_TOP * s)]
        key = part.tobytes()
        if key in self.known:
            return self.known[key]
        best = self._seen_item(part, s) or self._listed_item(part, s)
        self.known[key] = best
        return best

    def _seen_item(self, part, s):
        src = part.astype(np.float32)
        best, score = None, SEEN_OK
        for name, pic in self.seen.items():
            if s != 1.0:
                pic = cv2.resize(pic, None, fx=s, fy=s)
            inner = pic[3:-3, 3:-3]             # (a little room, as a slot's picture can sit a pixel off)
            if inner.shape[0] > src.shape[0] or inner.shape[1] > src.shape[1]:
                continue
            got = float(cv2.matchTemplate(src, inner, cv2.TM_CCOEFF_NORMED).max())
            if got > score:
                best, score = name, got
        return best

    def _listed_item(self, part, s):
        src = part.astype(np.float32)
        scores = []
        for name, (pic, mask) in self.icons.items():
            if s != 1.0:
                pic, mask = cv2.resize(pic, None, fx=s, fy=s), cv2.resize(mask, None, fx=s, fy=s)
            th, tw = min(pic.shape[0], src.shape[0]), min(pic.shape[1], src.shape[1])
            if mask[:th, :tw].sum() < 40:
                continue
            got = cv2.matchTemplate(src, pic[:th, :tw], cv2.TM_CCOEFF_NORMED, mask=np.dstack([mask[:th, :tw]] * 3))
            scores.append((float(np.nan_to_num(got, posinf=-1, neginf=-1).max()), name))
        scores.sort(reverse=True)
        if scores and scores[0][0] >= ICON_OK and (len(scores) == 1 or scores[0][0] - scores[1][0] >= ICON_LEAD):
            return scores[0][1]
        return None

    def count(self, img, key, s=1.0):
        """The count in a slot, or None if there's none or it isn't clear."""
        band = count_band(img, key, s)
        seen_as = band.tobytes()
        if seen_as in self.read_before:
            return self.read_before[seen_as]
        got = self._read_band(band)
        if len(self.read_before) > 500:
            self.read_before.clear()
        self.read_before[seen_as] = got
        return got

    def _read_band(self, band):
        ink = soft_ink(band)
        dark = band.max(axis=2) < 90
        best = None
        for start in STARTS:
            for row in COUNT_ROWS:
                got = self._digits(ink, dark, start, row)
                if got and (best is None or (len(got[0]), got[1]) > (len(best[0]), best[1])):
                    best = got
        if best is None or (len(best[0]) > 1 and best[0][0] == "0"):
            return None
        return int(best[0])

    def _digits(self, ink, dark, pos, row):
        """The digits left to right from a place: (their text, the worst fit), or None if any isn't clear."""
        text, worst = "", 1.0
        while len(text) <= 5:
            ranked = sorted(((max(fit_at(ink, t, x, row) for x in range(pos - 1, pos + 2)), d) for d, t in self.shapes.items()), reverse=True)
            score, digit = ranked[0]
            if score < READ_OK:
                place = dark[row:row + 26, pos:pos + 15]
                if score >= NEAR_MISS and place.size and float(place.mean()) >= PLATE_DARK:
                    return None             # something's printed here, but not clearly: don't read the number short
                break
            if score - ranked[1][0] < READ_LEAD:
                return None
            at = max(range(pos - 1, pos + 2), key=lambda x: fit_at(ink, self.shapes[digit], x, row))
            text, worst = text + digit, min(worst, score)
            pos = at + step_of(digit)
        return (text, worst) if text else None
