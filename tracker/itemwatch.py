"""Reads item pickup lines by the game's font, and names the item from the game's item list.

Picking an item up prints a white line in the message stack: "Lupin's Banana x1 earned. (Etc)", the
name cut short with "..." when it's long ("Green Mushroo... x1 earned. (Etc)"). The end of the line
is drawn the same way every time, so it's read by the shapes of its pieces (assets/item_font.npz):
the inventory tab in brackets, "earned.", the count, and the "x" before it. That leaves the name.

An item is known by the picture of its name once it's been seen: the drops of the maps the overlay
was made in come with it, and the first time any other item comes in, Tesseract reads its name and
it's matched to the closest name in the game's item list (assets/items.txt, from meowdb.com) on that
tab (by its start, when it's cut short). Its picture is kept in the data folder, so from then on it's
known by sight. A name that matches nothing in the list closely enough is left out: a missed pickup
is better than a wrong one.

Sizes are 4K pixels (gh 20), like msgwatch.py's; at other sizes everything is scaled by gh / 20.
"""
import difflib
import re
from collections import Counter
from pathlib import Path

import cv2
import numpy as np

import msgwatch as mw
from pickwatch import line_pictures, read_line as tesseract_line

GH0 = 20.0
TAB_GAP = 13                # px between "earned." and the tab's "("
DIGIT_GAP = 10              # px between the count's last digit cell and "earned."
PAD = 2                     # px of room kept around each shape in item_font.npz
TAIL_OK = 0.6               # how alike the tab and "earned." must look to their shapes
X_OK = 0.45                 # ...and the "x" (small: it looks less alike)
DIGIT_OK = 0.55             # ...and each digit of the count
NAME_OK, NAME_MARGIN = 0.8, 0.05    # a name's picture: how alike, and how much more than any other's
NAME_SLACK = 6              # px a name's end may be off from where it's looked for
LIFT = 6                    # px a line may sit higher or lower than its row's middle (caught moving up)
NAME_GAP = 30               # px between two words of a name, at most (more: something else)
DOTS_OK = 0.7               # the "..." at the end of a name cut short
MATCH_OK, MATCH_MARGIN = 0.75, 0.05  # Tesseract's reading against the item list: how close, how much closer
LIKELY_OK = 0.6             # ...against what this map's monsters are known to drop: so few, it can be less close
MIN_CHAR_W = 9              # a name in a picture (at 4K) is at least this wide per letter ("Leaf" is the narrowest yet: 11)
LEFT_CLEAR = 30             # px clear of letters left of a name, more than a word's gap: "Iron Ore" isn't the end of "Silver Ore"
LEARN_OK = 0.85              # Tesseract's reading against the item list, to keep a picture of it as that name
LEFT_TOUCH = 4              # ...not counting right next to it: a picture can start a little inside its first letter
LEFT_SAME = 6               # px a name's picture may start from where its line does, to be kept
KEEP = 3                    # pictures kept of each name (from different lines)
SAME_LINE = 0.7             # how alike two lines must look (ending at the same spot) to say the same thing
STILL_BRIGHT = 0.6          # seconds a line stays as bright as a new one could read


def _white(band):
    """Only what's white: the lowest of blue, green and red. Orange rock behind the line, and yellow letters, go dark."""
    least = band.min(axis=2)
    return cv2.merge([least, least, least])


def norm(name):
    """A name for comparing: lower case, letters, digits and apostrophes, single spaces."""
    return " ".join(re.sub(r"[^a-z0-9' ]", " ", name.lower()).split())


def load_items(path):
    """The game's item list (items.txt: tab, a tab character, the name): {tab: [names]}."""
    items = {}
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        tab, _, name = line.partition("\t")
        if name:
            items.setdefault(tab, []).append(name)
    return items


