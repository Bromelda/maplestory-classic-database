"""Reading the game's chat box, for the Chat window: buddy chat kept apart from party, general chat and speakers.

The chat box sits at the bottom, just above the status bar, lined up with its left end. The status bar is in the middle of the
window, so everything here is measured from the window's middle, in pixels of a 1440-tall game, and scaled to its height.
Closed, the box is one grey line showing the latest message; opened, it's many lines over a see-through dark backdrop.

What a line is comes from how the game draws it (the owner's own account of it, checked on real clips where there were any):
- white letters: general chat, from people on the map and channel you're on
- yellow letters: notices from the game ("[Notice] ..."), kept with general chat
- pink letters, with no block of colour behind: party chat (and the party's own news, in a pale orange: "'jine' has joined the party.")
- bright orange letters: buddy chat (on the owner's screenshot: 210, 151, 61 in red, green, blue)
- green: whispers, in the classic game: not seen in this game yet, so they go with buddy chat
- speakers (megaphones), to the whole world: dark letters on a block of colour (yellow, light blue, pink, red) in the open
  box, and dark coloured letters on the grey bar when it's closed
- a speaker's block says which channel it came from on a little badge after the name ("CH01"): it's read, with the block's
  colour, so the Chat window can show both
- someone opening something special from a box ("Painted obtained [Chocolate Ribbon] from the Aurora Mystery Fashion
  Crate!"): light letters on a red block
- buddies' names have "()" after them: "Remoneide() : LOL"
- any other colour (light blue letters, say: maybe group chat) is "other"

A line's letters are the pixels that stand out from what's around them, and every line starts at the same spot on the left.
What's behind a line tells it from scenery: the grey bar, the box's dark backdrop, or a speaker's block of colour, all even.

Lines come quickly where people sell things (one every quarter of a second), and Tesseract takes about a tenth of a second
to start, so the two are kept apart: look() is quick, and only notes the lines it hasn't read yet; read() reads them, all
at once, buddy lines first. A line's picture is remembered with what it says, so a line seen again, or moving up the open
box, isn't read again. The same line is never added twice: one read already (even a little differently) is left out.

It only ever reads a picture of the screen. What it reads stays on this computer, in memory: it's gone when the tracker closes.
"""
import bisect
import difflib
import re
import threading
import time
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

REF_H = 1440.0
LEFT, RIGHT = -780, 300         # the part of the window looked at, from its middle (x)
BOTTOM_UP = 70                  # ...from above the status bar (the window's bottom less this)...
TALL = 620                      # ...to this far up (an opened box)
TEXT_X = -726                   # where every chat line starts, from the window's middle (closed: -718, open: -733)
TEXT_NEAR = 14                  # ...give or take this
LOOK_W = 700                    # how much of a line, from where it starts, says what it is
TEXT_W = 960                    # how long a line can be (past it: the closed bar's + button, the open box's scroll bar)
CLOSED = (42, 14)               # the closed box's line: its letters, this far up from the bottom of the area (top, bottom)
OPEN = (85, 61)                 # the open box's bottom line (the box sits on the bar you type in)...
BAR_X = (200, 600)              # where to look at the bar (from where lines start) to tell open from closed
GREY_BAR = 115                  # the closed box's bar (107 to 121)
GRID_SLACK = 6                  # ...give or take this, found from the bottom lines (the open box has more than these:
GRID_LINES = 6                  # above them may be scenery)
END_GAP = 40                    # a gap this wide in a line is past its end (between words: 8; either side of the ":", 25 or so)
PATCHY = 41                     # what's behind a chat line, past its letters, varies less than this
OPEN_K = 7                      # wider than a letter's stroke, for what's around it
NAME_W = 110                    # the first part of a line, with the name: its letters' colour says what kind of line it is
PITCH = 30.25                   # ...and each next one up is this much higher. Lines there touch, so they're found by where they are
INK = 60                        # a letter's pixel stands out this much (all three colours added) from what's around it
FILLED = 0.04                   # a line's letters are at least this much of its first LOOK_W pixels (scenery's edges: 3% at most)
BACKDROP = 160                  # behind a chat line it's darker than this: the grey bar (120), the open box's dark backdrop (50 to 95)
EVEN = 60                       # ...and even: scenery behind the open box shows through it, but darkened (spread 55 at most)
BLOCK, BLOCK_EVEN = 170, 13     # a speaker's block of colour: lighter than this (210 up), and most of it very even (the middle half
                                # within 12 on real clips; pale scenery above the open box, 15 up)
RED_BLOCK = (165, 40, 90)       # a box's red block: brighter than the open box's backdrop, its pattern varying less than this,
                                # and this coloured (its pattern stands out like letters, dark ones: its light letters are read)
