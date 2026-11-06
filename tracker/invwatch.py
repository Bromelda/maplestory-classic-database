"""Reading the inventory's items off the screen, to check what the pickup lines counted against what you really got.

Each time a tab's open and solid, every slot's picture is compared with the game's item pictures (assets/icons) to say what it
is, and the number the game prints over it says how many. An item's count, the first time it's seen in a run, is where it
started. Later, what it gained can be set against the lines read for it.

Only a tab you open can be read, and only the rows showing: scrolling shows more, and the rows are put together by what's in
them. A slot it can't read keeps what it last knew. Everything's measured from the mesos box at the bottom of the window, so
the window can be anywhere. Measured on a real 2560x1440 window, on the Etc tab. Only reads pictures.
"""
import threading
from pathlib import Path

import cv2
import numpy as np

import quickbar

BOX_W = 267                     # the mesos box as drawn at 1440 tall: everything's scaled by what's seen against this
SLOT_X, SLOT_Y = -33, -409      # the first slot's corner, from the mesos box's
PITCH_X, PITCH_Y = 67.5, 63.8
SLOT_W, SLOT_H = 60, 60
COLS, ROWS = 5, 6
TABS = ("Equip", "Use", "Set Up", "Etc", "Cash", "Deco")
TAB_X0, TAB_PITCH = -7, 62      # each tab's middle, from the mesos box's left
TAB_Y, TAB_H = -456, 32         # the tabs' top, and height
TAB_ITEMS = {"Use": "2", "Set Up": "3", "Etc": "4"}     # the tabs with counts, and how their items' numbers start
ICON_SCALES = (1.75, 1.875, 2.0)    # the sizes the game draws item pictures at 1440 tall
ICON_TOP = 0.6                  # how much of a picture's top has no count over it
ICON_OK = 0.85                  # how well a picture has to fit
ICON_CLOSE = 0.06               # pictures this close in shape are recolours of each other (ores): their colours decide
ICON_COLOUR_LEAD = 1.15         # the best colour has to be this much closer than the next
SLOT_BACK = (213, 223, 225)     # the slots' colour (BGR), for drawing a picture as the game does
SLOT_PAD = 4                    # how far off a picture can be
DIGIT_OK = 0.72                 # how well a digit must fit over a picture
DIGIT_UNCLEAR = 0.6             # after a number, a fit this good could be a digit not read: then it's not read short
EMPTY = 7                       # a slot with nothing in it is this plain
COUNT_TOP, COUNT_H, COUNT_LEFT, COUNT_W = 30, 30, -6, 72    # where the number is, in a slot (as on the quick bar)
SAME_LOOKS = 2                  # looks in a row a slot has to agree


def _pink_tab(bgr, box, s):
    """Which tab's open, from the bright one above the grid."""
    x, y, _, _ = box
    y0 = max(0, y + int(TAB_Y * s))
    area = bgr[y0:y0 + int(TAB_H * s) + 2, max(0, x + int((TAB_X0 - 40) * s)):x + int((TAB_X0 + 5 * TAB_PITCH + 40) * s)]
    if area.size == 0:
        return None
    h, sat, v = cv2.split(cv2.cvtColor(area, cv2.COLOR_BGR2HSV))
    pink = ((h > 165) | (h < 5)) & (sat > 120) & (v > 180)
    n, _, stats, _ = cv2.connectedComponentsWithStats(pink.astype(np.uint8), connectivity=8)
    parts = [stats[i] for i in range(1, n) if stats[i][2] >= 30 * s and stats[i][3] >= 15 * s]
    if not parts:
        return None
    best = max(parts, key=lambda p: p[4])
    middle = (best[0] + best[2] / 2) / s + TAB_X0 - 40
    k = int(round((middle - TAB_X0) / TAB_PITCH))
    return TABS[k] if 0 <= k < len(TABS) else None


