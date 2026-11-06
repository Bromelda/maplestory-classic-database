"""Watching an NPC shop, off the screen: what was bought or sold, how many, and for how much.

The shop's window shows your mesos the whole time it's open, and the row you clicked stays highlighted on each side: the
shop's list on the left, your own on the right. So when the mesos fall, it was the left row, and how far they fell over its
price is how many. When they rise, it's the right row. That needs no reading of the "how many" box, and the price is the one on
screen, so a town's discount for its citizens counts ("35 -> 33 Mesos" is 33). A row is read when it's clicked, so it doesn't
matter if the row's covered or gone by the time the mesos change.

Everything's measured from the green LEAVE STORE button, so the window can be anywhere and any size. Only reads pictures.
"""
import difflib
import re
from collections import Counter

import cv2
import numpy as np

BUTTON_W, BUTTON_H = 123, 26    # LEAVE STORE, as drawn at 2560x1440: everything below is in these pixels, scaled to what's seen
BUY_DY = 38                     # BUY ITEM, under LEAVE STORE
SELL_DX = 431                   # SELL ITEM, right of BUY ITEM
ROW_W, ROW_H, ROW_PITCH, ROWS = 303, 65, 75, 6
LEFT_DX, RIGHT_DX, ROW_DY = -208, 223, 212
MESOS_BOX = (392, 95, 164, 25)  # the digits of your mesos: x, y, w, h from LEAVE STORE
NAME_LINE = (6, 3, 297, 29)     # within a row: x, y, w, h
PRICE_LINE = (36, 32, 267, 31)  # (past the coin)
SNAP = 0.6                      # how alike a read name has to be to a known one
LOOK_OPEN, LOOK_CLOSED = 0.25, 1.0      # seconds between looks


def _green(hsv):
    h, s, v = cv2.split(hsv)
    return (np.abs(h.astype(np.int16) - 50) <= 18) & (s > 120) & (v > 130)


def _orange(hsv):
    h, s, v = cv2.split(hsv)
    return (np.abs(h.astype(np.int16) - 14) <= 7) & (s > 150) & (v > 190)


def _parts(mask):
    n, _, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
    return [tuple(map(int, stats[i][:4])) for i in range(1, n)]


def find_shop(bgr):
    """(x, y, scale) of LEAVE STORE in this picture, if a shop's open, or None."""
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    for x, y, w, h in _parts(_green(hsv)):
        scale = w / BUTTON_W
        if not 0.4 <= scale <= 2.5 or abs(h / scale - BUTTON_H) > 4:
            continue
        orange = _parts(_orange(hsv[y:y + int(70 * scale), x:x + int((SELL_DX + BUTTON_W + 10) * scale)]))
        size = [p for p in orange if abs(p[2] - w) <= 4 and abs(p[3] / scale - BUTTON_H) <= 4]
        buy = any(abs(p[0]) <= 4 and abs(p[1] - BUY_DY * scale) <= 5 * scale for p in size)
        sell = any(abs(p[0] - SELL_DX * scale) <= 6 * scale and abs(p[1] - BUY_DY * scale) <= 5 * scale for p in size)
        if buy and sell:
            return x, y, scale
    return None


def selected_row(bgr, where, side):
    """The highlighted row on this side ("left" or "right"), as a picture, or None. A row part covered by a box doesn't count."""
    x, y, s = where
    x0 = max(0, x + int(round((LEFT_DX if side == "left" else RIGHT_DX) * s)))
    y0 = max(0, y + int(round(ROW_DY * s)))
    x1, y1 = x0 + int(round(ROW_W * s)), y0 + int(round((ROWS * ROW_PITCH) * s))
    area = bgr[y0:y1, x0:x1]
    if area.size == 0:
        return None
    for px, py, w, h in _parts(_orange(cv2.cvtColor(area, cv2.COLOR_BGR2HSV))):
        if w >= 0.97 * ROW_W * s and abs(h / s - ROW_H) <= 4:
            return area[py:py + h, px:px + w]
    return None


def _text_mask(bgr):
    """How far each pixel is from the picture's background, 0 to 1: the row in focus has white text and the other dark."""
    back = np.median(bgr.reshape(-1, 3), axis=0)
    return np.clip((np.linalg.norm(bgr.astype(np.float32) - back, axis=2) - 45) / 110, 0, 1)


def _images(mask, glyph):
    """The text at a few sizes, black on white, for Tesseract."""
    out = []
    for target in (36, 48, 60):
        k = target / glyph
        big = cv2.resize(mask.astype(np.float32), None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC)
        for img in ((big > 0.5) * 255.0, np.clip(big, 0, 1) * 255):
            out.append(cv2.copyMakeBorder((255 - img).astype(np.uint8), 24, 24, 24, 24, cv2.BORDER_CONSTANT, value=255))
    return out


def _crop(row, line, s):
    x, y, w, h = [int(round(v * s)) for v in line]
    return row[y:y + h, x:x + w]


def _number(text):
    """The number in a mesos box's text, or None."""
    digits = re.sub(r"[^0-9]", "", text)
    return int(digits) if digits else None


def price_of(text):
    """What a price line says it costs: the last number, for a discount ("35 -> 33 Mesos"), or None."""
    found = re.findall(r"\d[\d,.]*", text)
    if not found:
        return None
    digits = re.sub(r"[^0-9]", "", found[-1])
    return int(digits) if digits else None