SOLID = 12                      # the closed box's grey bar is this even (2): nothing shows through it
LIGHTER, DARKER = 40, 15        # letters lighter than what's behind them by this are chat; darker by this, a speaker
GREY_SAT = 60                   # letters less coloured than this are white
BRIGHT_SAT = 140                # buddy chat's orange is bright: the party's "has joined the party" lines are a paler one (74)
NEAR_COLOUR = 70                # a pixel this far from the letters' colour is only half part of them, for reading
SAME = 0.82                     # how alike two readings have to be to be the same line...
SAME_NEAR, NEAR_S = 0.7, 30     # ...or this alike, the same person within this many seconds
SAME_WORDS = 0.9                # ...or this alike, within those seconds, whatever the name was read as
REMEMBER_S = 15 * 60            # a line's left out if the same was seen this recently
SHAPES = 600                    # line pictures remembered, with what they say
WAITING = 60                    # lines waiting to be read, at most (the oldest unread are let go past that)
BATCH = 16                      # lines read in one go
NAME_SAME = 0.7                 # a name read this like one read before is that person's (xeyna, meyna, Xeyha: Xeyna)
CAPITAL_SHARE = 0.15            # a name read with a capital this much of the time is shown with one (Xeyna: 24%, its X read as x)
RECENT_LINES = 400              # how far back a line read again is looked for, by what it says
SETTLE_S, SETTLE_LOOKS = 1.0, 3 # a new line's told of (the bell) once it's been seen 3 times, or twice over this long
ONCE_S = 2.0                    # a line seen once, and not again in this long, wasn't one
SCENERY_S = 2.0                 # a place where what looked like a line read as nonsense is left alone this long

KINDS = ("buddy", "whisper", "party", "general", "notice", "speaker", "box", "guild", "other")
TABS = (("Buddy", ("buddy", "whisper")), ("Party", ("party",)), ("General", ("general", "notice")),
        ("Speakers", ("speaker",)), ("Other", ("box", "guild", "other")))
FIRST = ("buddy", "whisper", "party", "guild", "other", "general", "notice", "speaker", "box")     # which are read first

BADGE = Path(__file__).resolve().parent / "assets" / "chat_badge.npz"   # the badge's "CH" and digits (tools/make_chat_badge.py)
BADGE_FIND = 0.8                # how like the badge's "CH" a spot has to be, to be one
BADGE_DX = (16, 25)             # where its two digits are, right of where the "CH" starts (in a 1440-tall game)
BADGE_SEARCH = 330              # how far right of where a line starts the badge can be (a long name, then the badge)
DIGIT_OK, DIGIT_MARGIN = 0.85, 0.02     # how like a digit's shape, and how much more than like any other, to be read as it


def area(rect):
    """The part of the screen with the chat box: (x, y, w, h), for the game window's (x, y, w, h)."""
    wx, wy, ww, wh = rect
    s = wh / REF_H
    mid = wx + ww / 2
    x0, x1 = max(wx, int(mid + LEFT * s)), min(wx + ww, int(mid + RIGHT * s))
    y1 = int(wy + wh - BOTTOM_UP * s)
    y0 = max(wy, int(y1 - TALL * s))
    return x0, y0, x1 - x0, y1 - y0


def text_x(rect):
    """Where chat lines start, in a picture of area(rect)."""
    wx, _, ww, wh = rect
    return int(wx + ww / 2 + TEXT_X * wh / REF_H) - area(rect)[0]


def kind_of(bgr):
    """What kind of chat line has light letters this colour (b, g, r)."""
    hsv = cv2.cvtColor(np.uint8([[bgr]]), cv2.COLOR_BGR2HSV)[0, 0]
    hue, sat = int(hsv[0]) * 2, int(hsv[1])
    if sat < GREY_SAT:
        return "general"
    if 48 <= hue < 72:
        return "notice"
    if 12 <= hue < 48:
        return "buddy" if sat >= BRIGHT_SAT else "party"     # ("'jine' has joined the party." is a pale orange)
    if 72 <= hue < 170:
        return "whisper"
    if 250 <= hue < 300:
        return "guild"
    if hue >= 300 or hue < 12:
        return "party"
    return "other"


@dataclass
class Row:
    top: int
    bottom: int
    kind: str
    colour: tuple               # its letters' colour (b, g, r)
    shape: np.ndarray = None    # its letters, small, to know it again
    mask: np.ndarray = None     # its letters, as they are, for reading: how much each pixel is a letter's, 0 to 1
    channel: str = ""           # a speaker's channel, from its badge ("01"; "1?" for a digit not known), or ""
    block: str = ""             # the colour of a speaker's block: "yellow", "blue", "pink", "red", or "grey" (the closed bar)


