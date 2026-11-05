"""Reads the HP and MP numbers from the status bar ("HP[581/878]"), which is how potions used are noticed:
nothing in the game says when you drink one, but your HP or MP jumps.

The bar sits in the middle of the window's bottom edge, and is drawn in proportion to the window's height. The
digits' shapes (assets/bar_digits.npz) were cut from real pictures of the game, with the numbers read by eye.
Only pictures are read, like everything else here.
"""
from pathlib import Path

import cv2
import numpy as np

# Where the numbers are, in pixels of a 1440-tall window: from the window's middle, and up from its bottom.
HP_BOX = (-310, -56, -210, -38)
MP_BOX = (-100, -56, 24, -38)
WIDTH_COUNTS = 0.5          # how much a digit being the wrong shape overall counts against it
READ_OK = 0.5               # how well a digit must fit


def glyphs(crop):
    """The bright, colourless marks in a picture of "[581/878]": (their picture, [(x, y, w, h, area)], left to right).
    The brackets are green, so they drop out."""
    crop = cv2.resize(crop, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    b, g, r = [crop[..., k].astype(np.float32) for k in range(3)]
    light = np.minimum(np.minimum(b, g), r)
    colour = np.maximum(np.maximum(b, g), r) - light
    ink = np.where(colour < 60, light, 0)
    top = float(np.percentile(ink, 99))
    if top < 90:
        return ink, []
    lit = (ink > 0.6 * top).astype(np.uint8)
    n, _, stats, _ = cv2.connectedComponentsWithStats(lit, connectivity=8)
    return ink, sorted((tuple(int(v) for v in stats[k][:5]) for k in range(1, n)
                        if stats[k][3] >= 0.45 * crop.shape[0] and stats[k][4] >= 6), key=lambda s: s[0])


class VitalsReader:
    def __init__(self, assets):
        data = np.load(str(Path(assets) / "bar_digits.npz"))
        self.shapes = {str(d): data[f"d{d}"].astype(np.float32) for d in range(10)}

    @staticmethod
    def area(rect):
        """The part of the screen with both numbers, for a game window at rect: (x, y, w, h)."""
        wx, wy, ww, wh = rect
        s = wh / 1440
        x0, y0, x1, y1 = int(HP_BOX[0] * s), int(HP_BOX[1] * s), int(MP_BOX[2] * s), int(MP_BOX[3] * s)
        return wx + ww // 2 + x0, wy + wh + y0, x1 - x0, y1 - y0

    def read_area(self, img, s):
        """Both numbers from a picture of area(): s is the window's height / 1440."""
        x = int(HP_BOX[0] * s)
        return {"hp": self.read_box(img[:, :int(HP_BOX[2] * s) - x]),
                "mp": self.read_box(img[:, int(MP_BOX[0] * s) - x:])}

    def read(self, frame):
        """Both numbers from a picture of the whole game window."""
        H, W = frame.shape[:2]
        x, y, w, h = self.area((0, 0, W, H))
        return self.read_area(frame[y:y + h, x:x + w], H / 1440)

    def read_box(self, crop):
        """(now, most) from a picture of "[581/878]", or None if it isn't clear."""
        if crop.size == 0:
            return None
        ink, blobs = glyphs(crop)
        if len(blobs) < 3:
            return None
        text = ""
        for x, y, w, h, _ in blobs:
            part = ink[y:y + h, x:x + w]
            if w >= 1.1 * h:
                return None                     # two marks stuck together: not clear
            if self._is_slash(part):
                text += "/"
                continue
            best, score = None, -2.0
            for d, t in self.shapes.items():
                fit = cv2.resize(part, (t.shape[1], t.shape[0]), interpolation=cv2.INTER_AREA)
                got = float(np.nan_to_num(cv2.matchTemplate(fit, t, cv2.TM_CCOEFF_NORMED)).max())
                got -= WIDTH_COUNTS * abs(w / h - t.shape[1] / t.shape[0])
                if got > score:
                    best, score = d, got
            if score < READ_OK:
                return None
            text += best
        if text.count("/") != 1:
            return None
        now, most = text.split("/")
        if not now or not most or len(most) > 5:
            return None
        now, most = int(now), int(most)
        return (now, most) if now <= most and most > 0 else None

    @staticmethod
    def _is_slash(part):
        """A slash leans: its top is further right than its bottom."""
        lit = part > 0.5 * part.max()
        ys, xs = np.nonzero(lit)
        if len(xs) < 4 or xs.std() == 0 or ys.std() == 0:
            return False
        return float(np.corrcoef(xs, ys)[0, 1]) < -0.6