class Pictures:
    """The game's item pictures, by tab."""

    def __init__(self, assets, gids):
        self.by_tab = {t: [] for t in TAB_ITEMS}
        folder = Path(assets) / "icons"
        for name, gid in gids.items():
            first = str(gid)[0]
            tab = next((t for t, f in TAB_ITEMS.items() if f == first), None)
            pic = cv2.imread(str(folder / f"{gid}.png"), cv2.IMREAD_UNCHANGED) if tab else None
            if pic is None or pic.ndim != 3 or pic.shape[2] != 4:
                continue
            sizes = []
            for k in ICON_SCALES:
                big = cv2.resize(pic, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC).astype(np.float32)
                a = big[..., 3:] / 255
                on_slot = big[..., :3] * a + np.array(SLOT_BACK, np.float32) * (1 - a)
                sizes.append(on_slot[:max(8, int(on_slot.shape[0] * ICON_TOP))])
            self.by_tab[tab].append((name, sizes))

    def name(self, tab, slot):
        """What this slot's picture (at 1440 tall, with SLOT_PAD around it) is: its name, or None if it isn't clear. Some items are
        the same picture in another colour, so what's nearly as good a shape is decided by the colours."""
        slot = slot.astype(np.float32)
        scores = []
        for name, sizes in self.by_tab.get(tab, ()):
            best = None
            for pic in sizes:
                if pic.shape[0] > slot.shape[0] or pic.shape[1] > slot.shape[1]:
                    continue
                fit = cv2.matchTemplate(slot, pic, cv2.TM_CCOEFF_NORMED)
                _, score, _, at = cv2.minMaxLoc(fit)
                if best is None or score > best[0]:
                    best = (score, name, pic, at)
            if best:
                scores.append(best)
        if not scores:
            return None
        scores.sort(key=lambda b: -b[0])
        if scores[0][0] < ICON_OK:
            return None
        close = [b for b in scores if scores[0][0] - b[0] <= ICON_CLOSE]
        if len(close) == 1:
            return close[0][1]
        off = sorted((float(np.abs(slot[at[1]:at[1] + pic.shape[0], at[0]:at[0] + pic.shape[1]] - pic).mean()), name)
                     for _, name, pic, at in close)
        return off[0][1] if off[1][0] >= ICON_COLOUR_LEAD * off[0][0] else None


class InventoryReader:
    """Reads the slots of the tab that's open. gids: {item name: its number in the game's data}."""

    def __init__(self, assets, gids):
        self.pictures = Pictures(assets, gids)
        self.digits = quickbar.QuickBar(assets)
        self.known = {}                 # a slot's picture, as bytes: its name (or None), not worked out twice
        self.counted = {}               # the same for a slot's number

    def slots(self, bgr, box):
        """(tab, [[slot, ...] per row]) with each slot "empty", or (name, how many), or None if it isn't clear. None if no tab
        with counts is open."""
        s = box[2] / BOX_W
        tab = _pink_tab(bgr, box, s)
        if tab not in TAB_ITEMS:
            return None
        x0, y0 = box[0] + SLOT_X * s, box[1] + SLOT_Y * s
        rows = []
        for r in range(ROWS):
            row = []
            for c in range(COLS):
                x, y = int(round(x0 + c * PITCH_X * s)), int(round(y0 + r * PITCH_Y * s))
                row.append(self._slot(bgr, tab, x, y, s))
            rows.append(row)
        return tab, rows

    def _slot(self, bgr, tab, x, y, s):
        if x < 0 or y < 0:
            return None
        w, h = int(round(SLOT_W * s)), int(round(SLOT_H * s))
        pad = int(round(SLOT_PAD * s))
        pic = bgr[max(0, y - pad):y + h + pad, max(0, x - pad):x + w + pad]
        if pic.shape[0] < h or pic.shape[1] < w:
            return None
        if s != 1.0:
            pic = cv2.resize(pic, None, fx=1 / s, fy=1 / s, interpolation=cv2.INTER_CUBIC)
        inside = pic[SLOT_PAD:SLOT_PAD + SLOT_H, SLOT_PAD:SLOT_PAD + SLOT_W]
        if float(inside.std()) < EMPTY:
            return "empty"
        top = pic[:int(SLOT_H * 0.5)].tobytes()
        if top not in self.known:
            if len(self.known) > 2000:
                self.known.clear()
            self.known[top] = self.pictures.name(tab, pic)
        name = self.known[top]
        count = self._count(bgr, x, y, s)
        return (name, count) if name and count is not None else None

    def _count(self, bgr, x, y, s):
        band = bgr[y + int(COUNT_TOP * s):y + int((COUNT_TOP + COUNT_H) * s), max(0, x + int(COUNT_LEFT * s)):x + int((COUNT_LEFT + COUNT_W) * s)]
        key = band.tobytes()
        if key not in self.counted:
            if len(self.counted) > 2000:
                self.counted.clear()
            big = cv2.resize(band, None, fx=quickbar.COUNT_FX / s, fy=quickbar.COUNT_FX / s, interpolation=cv2.INTER_CUBIC)
            self.counted[key] = self.read_count(big)
        return self.counted[key]

    def read_count(self, band):
        """The number in a slot, from wherever its digits fit best. (Unlike on the quick bar, the item's picture can be right behind
        them, so a dark part after the number doesn't mean a digit wasn't read.)"""
        ink = quickbar.soft_ink(band)
        shapes = self.digits.shapes
        best_text, best_fit = None, 0.0
        for row in range(10, 17):
            for start in quickbar.STARTS:
                pos, text, total = start, "", 0.0
                while len(text) < 5:
                    ranked = sorted(((max(quickbar.fit_at(ink, t, x, row) for x in range(pos - 1, pos + 2)), d) for d, t in shapes.items()), reverse=True)
                    score, digit = ranked[0]
                    if score < DIGIT_OK:
                        if text and score >= DIGIT_UNCLEAR:
                            text = ""                   # (it might have more digits: better not to say)
                        break
                    at = max(range(pos - 1, pos + 2), key=lambda x: quickbar.fit_at(ink, shapes[digit], x, row))
                    text, total, pos = text + digit, total + score, at + quickbar.step_of(digit)
                if total > best_fit:                    # (where it fits best says, even if that's "not clear")
                    best_text, best_fit = text, total
        return int(best_text) if best_text and best_text[0] != "0" else None