def ink(img, s):
    """The letters' pixels, light or dark: those that stand out from what's around them."""
    f = img.astype(np.float32)
    k = max(5, int(round(9 * s)) | 1)
    return np.abs(f - cv2.blur(f, (k, k))).sum(axis=2) >= INK


def box_state(img, s, x0):
    """"open" (the bar you type in shows, white, with the box's lines above it), "closed" (the grey bar with the latest line),
    or None (neither: no chat box to read)."""
    H = img.shape[0]
    bar = img[int(H - CLOSED[0] * s):int(H - CLOSED[1] * s), x0 + int(BAR_X[0] * s):x0 + int(BAR_X[1] * s)].astype(np.int16)
    if not bar.size:
        return None
    if float((bar.min(axis=2) >= 230).mean()) >= 0.6:
        return "open"
    # (Above and below its letters: a long line covers most of the bar, and the game greys it a little at times: 107 to 121)
    x = slice(x0 + int(BAR_X[0] * s), x0 + int(BAR_X[1] * s))
    edges = np.concatenate([img[int(H - (CLOSED[0] + 6) * s):int(H - (CLOSED[0] + 1) * s), x],
                            img[int(H - (CLOSED[1] - 3) * s):int(H - (CLOSED[1] - 8) * s), x]]).reshape(-1, 3).astype(np.int16)
    grey = (edges.max(axis=1) - edges.min(axis=1) <= 10) & (np.abs(edges.max(axis=1) - GREY_BAR) <= 18)
    if edges.size and float(grey.mean()) >= 0.7:
        return "closed"
    return None


