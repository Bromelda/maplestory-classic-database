"""Reading what a quest gives you, off the NPC's chat window.

When a quest's handed in, the chat window shows a red OBTAINED! and under it what you got, a line each: "Blue Potion x 20", "3937 Exp",
"1082 Mesos". None of that shows in the message lines, so without this it looks like items bought, mesos from nowhere and lines missed.

Everything's measured from the green END CHAT button, so the window can be anywhere. Only reads pictures.
"""
import difflib
import re
from collections import Counter

import cv2
import numpy as np

BUTTON_W, BUTTON_H = 152, 26    # END CHAT, as drawn at 1440 tall: everything below is in these pixels, scaled to what's seen
PANEL_X, PANEL_Y = 265, -450    # the white part with the words, from the button's corner
PANEL_W, PANEL_H = 665, 390
TEXT_X = 62                     # where the words start, in from the panel's left (past most of an item's picture)
BAND_X, BAND_W = 85, 215        # the part of the panel that only words reach, to find the lines by
SNAP = 0.75                     # how alike a read name has to be to a known item
AMOUNT = re.compile(r"(\d[\d,. ]*)\s*(exp|mesos?)\b", re.I)
ITEM = re.compile(r"([A-Za-z][A-Za-z'. :-]*?)\s*[xX×]\s*(\d[\d,]*)\s*$")


def find_chat(bgr):
    """(x, y, scale) of END CHAT if an NPC's chat window is up, or None. (A white panel above it tells it from other green buttons.)"""
    h, s, v = cv2.split(cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV))
    green = (np.abs(h.astype(np.int16) - 50) <= 18) & (s > 120) & (v > 130)
    n, _, stats, _ = cv2.connectedComponentsWithStats(green.astype(np.uint8), connectivity=8)
    for i in range(1, n):
        x, y, w, hh = map(int, stats[i][:4])
        k = w / BUTTON_W
        if not 0.4 <= k <= 2.5 or abs(hh / k - BUTTON_H) > 4:
            continue
        panel = _panel(bgr, (x, y, k))
        if panel.size and panel.shape[0] > 100 * k and float((panel.min(axis=2) > 225).mean()) > 0.5:
            return x, y, k
    return None


def _panel(bgr, chat):
    x, y, k = chat
    x0, y0 = max(0, x + int(PANEL_X * k)), max(0, y + int(PANEL_Y * k))
    return bgr[y0:y + int((PANEL_Y + PANEL_H) * k), x0:x0 + int(PANEL_W * k)]


def _obtained_bottom(panel):
    """How far down the panel the red OBTAINED! ends, or None if it isn't there."""
    h, s, v = cv2.split(cv2.cvtColor(panel, cv2.COLOR_BGR2HSV))
    red = ((h < 8) | (h > 170)) & (s > 150) & (v > 170)
    rows = np.nonzero(red[:, :panel.shape[1] // 2].sum(axis=1) >= 8)[0]
    if rows.size < 8:
        return None
    ends = np.nonzero(np.diff(rows) > 1)[0]     # (the first red: there can be red in an item's picture further down)
    first = rows[:ends[0] + 1] if ends.size else rows
    return int(first[-1]) if first.size >= 8 else None


def _rows(panel, top, k):
    """(top, bottom) of each line of words below top."""
    dark = panel[:, int(BAND_X * k):int((BAND_X + BAND_W) * k)].max(axis=2) < 170
    on = dark.sum(axis=1) >= 2
    on[:top + 2] = False
    rows, start = [], None
    for y, lit in enumerate(on):
        if lit and start is None:
            start = y
        elif not lit and start is not None:
            if y - start >= 8 * k:
                rows.append((start, y))
            start = None
    return rows


def _images(gray, k):
    """A line at a few sizes, for Tesseract."""
    out = []
    for target in (2.0, 3.0, 4.0):
        big = cv2.resize(gray, None, fx=target / k, fy=target / k, interpolation=cv2.INTER_CUBIC)
        for img in (big, ((big > 150) * 255).astype(np.uint8)):
            out.append(cv2.copyMakeBorder(img, 20, 20, 20, 20, cv2.BORDER_CONSTANT, value=245))
    return out


class QuestWatch:
    """read_lines(images, chars): Tesseract. known: the game's item names."""

    def __init__(self, read_lines, known=()):
        self.read_lines = read_lines
        self.known = sorted(set(known))
        self.told = None                # the reward on screen, once it's been told
        self.open = False

    def _item(self, text):
        name = re.sub(r"^[^A-Za-z]*(?:[A-Za-z]{1,2}\s+)?(?=[A-Z])", "", text).strip()
        best = difflib.get_close_matches(name, self.known, n=1, cutoff=SNAP)
        return best[0] if best else (name if self.known == [] else None)

    def read_reward(self, panel, top, k):
        """{"items": {name: how many}, "exp": n, "mesos": n} from the lines under OBTAINED!, or None if there's nothing there."""
        gray = cv2.cvtColor(panel, cv2.COLOR_BGR2GRAY)
        got = {"items": {}, "exp": 0, "mesos": 0}
        for y0, y1 in _rows(panel, top, k):
            pad = int(3 * k)
            line = gray[max(0, y0 - pad):y1 + pad, int(TEXT_X * k):]
            votes = Counter()
            for text in self.read_lines(_images(line, k), None):
                text = text.strip()
                amount = AMOUNT.search(text)
                if amount:
                    digits = re.sub(r"\D", "", amount.group(1))
                    if digits:
                        votes[("exp" if amount.group(2).lower() == "exp" else "mesos", int(digits))] += 1
                    continue
                item = ITEM.search(text)
                if item:
                    name = self._item(item.group(1))
                    digits = re.sub(r"\D", "", item.group(2))
                    if name and digits:
                        votes[("item", name, int(digits))] += 1
            if votes:
                best, n = votes.most_common(1)[0]
                if n >= 2:
                    if best[0] == "item":
                        got["items"][best[1]] = got["items"].get(best[1], 0) + best[2]
                    else:
                        got[best[0]] += best[1]
        return got if got["items"] or got["exp"] or got["mesos"] else None

    def look(self, bgr):
        """One look at the game. A reward, the once, when one's on screen, or None."""
        chat = find_chat(bgr)
        self.open = chat is not None
        if not chat:
            self.told = None
            return None
        panel = _panel(bgr, chat)
        top = _obtained_bottom(panel)
        if top is None:
            self.told = None
            return None
        reward = self.read_reward(panel, top, chat[2])
        if reward is None or reward == self.told:
            return None
        if self.told is None:
            self.told = reward
            return reward
        if _smaller(reward, self.told):
            return None                 # (the same reward, read short)
        # Still on the same page, and more's been read of it (on a real clip, the potions were missed at first): only what's new, or the
        # EXP and mesos would be counted twice.
        extra = {"items": {n: q - self.told["items"].get(n, 0) for n, q in reward["items"].items() if q > self.told["items"].get(n, 0)},
                 "exp": 0 if self.told["exp"] else reward["exp"], "mesos": 0 if self.told["mesos"] else reward["mesos"]}
        self.told = {"items": {**self.told["items"], **reward["items"]}, "exp": self.told["exp"] or reward["exp"], "mesos": self.told["mesos"] or reward["mesos"]}
        return extra if extra["items"] or extra["exp"] or extra["mesos"] else None


def _smaller(a, b):
    """Has a nothing that b hasn't?"""
    return a["exp"] in (0, b["exp"]) and a["mesos"] in (0, b["mesos"]) and all(b["items"].get(n) == q for n, q in a["items"].items())