class TabRows:
    """One tab's rows as far as they've been seen, put together however it's been scrolled."""

    def __init__(self):
        self.rows = []

    def add(self, seen):
        """A look at the rows showing (slots as InventoryReader gives them). Returns the items now in slots known to have been free."""
        at, fresh = self._where(seen), set()
        for k, row in enumerate(seen):
            if at + k >= len(self.rows):
                self.rows.append(list(row))
            else:
                fresh |= {new[0] for new, old in zip(row, self.rows[at + k]) if old == "empty" and new not in (None, "empty")}
                self.rows[at + k] = [new if new is not None else old for new, old in zip(row, self.rows[at + k])]
        return fresh

    def _where(self, seen):
        """Which of the rows known the first row showing is: where most of the slots have the same items."""
        best, best_score = len(self.rows), 0
        for at in range(len(self.rows)):
            pairs = [(a, b) for row, old in zip(seen, self.rows[at:]) for a, b in zip(row, old) if a not in (None, "empty") and b not in (None, "empty")]
            same = sum(a[0] == b[0] for a, b in pairs)
            if same and same >= 0.6 * len(pairs) and same > best_score:
                best, best_score = at, same
        return best

    def totals(self):
        """{item: how many}, added up over its stacks."""
        out = {}
        for row in self.rows:
            for slot in row:
                if slot not in (None, "empty"):
                    out[slot[0]] = out.get(slot[0], 0) + slot[1]
        return out


class InventoryCheck:
    """What each item's count has done since the tracker first saw it, against what the lines read."""

    def __init__(self):
        self.lock = threading.Lock()
        self.clear()

    def clear(self):
        self.tabs = {}
        self.start = {}                 # item: its first count (0 if it came into a slot that was seen free)
        self.now = {}
        self.tab_of = {}
        self.maybe = {}                 # tab: the last look at its slots

    def look(self, tab, rows):
        """A look at a tab's slots. A look only counts when the next says the same, so a window being dragged or a tooltip
        over a slot doesn't."""
        with self.lock:
            last, self.maybe[tab] = self.maybe.get(tab), rows
            if last != rows:
                return
            book = self.tabs.setdefault(tab, TabRows())
            fresh = book.add(rows)
            totals = book.totals()
            for name, count in totals.items():
                if name not in self.start:
                    self.start[name] = 0 if name in fresh else count
                self.now[name] = count
                self.tab_of[name] = tab
            for name in list(self.now):
                if self.tab_of.get(name) == tab and name not in totals:
                    self.now[name] = 0

    def rows(self, lines, sold=None, bought=None):
        """[(item, tab, had, has now, gained, lines read, share)] for items that changed or that lines were read for: gained is what the
        inventory says came in, net of what's been traded at shops. share is None with nothing to compare. lines: {item: how many}."""
        sold, bought = sold or {}, bought or {}
        out = []
        with self.lock:
            for name in sorted(self.start, key=lambda n: (self.tab_of.get(n, ""), n)):
                gained = self.now[name] - self.start[name] + sold.get(name, 0) - bought.get(name, 0)
                read = lines.get(name, 0)
                if gained or read:
                    out.append((name, self.tab_of[name], self.start[name], self.now[name], gained, read, read / gained if gained > 0 else None))
        return out

    def summary(self, lines, sold=None, bought=None):
        """One line: how many items came in, and how many of them the lines read."""
        pairs = [(r[4], r[5]) for r in self.rows(lines, sold, bought) if r[4] > 0]
        got = sum(g for g, _ in pairs)
        if not got:
            return "Items against your inventory: open a tab now and again later to compare."
        caught = sum(min(g, r) for g, r in pairs)
        over = sum(max(0, r - g) for g, r in pairs)
        extra = f", and {over:,} too many" if over else ""
        return f"Items against your inventory: read {caught:,} of {got:,} ({caught / got:.0%}){extra}"