def rows(img, s, x0):
    """The chat lines in a picture of the chat area, top to bottom, each with its kind. x0: where lines start in it."""
    on = ink(img, s)
    near = int(TEXT_NEAR * s)
    lo, hi = max(0, x0 - near), min(img.shape[1], x0 + int(LOOK_W * s))
    wide = on[:, lo:hi].sum(axis=1) > 0.9 * (hi - lo)                 # (the box's edges are lines right across: not letters)
    on[wide] = False
    V = img.max(axis=2)
    H, out = img.shape[0], []
    state = box_state(img, s, x0)
    if state is None:
        return []
    slots = [CLOSED] if state == "closed" else [(OPEN[0] + k * PITCH, OPEN[1] + k * PITCH) for k in range(int((TALL - OPEN[0]) / PITCH) + 1)]
    shift = _grid_shift(on[:, lo:hi].sum(axis=1), H, s, len(slots)) if state == "open" else 0
    for up0, up1 in reversed(slots):                                    # (top to bottom)
        y0, y1 = int(round(H - up0 * s)) - 2 + shift, int(round(H - up1 * s)) + 2 + shift
        if y0 < 0:
            continue
        band = on[y0:y1, lo:hi]
        if band.mean() < FILLED:
            continue
        pic, v = img[y0:y1, lo:hi], V[y0:y1, lo:hi].astype(np.int16)
        # What's behind it: the chat box's backdrop, or a speaker's block of colour. Anything else isn't a chat line.
        near_letters = cv2.dilate(band.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
        behind = v[~near_letters].astype(np.float32)
        if behind.size < 50:
            continue
        bg, spread = float(np.median(behind)), float(behind.std())
        q1, q3 = np.percentile(behind, (25, 75))
        block = bg >= BLOCK and (q3 - q1) <= BLOCK_EVEN                 # (most of it: a block can be a little shorter than its line)
        if not block and (behind >= BLOCK + 20).mean() >= 0.4:              # (or the line's a little off the grid: part of the
            lit = behind[behind >= BLOCK + 20]                              # block is behind it, part the box's backdrop)
            block = float(lit.std()) <= BLOCK_EVEN / 2
            bg = float(np.median(lit)) if block else bg
        boxed = False
        if not block and bg >= RED_BLOCK[0] and spread <= RED_BLOCK[1]:
            # (A red block with a pattern on it, light letters: someone opened something special from a box)
            hsv = cv2.cvtColor(np.uint8([[np.median(pic[~near_letters], axis=0)]]), cv2.COLOR_BGR2HSV)[0, 0]
            boxed = int(hsv[1]) >= RED_BLOCK[2] and block_colour(np.median(pic[~near_letters], axis=0)) == "red"
        if not block and not boxed and (bg > BACKDROP or spread > EVEN):
            continue
        if not block and not boxed:
            # (Scenery above the open box can look like a line, but what's behind its "letters" is patchy, where the box's
            # backdrop is even: real lines, 17 to 39; scenery, 42 up)
            k = max(3, int(round(OPEN_K * s)) | 1)
            if float(cv2.morphologyEx(v.astype(np.float32), cv2.MORPH_OPEN, np.ones((k, k), np.uint8)).std()) > PATCHY:
                continue
        light, dark = band & (v >= bg + LIGHTER), band & (v <= bg - DARKER)
        colour_behind = block_colour(np.median(pic[~near_letters], axis=0)) if block or boxed else "grey"
        if boxed or (block and colour_behind == "red" and light.sum() > dark.sum()):
            letters, kind = light, "box"                                # (light letters on a red block: something opened from
                                                                        # a box, told to everyone)
        elif block or (spread <= SOLID and dark.sum() > light.sum()):   # (dark letters on the closed box's solid grey bar: a
            letters, kind = dark, "speaker"                             # speaker too. Over the open box's see-through backdrop,
                                                                        # dark is only the scenery)
        else:
            letters, kind = light, None
        # A line of words: it starts where every line does, with many letters close together.
        cols = np.nonzero(letters.sum(axis=0) >= 2)[0]
        if not cols.size or int(cols[0]) + lo > x0 + near:
            continue
        start = np.zeros(int(200 * s) + 2, np.int8)
        first = cols[cols < cols[0] + int(200 * s)] - cols[0]
        start[first + 1] = 1
        if int((np.diff(start) == 1).sum()) < 6 or letters.sum() < 20:
            continue
        if kind is None:
            # Their colour, from the name at the start (every line has one, in its colour), and from the pixels that stand out
            # most there: scenery shows through the open box's backdrop, and orange rock behind "Xeyna : O" isn't buddy chat.
            name = letters.copy()
            name[:, cols[0] + int(NAME_W * s):] = False
            if name.sum() >= 20:
                sharp = (v - cv2.blur(v.astype(np.float32), (9, 9))).astype(np.float32)
                letters = name & (sharp >= np.percentile(sharp[name], 60))
        colour = tuple(int(c) for c in np.median(pic[letters], axis=0))
        kind = kind or kind_of(colour)
        # Its letters, the whole line's length, by how strongly each pixel has their colour (the backdrop and the scenery are
        # other colours), from where it starts. Soft edges read better than hard ones.
        full = img[y0:y1, lo + max(0, int(cols[0]) - 2):x0 + int(TEXT_W * s)].astype(np.float32)
        fv = full.max(axis=2)
        depth = max(8.0, abs(float(max(colour)) - bg))
        if kind == "speaker":
            # (A speaker's item names are lighter than its block, the rest darker: both are letters. Nothing shows through it.)
            mask = np.clip(np.abs(fv - bg) / depth, 0, 1)
        else:
            # (Against what's right around each letter: scenery shows through the open box's backdrop, paler in some places
            # than others, and a name over pale scenery came out faint. Letters are thin, so opening them away leaves that.)
            k = max(3, int(round(OPEN_K * s)) | 1)
            around = cv2.morphologyEx(fv, cv2.MORPH_OPEN, np.ones((k, k), np.uint8))
            off = np.abs(full - np.array(colour, np.float32)).max(axis=2)
            depth = max(8.0, float(max(colour)) - float(np.median(around)))
            mask = np.clip((fv - around) / (0.8 * depth), 0, 1) * np.clip(1.5 - off / NEAR_COLOUR, 0, 1)
        mask[:, (mask > 0.5).mean(axis=0) > 0.8] = 0                     # (a block's edge, or the box's: not a letter)
        mask[(mask > 0.5).mean(axis=1) > 0.6] = 0                       # (a block's top or bottom edge)
        xs = np.nonzero((mask > 0.5).sum(axis=0) >= 2)[0]
        if not xs.size:
            continue
        if kind != "speaker":                       # (the line ends at the first wide gap: past it, it's scenery showing through)
            faint = np.nonzero((mask > 0.25).sum(axis=0) >= 2)[0]      # (a thin ":" is faint, and the gaps either side of it wide)
            gaps = np.nonzero(np.diff(faint) > END_GAP * s)[0]
            xs = xs[xs <= faint[gaps[0]]] if gaps.size else xs
        mask = mask[:, :xs[-1] + 3]
        shape = cv2.resize(mask, (max(8, mask.shape[1] // 4), 8), interpolation=cv2.INTER_AREA)
        row = Row(y0, y1, kind, colour, shape, mask)
        if kind == "speaker":
            row.block, row.channel = colour_behind, channel(img, y0, y1, lo + int(cols[0]), s)
        elif kind == "box":
            row.block = colour_behind
        out.append(row)
    return out


def block_colour(bgr):
    """What colour a speaker's block is, by name, from its colour (b, g, r)."""
    hsv = cv2.cvtColor(np.uint8([[[int(c) for c in bgr]]]), cv2.COLOR_BGR2HSV)[0, 0]
    hue, sat = int(hsv[0]) * 2, int(hsv[1])
    if sat < 30:
        return "grey"
    if hue < 20 or hue >= 345:
        return "red"
    if hue < 75:
        return "yellow"
    if hue < 260:
        return "blue"
    return "pink"


_badge = []


def _badge_shapes():
    """The badge's "CH" and the digits' shapes ({"CH": ..., "0": ...}), {} if they're missing."""
    if not _badge:
        try:
            with np.load(str(BADGE)) as data:
                _badge.append({k: data[k].astype(np.float32) for k in data.files})
        except (OSError, ValueError):
            _badge.append({})
    return _badge[0]


def _badge_map(bgr):
    """The badge's red letters, as low values: green less half the red (the badge is white, the blocks yellow, pink, blue)."""
    f = bgr.astype(np.float32)
    return f[..., 1] - 0.5 * f[..., 2]


def channel(img, y0, y1, x_from, s):
    """The channel on a speaker's badge, after its name: "01" for "CH01", a digit whose shape isn't known yet as "?" (the
    digits known are those seen on the owner's screen so far). "" when there's no badge."""
    shapes = _badge_shapes()
    if "CH" not in shapes:
        return ""
    pad = int(round(6 * s))
    band = img[max(0, y0 - pad):y1 + pad, max(0, x_from):x_from + int(BADGE_SEARCH * s)]
    if not band.size:
        return ""
    if abs(s - 1.0) > 0.02:
        band = cv2.resize(band, None, fx=1 / s, fy=1 / s, interpolation=cv2.INTER_LINEAR)
    g = _badge_map(band)
    ch = shapes["CH"]
    h, w = ch.shape
    if g.shape[0] < h + 2 or g.shape[1] < w + BADGE_DX[1] + 12:
        return ""
    return read_badge(g, shapes)


def read_badge(g, shapes):
    """The channel on a badge in g (_badge_map() of a line, in a 1440-tall game), by the shapes ("CH", "0"...): see channel()."""
    ch = shapes["CH"]
    h, w = ch.shape
    _, score, _, (x, y) = cv2.minMaxLoc(cv2.matchTemplate(g, ch, cv2.TM_CCOEFF_NORMED))
    if score < BADGE_FIND:
        return ""
    digits = {k: t for k, t in shapes.items() if k != "CH"}
    out = ""
    for dx in BADGE_DX:
        spot = g[max(0, y - 2):y + h + 2, x + dx - 2:x + dx + 11]
        scores = sorted(((float(cv2.matchTemplate(spot, t, cv2.TM_CCOEFF_NORMED).max()), d) for d, t in digits.items()
                         if spot.shape[0] >= t.shape[0] and spot.shape[1] >= t.shape[1]), reverse=True)
        sure = scores and scores[0][0] >= DIGIT_OK and (len(scores) < 2 or scores[0][0] - scores[1][0] >= DIGIT_MARGIN)
        out += scores[0][1] if sure else "?"
    return out


def _grid_shift(count, H, s, n):
    """How far (up or down, a few pixels) the open box's lines are from where they're expected: the shift that puts the
    gaps between lines where there are fewest letters. (A screen a little off from the measured sizes, rounding.)"""
    def cost(o):
        ys = [int(round(H - (OPEN[0] + 1.5 + k * PITCH) * s)) + o for k in range(min(n, GRID_LINES))]
        return sum(int(count[max(0, y - 2):y + 3].sum()) for y in ys if 0 <= y < H)     # (the gap, a few rows)
    here = cost(0)
    best = min(range(-int(GRID_SLACK * s), int(GRID_SLACK * s) + 1), key=lambda o: (cost(o), abs(o)))
    return best if cost(best) < 0.5 * here else 0              # (only when the lines are clearly somewhere else)


def picture(mask, s):
    """A line's letters for Tesseract: dark on white, big, with a margin."""
    img = (255 * (1 - mask)).astype(np.uint8)
    k = 3.0 / max(s, 0.3)
    img = cv2.resize(img, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC)
    return cv2.copyMakeBorder(img, 20, 20, 20, 20, cv2.BORDER_CONSTANT, value=255)


def tidy(text):
    """A reading, without what the edges of a block or the box add to it."""
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"^[^A-Za-z0-9\['(]+", "", text)                  # (a block's left edge: "|", "\\")
    text = re.sub(r"(\s+[^\sA-Za-z0-9]{1,3})+$", "", text)          # (marks after the line's end)
    text = re.sub(r"\s+[|]\s*\w{0,2}$", "", text)
    return text.strip(" ,`\"_~|")


def split(text):
    """(who, what they said) from a chat line: "Name : hello", "Name>> hello" (a whisper) or "> Name : hello". Tesseract reads
    the ":" as ".", "|", ">", ";", "-", "=" or "°" at times, and a speaker's channel badge (CH21) after the name as a mark or two.
    A buddy's name has "()" after it: "Remoneide() : LOL" (read as "( )", "(]", "{}" at times)."""
    m = re.match(r"^\s*(?:>\s*)?[(']?([A-Za-z0-9_]{2,13})(?:\s?[(\[{]\s?[)\]}|lI1]?)?(?:\s*(?:>>|<<)|(?:\s+\S{1,6}){0,2}?\s*[:;.,>=|°·©*~-]+(?=\s))\s*(.+)$", text)
    if m:
        return m.group(1).strip(), re.sub(r"^\S{1,2}\s*[:;|]\s+", "", m.group(2).strip())     # (the rest of a badge: "9 : hi")
    return "", text


def words(text):
    """Does a reading look like words? Mostly letters and digits, with a word of three letters at least. (Scenery that looked
    like a line reads as marks.)"""
    shown = text.replace(" ", "")
    good = sum(c.isalnum() for c in shown)
    return good >= 4 and good >= 0.7 * len(shown) and re.search(r"[A-Za-z]{3}", text) is not None


def sentence(text):
    """Clearly words: three of three letters or more, and hardly any marks. Scenery read as letters is "ri? ee Sa die | Dun"."""
    shown = text.replace(" ", "")
    good = sum(c.isalnum() for c in shown)
    return good >= 0.85 * len(shown) and len(re.findall(r"[A-Za-z]{3,}", text)) >= 3


NEWS = re.compile(r"party|buddy|buddies|friend|guild|whisper|joined|left|logged|invit", re.I)


def is_line(kind, text):
    """Does a reading look like a chat line, and not scenery read as letters? Every line people type starts with a name; the
    game's own lines ("'jine' has joined the party.", "[Notice] ...") don't, and are clearly words about the party, a buddy..."""
    text = tidy(text)
    who, what = split(text)
    if who:
        return bool(re.search(r"[A-Za-z0-9]", what))                  # ("Mo : hi" is a line: a name, and anything)
    if re.match(r"^\W?N[oa]t[il]ce", text):
        return True
    if kind == "box" and sentence(text):                            # ("Painted obtained [Chocolate Ribbon] from the...")
        return True
    if kind == "notice" and sentence(text) and len(re.findall(r"[A-Za-z]{4,}", text)) >= 4:   # (a long notice's next line:
                                                                    # "yers. Please beware of scams...". Scenery: "TOS We a Eee")
        return True
    return kind not in ("general", "speaker") and sentence(text) and bool(NEWS.search(text))


def _key(text):
    return re.sub(r"[^a-z0-9]", "", text.lower())


def same_line(a, b, alike=SAME):
    """Could these two readings be the same line? Alike, or one the start of the other (a line read with part of it covered)."""
    a, b = _key(a), _key(b)
    if not a or not b:
        return False
    if a == b or difflib.SequenceMatcher(None, a, b).ratio() >= alike:
        return True
    short, long_ = sorted((a, b), key=len)
    if len(short) >= 5 and difflib.SequenceMatcher(None, short, long_[:len(short)]).ratio() >= SAME + 0.08:
        return True
    # (or the end of it: a speaker's channel badge, read as a mark or two before the words, or not)
    return len(short) >= 10 and difflib.SequenceMatcher(None, short, long_[-len(short):]).ratio() >= SAME + 0.08


def _shape_same(a, b):
    return a.shape == b.shape and float(np.abs(a - b).mean()) < 0.06


class Names:
    """Everyone whose name has been read: each person's spellings as Tesseract read them ("Xeyna", "xeyna", "meyna", "Xeyha"),
    and the one most of them say, which is the one shown."""

    def __init__(self):
        self.people = []                # Counter of spellings, one for each person

    def find(self, name):
        """The person (their number) a name read is, a new one if it's like nobody's."""
        best = self.match(name)
        if best is None:
            self.people.append(Counter())
            best = len(self.people) - 1
        self.people[best][name] += 1
        return best

    def match(self, name):
        """The person a name read is like, or None."""
        low = name.lower()
        best, score = None, NAME_SAME
        for i, spellings in enumerate(self.people):
            for known in spellings:
                r = 1.0 if known.lower() == low else difflib.SequenceMatcher(None, known.lower(), low).ratio()
                if r > score or (r == score == 1.0):
                    best, score = i, r
            if score == 1.0:
                break
        return best

    def shown(self, i):
        """How a person's name is shown: the spelling read most (letters only, whatever their case), capitalised if that's how
        it was read a fair part of the time (Tesseract reads a capital X as a small one more often than not)."""
        spellings = self.people[i]
        by_letters = Counter()
        for name, n in spellings.items():
            by_letters[name.lower()] += n
        low = by_letters.most_common(1)[0][0]
        same = {name: n for name, n in spellings.items() if name.lower() == low}
        best = max(same, key=same.get)
        capital = sum(n for name, n in same.items() if name[:1].isupper())
        if capital >= CAPITAL_SHARE * sum(same.values()):
            best = best[:1].upper() + best[1:] if best[:1].islower() else best
        return best


@dataclass
class Said:
    when: float                 # time.time() when it was first seen
    kinds: Counter              # what kind it was read as, at each look ("party" 12 times, "general" once)
    who: str                    # the name shown (Names.shown)
    text: str
    seen: float = 0.0           # time.monotonic() when last seen
    number: int = 0             # the order it was added in
    person: int = -1            # who said it (Names), or -1 for the game's own lines
    first: float = 0.0          # time.monotonic() when first seen
    channel: str = ""           # a speaker's channel ("01"), from its badge
    block: str = ""             # a speaker's block's colour ("yellow")

    @property
    def kind(self):
        """What kind of line it is: what it was read as most. (Over pale scenery, party pink can look white for a look.)"""
        return self.kinds.most_common(1)[0][0]


class ChatLog:
    """Every chat line seen this run, by when it was first seen. Kept in memory until the tracker closes. The same line is
    never in it twice: it's known by who said it and what they said, however it's read."""

    def __init__(self, limit=3000):
        self.lines, self.limit, self.changed, self.added = [], limit, 0, 0
        self.names = Names()
        self.exact = {}                 # (person, what they said, as _key) -> Said

    def add(self, kind, text, now, clock=None, channel="", block=""):
        """A line read off the screen, at now (time.monotonic()) and clock (time.time()), and a speaker's channel and block
        colour. (Said, it's new) or (None, False) if it says nothing a line would."""
        text = tidy(text)
        if not is_line(kind, text):
            return None, False
        who, what = split(text)
        person = self.names.match(who) if who else -1
        key = (person, _key(what))
        said = self._exact(key, now) if person is not None else None
        if said is None and who and len(_key(what)) >= 8:
            # (the same words, just now, with the name read too badly to know: "Steaciynancl" for Steadyhand)
            for old in reversed(self.lines[-RECENT_LINES:]):
                if old.person >= 0 and abs(now - old.seen) <= NEAR_S and same_line(old.text, what, SAME_WORDS):
                    said, person = old, old.person
                    break
        if who:
            if person is None:
                person = self.names.find(who)
            else:
                self.names.people[person][who] += 1
            self._rename(person)
            key = (person, _key(what))
            said = said or self._exact(key, now)
        if said is None:
            for old in reversed(self.lines[-RECENT_LINES:]):
                # (the same person saying much the same within moments: one line read two ways, over different scenery)
                alike = SAME_NEAR if abs(now - old.seen) <= NEAR_S else SAME
                if old.person == person and now - old.seen <= REMEMBER_S and same_line(old.text, what, alike):
                    said = old
                    break
        if said is not None:
            self.seen_again(said, kind, now, channel, block)
            if len(_key(what)) > len(_key(said.text)) + 2:              # (read more of it this time)
                said.text = what
                self.changed += 1
            self.exact[key] = said
            return said, False
        self.added += 1
        said = Said(clock if clock is not None else time.time(), Counter({kind: 1}), self.names.shown(person) if person >= 0 else "",
                    what, now, self.added, person, now, channel, block)
        bisect.insort(self.lines, said, key=lambda x: (x.when, x.number))
        for gone in self.lines[:-self.limit]:
            self.exact = {k: v for k, v in self.exact.items() if v is not gone}
        del self.lines[:-self.limit]
        self.exact[key] = said
        self.changed += 1
        return said, True

    def _exact(self, key, now):
        said = self.exact.get(key)
        return said if said is not None and now - said.seen <= REMEMBER_S else None

    def seen_again(self, said, kind, now, channel="", block=""):
        """A line seen again, and what kind it looked like this time (and a speaker's channel and block, if they were read
        better this time: a digit not read before)."""
        was = said.kind
        said.kinds[kind] += 1
        said.seen = max(said.seen, now)
        if said.kind != was:
            self.changed += 1
        if channel and (not said.channel or said.channel.count("?") > channel.count("?")):
            said.channel = channel
            self.changed += 1
        if block and not said.block:
            said.block = block
            self.changed += 1

    def _rename(self, person):
        """A person's name as shown, on every line of theirs: it's what most readings say, so it can change as more come."""
        name = self.names.shown(person)
        for x in self.lines[-RECENT_LINES:]:
            if x.person == person and x.who != name:
                x.who = name
                self.changed += 1

    def of(self, kinds):
        return [x for x in self.lines if x.kind in kinds]

    def forget(self, said):
        """A line that was only ever seen once: a flicker of scenery read as a line, not something said."""
        if said in self.lines:
            self.lines.remove(said)
            self.exact = {k: v for k, v in self.exact.items() if v is not said}
            self.changed += 1


class ChatWatch:
    """read_lines(images, chars): Tesseract. look() at the chat area often (it's quick), and read() what it's found, in
    another thread. kinds: which kinds of lines to read (set it again any time): the rest are let be."""

    def __init__(self, read_lines, log=None, kinds=KINDS):
        self.read_lines = read_lines
        self.log = log if log is not None else ChatLog()
        self.kinds = set(kinds)
        self.known = {}                 # a line's picture's size -> [(shape, the Said it is, or None for nonsense)], latest last
        self.waiting = []               # (kind, shape, mask, s, now, clock, top): lines seen, not read yet
        self.lock = threading.Lock()
        self.reads = self.dropped = 0
        self.new = []                   # Said added, not told yet (take_new)
        self.scenery = {}               # (where a line would be: its top, its kind) -> until when it's left alone: it read as
                                        # nonsense there, so it's scenery above the open box (which changes as you move)

    def _known(self, shape):
        for old, said in reversed(self.known.get(shape.shape, ())):
            if _shape_same(old, shape):
                return True, said
        return False, None

    def _remember(self, shape, said):
        same = self.known.setdefault(shape.shape, [])
        same.append((shape, said))
        del same[:-SHAPES]

    def look(self, img, rect_h, x0, now, clock=None):
        """A picture of the chat area (area()), the window's height, where lines start in it (text_x()), and the time
        (time.monotonic(), and time.time()). Lines read already count as seen again at once; the rest wait for read().
        How many lines it saw."""
        s = rect_h / REF_H
        found = [r for r in rows(img, s, x0) if r.kind in self.kinds]
        with self.lock:
            found = [r for r in found if self.scenery.get((r.top // 4, r.kind), -1.0) < now]
            for r in found:                             # (top to bottom: oldest first)
                known, said = self._known(r.shape)
                if known:
                    if said is not None:
                        self.log.seen_again(said, r.kind, now, r.channel, r.block)
                elif not any(_shape_same(w[1], r.shape) for w in self.waiting):
                    self.waiting.append((r.kind, r.shape, r.mask, s, now, clock, r.top, r.channel, r.block))
            if len(self.waiting) > WAITING:
                self.dropped += len(self.waiting) - WAITING
                self.waiting.sort(key=lambda w: (FIRST.index(w[0]), -w[4]))
                del self.waiting[WAITING:]
        return len(found)

    def read(self):
        """Reads the lines waiting (buddy lines first), BATCH at most, with one start of Tesseract. How many it read."""
        with self.lock:
            if not self.waiting:
                return 0
            self.waiting.sort(key=lambda w: (FIRST.index(w[0]), w[4]))
            batch, self.waiting = self.waiting[:BATCH], self.waiting[BATCH:]
        texts = self.read_lines([picture(w[2], w[3]) for w in batch], None)
        with self.lock:
            self.reads += 1
            for w, text in sorted(zip(batch, texts), key=lambda p: p[0][4]):
                said, new = self.log.add(w[0], text, w[4], w[5], w[7], w[8])
                if said is None:
                    self.scenery[(w[6] // 4, w[0])] = w[4] + SCENERY_S
                elif new:
                    self.new.append(said)
                self._remember(w[1], said)
        return len(batch)

    def take_new(self, now=None):
        """The lines added since this was last asked, once they've been seen enough to be sure of them: what kind they are (a
        line that looked like buddy chat once, over orange rock, and party chat every look after, isn't a buddy's), and that
        they're lines at all. Real lines stay up for many looks; one seen only once, and not again for a while, is let go."""
        now = time.monotonic() if now is None else now
        with self.lock:
            ready, keep = [], []
            for x in self.new:
                looks = sum(x.kinds.values())
                if looks >= SETTLE_LOOKS or (looks >= 2 and now - x.first >= SETTLE_S):
                    ready.append(x)
                elif looks == 1 and now - x.first >= ONCE_S:
                    self.log.forget(x)
                else:
                    keep.append(x)
            self.new = keep
        return ready