def match_name(raw, tab, items, cut, ok=MATCH_OK):
    """The item a name read by Tesseract is (raw: as read; cut: it ends in "...", so only its start
    is shown), from the names on its tab, or None if none is clearly closest."""
    key = norm(raw)
    if len(key) < 3:
        return None
    scored = []
    for name in items.get(tab, []):
        n = norm(name)
        if cut:
            if len(n) <= len(key):
                continue                        # (cut short: the name is longer than what's shown)
            n = n[:len(key)]
        scored.append((difflib.SequenceMatcher(None, key, n).ratio(), name, n))
    if not scored:
        return None
    scored.sort(reverse=True)
    best, name, shown = scored[0]
    # (Names that look the same as shown, "Arrows for Bows" and "Arrows for Bows x", can't be told
    # apart: they count as a runner-up.)
    second = max((s for s, nm, sh in scored[1:] if nm != name and nm != name + " x" and name != nm + " x"), default=0.0)
    return name if best >= ok and best - second >= MATCH_MARGIN else None


def _whole_picture(name, pic):
    """Is this picture wide enough to be this whole name? Just "Ore" got kept as Iron Ore, so every ore read as Iron Ore."""
    return pic.ndim == 2 and pic.shape[1] >= MIN_CHAR_W * len(name)


def closeness(raw, name):
    """How close Tesseract's reading is to a name, 0..1."""
    return difflib.SequenceMatcher(None, norm(raw), norm(name)).ratio()