class ShopWatch:
    """read_lines(images, chars): Tesseract. known: names it might be selling. prices: {name: its normal price}."""

    def __init__(self, read_lines, known=(), prices=None):
        self.read_lines = read_lines
        self.known = sorted(set(known) | set(prices or ()))
        self.prices = prices or {}
        self.reset()

    def reset(self):
        self.where = None
        self.mesos = None
        self.rows = {"left": None, "right": None}       # side: (name, price) as last read
        self.row_print = {"left": None, "right": None}
        self.box_print = None
        self.doubt = None                               # a new mesos reading: it has to read the same again to count

    @property
    def open(self):
        return self.where is not None

    # ---------- reading ----------

    def _snap(self, votes):
        """The most likely known name from what Tesseract read."""
        best, best_score = None, 0.0
        for text, n in votes.most_common():
            for name in self.known:
                score = difflib.SequenceMatcher(None, text.lower(), name.lower()).ratio() + 0.02 * n
                if score > best_score:
                    best, best_score = name, score
        if best and best_score >= SNAP:
            return best
        return votes.most_common(1)[0][0] if votes else None

    def read_row(self, row, s):
        """(name, price) on a highlighted row: either may be None."""
        name_part, price_part = _crop(row, NAME_LINE, s), _crop(row, PRICE_LINE, s)
        glyph = 13 * s
        names = Counter(t.strip() for t in self.read_lines(_images(_text_mask(name_part), glyph), None) if len(t.strip()) >= 2)
        prices = Counter(p for p in (price_of(t) for t in self.read_lines(_images(_text_mask(price_part), glyph), "0123456789,Meso ")) if p)
        return self._snap(names), (prices.most_common(1)[0][0] if prices else None)

    def read_mesos(self, bgr):
        """Your mesos, as shown in the shop, or None."""
        x, y, s = self.where
        bx, by, bw, bh = [int(round(v * s)) for v in MESOS_BOX]
        box = bgr[max(0, y + by):y + by + bh, max(0, x + bx):x + bx + bw]
        if box.size == 0:
            return None
        votes = Counter(n for n in (_number(t) for t in self.read_lines(_images(_text_mask(box), 13 * s), "0123456789,")) if n is not None)
        if not votes:
            return None
        value, n = votes.most_common(1)[0]
        return value if n >= 2 else None

    # ---------- looking ----------

    @staticmethod
    def _print(picture):
        return cv2.resize(cv2.cvtColor(picture, cv2.COLOR_BGR2GRAY), (64, 16), interpolation=cv2.INTER_AREA).astype(np.int16)

    def _changed(self, old, new):
        return old is None or np.abs(old - new).mean() > 2.0

    def _fit(self, change):
        """What this change in the mesos was: (kind, name, how many, price) if the row and its price explain it."""
        kind, side = ("bought", "left") if change < 0 else ("sold", "right")
        name, price = self.rows[side] or (None, None)
        total = abs(change)
        for p in (price, self.prices.get(name) if kind == "bought" else None):
            if p and total % p == 0:
                return kind, name, total // p, p
        return None

    def look(self, bgr):
        """One look at the game. What's happened since the last, as a list of (a change in the mesos has to read the same twice):
        {"kind": "bought" or "sold", "name", "qty", "price", "total", "mesos"} for a row that explains it,
        {"kind": "mesos", "mesos"} for the shop's first reading or a change nothing here explains."""
        found = find_shop(bgr)
        if not found:
            if self.where:
                self.reset()
            return []
        moved = self.where and (abs(found[0] - self.where[0]) > 3 or abs(found[1] - self.where[1]) > 3)
        if not self.where or moved:
            self.where, self.box_print = found, None
        s = self.where[2]
        for side in ("left", "right"):
            row = selected_row(bgr, self.where, side)
            if row is None:
                continue
            mark = self._print(row)
            if self._changed(self.row_print[side], mark):
                self.row_print[side] = mark
                self.rows[side] = self.read_row(row, s)
        x, y, _ = self.where
        bx, by, bw, bh = [int(round(v * s)) for v in MESOS_BOX]
        box = bgr[max(0, y + by):y + by + bh, max(0, x + bx):x + bx + bw]
        if box.size == 0:
            return []
        mark = self._print(box)
        if not self._changed(self.box_print, mark) and self.doubt is None and self.mesos is not None:
            return []
        self.box_print = mark
        value = self.read_mesos(bgr)
        if value is None:
            self.box_print = None           # (try again next look)
            return []
        if self.mesos is None:
            self.mesos = value
            return [{"kind": "mesos", "mesos": value}]
        if value == self.mesos:
            self.doubt = None
            return []
        if self.doubt != value:
            self.doubt = value              # (a misread can fit a price too: 69,468 read as 9,468 is 400 Lemons)
            return []
        self.doubt = None
        fit = self._fit(value - self.mesos)
        change, self.mesos = value - self.mesos, value
        if not fit:
            return [{"kind": "mesos", "mesos": value}]
        kind, name, qty, price = fit
        return [{"kind": kind, "name": name, "qty": qty, "price": price, "total": abs(change), "mesos": value}]