class ItemReader:
    """Reads item lines: read() for one line's picture."""

    def __init__(self, assets, learned=None):
        data = np.load(str(Path(assets) / "item_font.npz"))
        self.tabs = {k[2:]: data[k].astype(np.float32) for k in data.files if k.startswith("t_")}
        self.earned = data["earned"].astype(np.float32)
        self.x = data["x"].astype(np.float32)
        self.dots = data["dots"].astype(np.float32)
        self.chars = {c: t for c, t in mw.Font(assets).chars.items() if c.isdigit()}
        self.items = load_items(Path(assets) / "items.txt")
        self.names = []                         # [name, tab, picture (4K)]: the names known by sight
        self._load(data, "n")
        self.learned_path = Path(learned) if learned else None
        self.learned = 0                        # how many of self.names were learned here (they're at the end)
        if self.learned_path and self.learned_path.is_file():
            try:
                before = len(self.names)
                self._load(np.load(str(self.learned_path)), "n")
                self.learned = len(self.names) - before
            except Exception:
                pass
        self._scaled = {}
        self.likely = None                      # what this map's monsters are known to drop, if the map's known: a set of names
        self.likely_items = {}                  # ...as self.items: {tab: [names]}
        self.counted = []                       # (name, when it came in), of the lines read lately

    def set_likely(self, names):
        """Tells it what can drop here. A poor look at a name can only be one of these."""
        self.likely = set(names) if names else None
        self.likely_items = {tab: [n for n in got if n in self.likely] for tab, got in self.items.items()} if self.likely else {}

    def _load(self, data, prefix):
        if f"{prefix}_names" not in data.files:
            return
        for k, (name, tab) in enumerate(zip(data[f"{prefix}_names"], data[f"{prefix}_tabs"])):
            if _whole_picture(str(name), data[f"{prefix}{k}"]):
                self.names.append([str(name), str(tab), data[f"{prefix}{k}"].astype(np.float32)])

    def _save(self):
        if not self.learned_path:
            return
        mine = self.names[len(self.names) - self.learned:]
        arrays = {"n_names": np.array([n for n, _, _ in mine]), "n_tabs": np.array([t for _, t, _ in mine])}
        arrays.update({f"n{k}": pic for k, (_, _, pic) in enumerate(mine)})
        try:
            self.learned_path.parent.mkdir(parents=True, exist_ok=True)
            np.savez_compressed(str(self.learned_path), **arrays)
        except Exception:
            pass

    def _at(self, s):
        """The shapes at scale s."""
        if s not in self._scaled:
            def sz(t):
                return cv2.resize(t, (max(1, round(t.shape[1] * s)), max(1, round(t.shape[0] * s))),
                                  interpolation=cv2.INTER_AREA)
            self._scaled[s] = ({k: sz(t) for k, t in self.tabs.items()}, sz(self.earned), sz(self.x), sz(self.dots),
                               {c: sz(t) for c, t in self.chars.items()})
        return self._scaled[s]

    @staticmethod
    def _find(F, t, x0, x1):
        """Where shape t fits best in F between x0 and x1 (its left edge), and how well: (score, x)."""
        x0, x1 = max(0, int(x0)), min(F.shape[1], int(x1))
        area = F[:, x0:x1]
        if area.shape[0] < t.shape[0] or area.shape[1] < t.shape[1]:
            return -1.0, x0
        _, score, _, at = cv2.minMaxLoc(cv2.matchTemplate(area, t, cv2.TM_CCOEFF_NORMED))
        return float(score), x0 + at[0]

    def is_line(self, band, right, s):
        """Does this row, ending at right, look like an item line?"""
        white = _white(band)
        return self.tail(mw.feature(white, s), right, s) is not None or self.tail(mw.strokes(white, s), right, s) is not None

    def tail(self, F, right, s):
        """The end of an item line (F: its feature picture, right: where it ends): (tab, count, where
        the name ends, whether it's cut short), or None if it isn't an item line or isn't clear."""
        tabs, earned, x, dots, chars = self._at(s)
        F = np.pad(F, ((int(LIFT * s), int(LIFT * s)), (0, 0)))
        p = PAD * s
        ranked = sorted(((*self._find(F, t, right - t.shape[1] - 4 * s, right + 6 * s), k) for k, t in tabs.items()),
                        reverse=True)
        score, tx, tab = ranked[0]
        if score < TAIL_OK or (len(ranked) > 1 and score - ranked[1][0] < 0.05):
            return None
        want = tx + p - TAB_GAP * s - (earned.shape[1] - 2 * p) - p
        score, ex = self._find(F, earned, want - 8 * s, want + earned.shape[1] + 8 * s)
        if score < TAIL_OK:
            return None
        # The count, right to left from just before "earned.", then the "x" before it.
        x1, digits = ex + p - DIGIT_GAP * s, ""
        h, w = chars["0"].shape
        for k in range(5):
            slack = 8 * s if k == 0 else 1
            got = sorted(((*self._find(F, t, x1 - w - slack, x1 + slack + 1), c) for c, t in chars.items()), reverse=True)
            if got[0][0] < DIGIT_OK:
                break
            digits, x1 = got[0][2] + digits, got[0][1]
        if not digits or digits[0] == "0":
            return None
        score, xx = self._find(F, x, x1 - x.shape[1] - 4 * s, x1 + 2 * s)
        if score < X_OK:
            return None                         # (no "x": it was something over the line, not its count)
        # The name ends at the last letter before the "x".
        cols = np.nonzero(F[:, :max(0, int(xx + p - 4 * s))].max(axis=0) > 0.3)[0]
        if not cols.size:
            return None
        name_right = int(cols[-1]) + 1
        cut, _ = self._find(F, dots, name_right - dots.shape[1] - 2 * s, name_right + 3 * s)
        return tab, int(digits), name_right, cut >= DOTS_OK

    @staticmethod
    def name_left(F, right, s):
        """Where a name ending at right starts: its letters, with gaps no wider than a space."""
        ink = (F > 0.3).sum(axis=0) >= 2
        x, gap = int(right) - 1, 0
        left = x
        while x >= 0 and gap <= NAME_GAP * s:
            if ink[x]:
                left, gap = x, 0
            else:
                gap += 1
            x -= 1
        return left

    def _picture(self, F, left, right, s):
        """A name's picture, at 4K size."""
        pic = F[:, max(0, int(left)):int(right)]
        if s != 1.0 and pic.size:
            pic = cv2.resize(pic, (max(1, round(pic.shape[1] / s)), max(1, round(pic.shape[0] / s))),
                             interpolation=cv2.INTER_LINEAR)
        return pic

    def known(self, F, name_right, tab, s):
        """The name ending at name_right in F, from the names known by sight (on that tab), or None. Each
        is compared by its picture lined up on the name's end (where it starts isn't as sure: there
        can be scenery just left of a line)."""
        scores = {}
        G = self._picture(np.pad(F, ((int(LIFT * s), int(LIFT * s)), (0, 0))), 0, name_right + NAME_SLACK * s, s)
        end = G.shape[1]
        for name, t, ref in self.names:
            if t != tab:
                continue
            core = ref[2:-2, 2:-2]
            x0 = max(0, end - core.shape[1] - 2 * NAME_SLACK - 2)
            area = G[:, x0:end]
            if not core.size or core.shape[0] > area.shape[0] or core.shape[1] > area.shape[1]:
                continue
            _, score, _, at = cv2.minMaxLoc(cv2.matchTemplate(area, core, cv2.TM_CCOEFF_NORMED))
            # (It's lined up on the name's end, so a short name fits the end of a longer one. More letters to its left: not this name.)
            start = x0 + at[0] - 2
            if ((G[:, max(0, start - LEFT_CLEAR):max(0, start - LEFT_TOUCH)] > 0.3).sum(axis=0) >= 2).any():
                score = -1.0
            scores[name] = max(scores.get(name, -1.0), float(score))
        if not scores:
            return None
        ranked = sorted(scores.items(), key=lambda kv: -kv[1])
        best, score = ranked[0]
        second = ranked[1][1] if len(ranked) > 1 else -1.0
        return best if score >= NAME_OK and score - second >= NAME_MARGIN else None

    def read_name(self, band, span, name_right, tab, cut, s, read_lines):
        """A name, by Tesseract, when the end of its line is already known: just the name is read, a few ways, and each reading
        is matched to the item list. (Read with the rest of the line, a misread bracket lost clean lines.) (name, closeness), or None."""
        pad = int(0.3 * GH0 * s)
        texts = [" ".join(t.split()) for t in read_lines(line_pictures(band, (band.shape[0] / 2, span[0], max(span[0] + 1, name_right - pad), None), GH0 * s))]
        votes, close = Counter(), {}
        for lists, ok in ((self.items, MATCH_OK), (self.likely_items, LIKELY_OK)):      # (the whole list first)
            for t in texts:
                shown = cut or ".." in t
                name = match_name(t, tab, lists, shown, ok) or (match_name(t, tab, lists, True, ok) if not shown and lists is self.items else None)
                if name:
                    votes[name] += 1
                    n = norm(name)
                    close[name] = max(close.get(name, 0.0), closeness(t, n[:len(norm(t))] if shown else n))
            if votes:
                break
        ranked = votes.most_common(2)
        if not ranked or ranked[0][1] < 2 or (len(ranked) > 1 and ranked[0][1] == ranked[1][1]):
            return None
        return ranked[0][0], close[ranked[0][0]]

    def learn(self, name, tab, pic):
        """Keeps a picture of a name, to know it by sight from now on (up to KEEP of each)."""
        if not _whole_picture(name, pic) or sum(1 for n, t, _ in self.names if n == name and t == tab) >= KEEP:
            return
        self.names.append([name, tab, pic.astype(np.float32)])
        self.learned += 1
        self._save()

    def _end(self, band, span, s):
        """The end of the line in this picture (tail()), however it's seen best."""
        white = _white(band)
        return self.tail(mw.feature(white, s), span[1], s) or self.tail(mw.strokes(white, s), span[1], s)

    def read_line(self, line, s, read_lines=None):
        """What a msgwatch.Line says (see _read_line). ("again", name): the same line seen again, and not another pickup. Moving scenery can make the
        stack look moved, or hide a line for a look or two. Then a dim line "comes in" just after one of that name, with no more lines of that name on
        screen than there were lately. Or a bright one does, so soon after the other that it could still be as bright as that, and the other isn't
        where it should be now. (What's picked up often comes in runs of the same thing, so a bright one needs that much.)"""
        got = self._read_line(line, s, read_lines)
        if got and got[0] == "item":
            self.counted = [c for c in self.counted if 0 <= line.born - c[1] < mw.LASTS]
            same = [when for name, when in self.counted if name == got[1]]
            if same and line.fresh and line.left_place and line.born - max(same) <= STILL_BRIGHT:
                return ("again", got[1])
            if same and not line.fresh and line.stack and line.pictures:
                ref = line.pictures[0]
                if self._alike_lines(ref, line.stack[0], s) <= max((self._alike_lines(ref, look, s) for look in line.stack[1]), default=0):
                    return ("again", got[1])
            self.counted.append((got[1], line.born))
        return got

    @staticmethod
    def _alike_lines(ref, others, s):
        """How many of these lines look like this one: lined up on their ends, which are all at the same spot, as far along as this one goes."""
        band, span = ref
        white = _white(band)
        n = 0
        a = int(round(2 * s))
        for other, sp in others:
            best = -1.0
            for look in (mw.feature, mw.strokes):
                t = look(white, s)[a:-a or None, max(0, span[0]):span[1]]
                o = look(_white(other), s)[:, max(0, span[0] - a):min(other.shape[1], span[1] + a)]
                if t.max() > 0 and o.max() > 0 and t.shape[0] <= o.shape[0] and t.shape[1] <= o.shape[1]:
                    best = max(best, float(cv2.matchTemplate(o, t, cv2.TM_CCOEFF_NORMED).max()))
            n += best >= SAME_LINE
        return n

    def _read_line(self, line, s, read_lines=None):
        """What a msgwatch.Line says, from any of the pictures of it: by sight first, as that's quick and certain. Only
        then Tesseract, on the pictures one after another."""
        pictures = line.pictures or [(line.band, line.span)]
        # (If the stack's move was misjudged, a later picture can be of the next line along: its tab or count gives that away.)
        ends = [self._end(band, span, s) for band, span in pictures]
        first = next((e for e in ends if e), None)
        if first:
            pictures = [p for p, e in zip(pictures, ends) if e and e[:2] == first[:2]]
        for band, span in pictures:
            got = self.read(band, span, s)
            if got:
                return got
        if read_lines is not None:
            for band, span in pictures:
                got = self.read(band, span, s, read_lines)
                if got:
                    return got
        return None

    def read(self, band, span, s, read_lines=None):
        """What a white line with no amount the font knows says: ("item", name, count, tab), ("mesos",
        amount) (a mesos line the font couldn't read: Tesseract can), or None. band: the line's row
        (msgwatch's band: its middle half way down); span: where the line starts and ends in it (x).
        read_lines: Tesseract, for a name not known by sight yet (left out without it), and for a
        line whose end isn't clear (a tab with no shape here yet, like "(Setup)")."""
        F = mw.feature(_white(band), s)
        end = self.tail(F, span[1], s)
        G = mw.strokes(_white(band), s)     # (the same, for pale scenery that hides the letters' shadow)
        if end is None:
            end = self.tail(G, span[1], s)
        if end is None:
            got = tesseract_line(band, span, GH0 * s, read_lines) if read_lines is not None else None
            if got and got[0] == "item":
                # (The whole list first: "Silver Ore" is close enough to Iron Ore, if that's all that's listed here.)
                name = (match_name(got[1], got[3], self.items, False) or match_name(got[1], got[3], self.items, True)
                        or match_name(got[1], got[3], self.likely_items, False, LIKELY_OK))
                return ("item", name, got[2] or 1, got[3]) if name else None
            return got
        tab, qty, name_right, cut = end
        name = self.known(F, name_right, tab, s)
        if name is None:
            poor = self.known(G, name_right, tab, s)
            name = poor if poor and (self.likely is None or poor in self.likely) else None
        if name is None and read_lines is not None:
            left = self.name_left(F, name_right, s)
            got = self.read_name(band, span, name_right, tab, cut, s, read_lines)
            if got:
                name = got[0]
                if got[1] >= LEARN_OK and abs(left - span[0]) <= LEFT_SAME * s:
                    self.learn(name, tab, self._picture(F, left, name_right, s))
        return ("item", name, qty, tab) if name else None
