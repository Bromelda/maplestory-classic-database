"""Watches the playing field: follows the monsters, sees them vanish, sees what lands on the ground
where they died, and sees it leave the ground. It tells lootwatch.DropLedger, which decides what counts.

This only ever looks at pictures of the game window. It doesn't touch the game in any way.

How it works, each look (about 8 times a second), on a half-size copy of the picture:

1. Camera. The view scrolls, so everything is kept in world position: how far the view moved since the
   last look is measured (phase correlation) and then checked (does the moved picture really line up?).
   If it can't be worked out for a while (a loading screen, a new map), everything starts again.
2. Scenery. A picture of the empty map is built up in world position (each pixel creeps toward what it
   sees, so things passing by don't stick). What differs from it now is what's on top of the scenery.
   Monsters we're following and drops we're watching are kept out of it, so they never become scenery.
3. Monsters are known by their sprites, only the ones that live on this map. Each is followed; one that
   stops being found, away from the edge of the view, has vanished.
4. Drops have no pictures to look for (most items have no icon here), so they're known by how they act,
   and only looked for where a monster has just vanished: something about the size of an icon that came
   after it vanished, stays in one place, on ground that wasn't blinking. Drops nobody saw land are left
   alone: the ledger only needs the ones from monsters it was watching.
5. A drop that stops being there has left the ground. If something is standing on it, it comes back.
"""
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

WORK_H = 540                # the picture's height to work at
CANVAS_W, CANVAS_H = 4000, 2400     # the world picture (in working pixels): larger than the largest map
LEARN_STEP = 3              # how far a scenery pixel creeps toward what it sees, each look
DIFF_ON = 30                # how different from the scenery a pixel must be to be "on top" of it
SEEN_MIN = 10               # looks a scenery pixel must have had before it's trusted
WARM_UP = 16                # looks at a map before anything on the ground is believed
CALM_DIFF = 10              # this close to the scenery: the scenery's right about this pixel
CALM_LOOKS = 12             # looks of that before a pixel is known to be real ground
SHIFT_MAX = 0.35            # the most the view can move between looks (share of the picture)
LINE_UP_OK = 14.0           # average difference between two looks once lined up, at most, to trust the move
LOST_LOOKS = 16             # looks in a row with no trustworthy move (2 seconds; a skill's flash is shorter): start again
MATCH_OK = 0.62             # how alike a followed monster must look to its sprite
MATCH_NEW = 0.72            # ...to start following one
MATCH_MARGIN = 0.05         # ...and how much more like it than any other monster here (a near tie is nobody)
GONE_AFTER = 0.9            # seconds not found before a monster has vanished (being hit changes how it looks)
FORGET_AFTER = 1.8          # ...and before it's forgotten for good (found again before this: it was only hidden)
RECENT = 0.4                # found this recently: it's still standing where it was
EDGE = 40                   # a monster last seen this close to the view's edge (plus half its width) walked out of view
ICON = 32                   # an item's icon, in sprite pixels
ICON_MIN, ICON_MAX = 0.3, 1.5      # share of ICON a thing on the ground can measure
STAY_S = 0.35               # seconds something must stay put to be a drop
STAY_X, STAY_Y = 3, 7       # how far it can wander meanwhile (drops bob up and down), working px
FLICKER_MAX = 60            # how much a spot may have been blinking on and off lately for it to count as steady
DROP_ZONE = 110.0            # how far from a vanished monster to look for its drop (sprite pixels)
DROP_ZONE_Y = 90.0
DROP_ZONE_S = 3.5           # ...and for how long
GHOST = 0.75                # the scenery itself looks this much like a monster: it had got in there
                            # (plain scenery can reach 0.68 by chance, on the one real picture we have)
SAME_DROP = 0.45            # how alike a drop must look to itself to be still there
LOST_LOOKS_LOOT = 2         # looks in a row not there before it's lost
FORGET_LOOT = 8.0           # seconds lost before it's no longer watched
FULL_SEARCH_EVERY = 8       # looks between searching the whole view for one monster's sprites
# Sprite size to working size, most likely first. A real 1920x1080 window shows them at 0.66.
SCALES = (0.66, 0.72, 0.6, 0.8, 0.55, 0.9, 0.5, 1.0, 0.46, 0.42)
SCALE_SURE = 0.72           # how alike a sprite must look to believe this is its size
VIEW_BOX = (0.17, 0.02, 0.95, 0.84)     # the part of the picture used to measure the view's move (no fixed windows)


def _to_gray(img):
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


def sprite_frames(path, most=6):
    """A monster's animation as [(BGR, mask)], each cut to the sprite. Near-identical frames are dropped."""
    im = Image.open(path)
    out, sigs = [], []
    for k in range(getattr(im, "n_frames", 1)):
        im.seek(k)
        rgba = np.array(im.convert("RGBA"))
        alpha = rgba[..., 3] > 128
        if not alpha.any():
            continue
        ys, xs = np.nonzero(alpha)
        cut = rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        bgr, mask = cut[..., 2::-1].copy(), (cut[..., 3] > 128).astype(np.uint8) * 255
        sig = cv2.resize(bgr, (16, 16)).astype(np.float32)
        if any(np.abs(sig - s).mean() < 6 for s in sigs):
            continue
        sigs.append(sig)
        out.append((bgr, mask))
    if len(out) > most:
        out = [out[int(i * len(out) / most)] for i in range(most)]
    return out


class SpriteBank:
    """The sprites of the monsters on this map, at the size they show on screen, both ways round."""

    def __init__(self, folder, data):
        self.folder, self.data = Path(folder), data
        self.raw = {}               # species -> frames at the game's own size
        self.scale = None           # sprite pixels to working pixels, once found
        self._at = {}

    def use(self, species):
        self.raw = {}
        self._at = {}
        for s in species:
            gid = self.data.gid_of(s) if self.data else s
            p = self.folder / f"{gid}.gif"
            if p.is_file():
                frames = sprite_frames(p)
                if frames:
                    self.raw[s] = frames

    def templates(self, species, scale=None):
        scale = scale or self.scale
        key = (species, scale)
        if key not in self._at:
            made = []
            for bgr, mask in self.raw.get(species, []):
                w, h = max(4, round(bgr.shape[1] * scale)), max(4, round(bgr.shape[0] * scale))
                b = cv2.resize(bgr, (w, h), interpolation=cv2.INTER_AREA)
                m = (cv2.resize(mask, (w, h), interpolation=cv2.INTER_AREA) > 127).astype(np.uint8) * 255
                made.append((b, m))
                made.append((b[:, ::-1].copy(), m[:, ::-1].copy()))
            self._at[key] = made
        return self._at[key]


def best_match(area, templates):
    """The best any of these templates fits in area: (score, x, y, w, h), or None."""
    best = None
    for t, m in templates:
        th, tw = t.shape[:2]
        if area.shape[0] < th or area.shape[1] < tw:
            continue
        res = cv2.matchTemplate(area, t, cv2.TM_CCOEFF_NORMED, mask=m)
        res = np.nan_to_num(res, nan=-1.0, posinf=-1.0, neginf=-1.0)
        _, score, _, at = cv2.minMaxLoc(res)
        if best is None or score > best[0]:
            best = (float(score), at[0], at[1], tw, th)
    return best


class ScaleFinder:
    """How big sprites show (it depends on the game's window size). Finding it is costly, so a little is
    tried at each look, and a size is believed once a sprite fits it at two looks in a row."""

    def __init__(self):
        self.order = []
        self.at = 0
        self.hit = None

    def step(self, frame, bank):
        """One more try on this picture. The scale, once it's sure, else None."""
        if not self.order or set(s for s, _ in self.order) != set(bank.raw):
            self.order = [(sp, sc) for sc in SCALES for sp in bank.raw]
            self.at, self.hit = 0, None
        if not self.order:
            return None
        pair = self.hit or self.order[self.at]
        got = best_match(frame[:int(frame.shape[0] * 0.88)], bank.templates(*pair))
        sure = got is not None and got[0] >= SCALE_SURE
        if sure and self.hit:
            return pair[1]
        self.hit = pair if sure else None
        if not sure:
            self.at = (self.at + 1) % len(self.order)
        return None


class Camera:
    """How far the view has moved, added up: (x, y) in working pixels."""

    def __init__(self):
        self.x, self.y = 0.0, 0.0
        self.prev = None
        self.window = None
        self.lost = 0

    def _part(self, gray):
        h, w = gray.shape
        x0, y0, x1, y1 = VIEW_BOX
        return np.float32(gray[int(y0 * h):int(y1 * h), int(x0 * w):int(x1 * w)])

    def reset(self):
        self.x, self.y, self.prev, self.lost = 0.0, 0.0, None, 0

    def update(self, gray):
        """A new look. Returns True if the move is known. If not, the next look is compared with the last
        good one, so a moment's flash doesn't throw the view's position off."""
        g = self._part(gray)
        if self.prev is None:
            self.prev, self.window = g, cv2.createHanningWindow(g.shape[::-1], cv2.CV_32F)
            return True
        (dx, dy), _ = cv2.phaseCorrelate(self.prev, g, self.window)
        ix, iy = int(round(dx)), int(round(dy))
        h, w = g.shape
        ok = abs(ix) <= w * SHIFT_MAX and abs(iy) <= h * SHIFT_MAX
        if ok:
            moved = self._line_up(g, ix, iy)
            still = self._line_up(g, 0, 0)
            if still <= moved + 0.5:            # staying put explains it at least as well
                ix, iy, moved = 0, 0, still
            ok = moved <= LINE_UP_OK
        if not ok:
            self.lost += 1
            return False
        self.prev = g
        self.lost = 0
        # (The world stays put, so the picture moving right by dx means the view moved left by dx.)
        self.x -= ix
        self.y -= iy
        return True

    def _line_up(self, g, dx, dy):
        h, w = g.shape
        a = self.prev[max(0, -dy):h - max(0, dy), max(0, -dx):w - max(0, dx)]
        b = g[max(0, dy):h - max(0, -dy), max(0, dx):w - max(0, -dx)]
        return float(np.abs(a - b).mean()) if a.size else 1e9


class Scenery:
    """The map with nothing on it, built up in world position."""

    def __init__(self):
        self.pic = np.zeros((CANVAS_H, CANVAS_W, 3), np.int16)
        self.seen = np.zeros((CANVAS_H, CANVAS_W), np.uint8)
        self.flicker = np.zeros((CANVAS_H, CANVAS_W), np.uint8)
        self.was_on = np.zeros((CANVAS_H, CANVAS_W), bool)
        self.born = np.zeros((CANVAS_H, CANVAS_W), np.float32)      # when each pixel came on top
        self.calm = np.zeros((CANVAS_H, CANVAS_W), np.uint8)        # looks it's agreed with the scenery
        self.doubt = np.zeros((CANVAS_H, CANVAS_W), bool)           # a monster was on it before we knew the ground
        self.looks = 0

    def reset(self):
        self.pic[:] = 0
        self.seen[:] = 0
        self.flicker[:] = 0
        self.was_on[:] = False
        self.calm[:] = 0
        self.doubt[:] = False
        self.looks = 0

    def view(self, cx, cy, w, h):
        """Where the view is in the world picture: (x0, y0), or None if it's run off the end."""
        x0, y0 = CANVAS_W // 2 + int(cx) - w // 2, CANVAS_H // 2 + int(cy) - h // 2
        if x0 < 0 or y0 < 0 or x0 + w > CANVAS_W or y0 + h > CANVAS_H:
            return None
        return x0, y0

    def compare(self, frame, x0, y0, keep, hold=None, when=0.0):
        """What's on top of the scenery now (mask, 255: on top), and the scenery learns from the rest.
        keep: 255 where the scenery mustn't learn. hold: 255 where what's on top is already accounted for
        (monsters followed, drops watched, the game's windows): it only starts when it's let go."""
        h, w = frame.shape[:2]
        pic = self.pic[y0:y0 + h, x0:x0 + w]
        seen = self.seen[y0:y0 + h, x0:x0 + w]
        flick = self.flicker[y0:y0 + h, x0:x0 + w]
        now = frame.astype(np.int16)
        fresh = seen == 0
        pic[fresh] = now[fresh]
        # A monster first found standing on ground we'd never seen bare: the "scenery" there is really the
        # monster. The moment it's uncovered (it moved, or it died) what shows is the true ground.
        doubt = self.doubt[y0:y0 + h, x0:x0 + w]
        uncovered = doubt & (keep == 0)
        pic[uncovered] = now[uncovered]
        doubt[uncovered] = False
        diff = now - pic
        # Different from the scenery AND from its neighbours: the view's move is only known to a pixel,
        # and sharp edges in the scenery mustn't read as something new.
        low = cv2.erode(pic, np.ones((3, 3), np.uint8))
        high = cv2.dilate(pic, np.ones((3, 3), np.uint8))
        off = np.maximum(low - now, now - high)
        on_top = (off.max(axis=2) > DIFF_ON) & (seen >= SEEN_MIN)
        learn = keep == 0
        calm = self.calm[y0:y0 + h, x0:x0 + w]
        agree = np.abs(diff).max(axis=2) <= CALM_DIFF
        grow = learn & agree & (calm < 200)
        calm[grow] += 1
        calm[learn & on_top] = 0
        pic[learn] += np.clip(diff, -LEARN_STEP, LEARN_STEP)[learn]
        seen[learn & (seen < 250)] += 1
        # Things that blink on and off are scenery that moves by itself. (Something walking across a
        # spot only comes on once, so it doesn't count against the spot.)
        was = self.was_on[y0:y0 + h, x0:x0 + w]
        free = learn if hold is None else hold == 0
        rose = on_top & free & ~was
        flick[rose] = np.minimum(flick[rose].astype(np.int16) + 40, 255).astype(np.uint8)
        started = on_top & ~was
        self.born[y0:y0 + h, x0:x0 + w][started] = when
        was[:] = on_top & free
        self.looks += 1
        if self.looks % 16 == 0:
            flick >>= 1                         # (forgotten over a few seconds)
        return on_top.astype(np.uint8) * 255


@dataclass
class Track:
    id: int
    species: str
    x: float                    # the sprite's middle, in world working pixels
    y: float
    w: int
    h: int
    seen: float                 # when it was last found
    reported: bool = False      # the ledger's been told it vanished
    in_view: bool = True
    edge: bool = False          # it was last seen close to the view's edge


@dataclass
class Spot:
    """Something on the ground: a candidate, then a drop being watched."""
    x: float
    y: float
    w: int
    h: int
    first: float
    last: float
    ledger_id: int = None       # set when it's a drop
    picture: np.ndarray = None
    missing: int = 0
    lost_at: float = None


class FieldWatch:
    """Give it pictures of the game window with look(); it tells the ledger what it sees."""

    def __init__(self, ledger, sprites_folder, data=None, scale=None):
        self.ledger, self.data = ledger, data
        self.bank = SpriteBank(sprites_folder, data)
        self.bank.scale = scale
        self.finder = ScaleFinder()
        self.camera = Camera()
        self.scenery = Scenery()
        self.tracks, self.spots, self.drops = [], [], []
        self._next = 1
        self._turn = 0
        self._search_at = 0
        self.species = []
        self.size = None
        self.where = (0, 0)             # where the view is in the world picture, this look
        self.gone_spots = []            # where monsters vanished lately: (x, y, when), world working pixels
        self.last = {}                  # for the debug picture
        self.resets = 0
        self.ui_boxes = None            # share-of-picture boxes the game's own windows live in

    # ---------- setup ----------

    def set_species(self, species):
        """The monsters living on this map (a new map: everything starts again)."""
        if list(species) == self.species:
            return
        self.species = list(species)
        self.bank.use(species)
        self.start_again()

    def start_again(self):
        self.camera.reset()
        self.scenery.reset()
        self.tracks, self.spots, self.drops, self.gone_spots = [], [], [], []
        self.resets += 1

    def _sprite_scale(self):
        """Working pixels per sprite pixel, for sizes. (Until sprites are found: what 1080p shows.)"""
        return self.bank.scale or 0.5

    def _ui_mask(self, shape):
        """255 where the game's fixed windows are: the bars at the bottom, the mini map, the message stack."""
        h, w = shape[:2]
        m = np.zeros((h, w), np.uint8)
        boxes = self.ui_boxes or ((0.0, 0.85, 1.0, 0.15), (0.0, 0.0, 0.16, 0.26), (0.77, 0.62, 0.23, 0.23))
        for bx, by, bw, bh in boxes:
            m[int(by * h):int((by + bh) * h), int(bx * w):int((bx + bw) * w)] = 255
        return m

    def to_ledger(self, x, y):
        """World working pixels to sprite pixels, which is what the ledger's distances are in."""
        s = self._sprite_scale()
        return x / s, y / s

    # ---------- each look ----------

    def look(self, frame, now):
        """A picture of the game window (BGR), any size, taken at time now."""
        scale = WORK_H / frame.shape[0]
        small = cv2.resize(frame, (round(frame.shape[1] * scale), WORK_H), interpolation=cv2.INTER_AREA)
        self.size = small.shape[1], small.shape[0]
        h, w = small.shape[:2]
        ui = self._ui_mask(small.shape)
        known = self.camera.update(_to_gray(small))
        if self.camera.lost >= LOST_LOOKS:
            self.ledger.close_all(now, "camera")
            self.start_again()
            return
        if not known:
            return                              # can't place anything in this look
        where = self.scenery.view(self.camera.x, self.camera.y, w, h)
        if where is None:
            self.ledger.close_all(now, "camera")
            self.start_again()
            return
        x0, y0 = where
        self.where = where
        self._follow(small, now)                # (first: so the scenery knows where they are now)
        keep = ui.copy()
        for t in self.tracks:
            if now - t.seen < RECENT:
                self._mark(keep, t.x, t.y, t.w + 16, t.h + 12)
        for d in self.drops + self.spots:
            self._mark(keep, d.x, d.y, d.w + 8, d.h + 16)
        hold = keep.copy()
        # Nothing new is learned where a monster has just vanished, or its drop would fade into the
        # scenery before it's been there long enough to be sure of it.
        s = self._sprite_scale()
        for zx, zy, _ in self._zones(now):
            self._mark(keep, zx, zy, 2 * DROP_ZONE * s, 2 * DROP_ZONE_Y * s)
        on_top = self.scenery.compare(small, x0, y0, keep, hold, now)
        on_top[ui > 0] = 0
        self._search(small, on_top, now)
        self._vanished(now)
        if self.scenery.looks >= WARM_UP:
            self._ground(small, on_top, x0, y0, now)
        self._watch_drops(small, on_top, now)
        self.last = {"on_top": on_top, "small": small, "x0": x0, "y0": y0}

    def _to_screen(self, x, y):
        w, h = self.size
        return x - self.camera.x + w / 2, y - self.camera.y + h / 2

    def _to_world(self, sx, sy):
        w, h = self.size
        return sx + self.camera.x - w / 2, sy + self.camera.y - h / 2

    def _mark(self, mask, x, y, bw, bh):
        sx, sy = self._to_screen(x, y)
        x0, y0 = int(sx - bw / 2), int(sy - bh / 2)
        h, w = mask.shape
        mask[max(0, y0):min(h, y0 + int(bh)), max(0, x0):min(w, x0 + int(bw))] = 255

    # ---------- monsters ----------

    def _follow(self, small, now):
        h, w = small.shape[:2]
        for t in self.tracks:
            sx, sy = self._to_screen(t.x, t.y)
            pad = 28
            x0, y0 = int(sx - t.w / 2 - pad), int(sy - t.h / 2 - pad)
            x1, y1 = int(sx + t.w / 2 + pad), int(sy + t.h / 2 + pad)
            t.in_view = x0 + pad >= 0 and y0 + pad >= 0 and x1 - pad <= w and y1 - pad <= h
            area = small[max(0, y0):max(0, y1), max(0, x0):max(0, x1)]
            if area.size == 0:
                continue
            got = best_match(area, self.bank.templates(t.species)) if self.bank.scale else None
            if got and got[0] >= MATCH_OK:
                nx, ny = max(0, x0) + got[1] + got[3] / 2, max(0, y0) + got[2] + got[4] / 2
                t.x, t.y = self._to_world(nx, ny)
                t.w, t.h, t.seen = got[3], got[4], now
                reach = EDGE + t.w / 2
                t.edge = nx < reach or nx > w - reach or ny < reach or ny > h - reach
                if t.reported:
                    t.reported = False
                    self.ledger.mob_back(t.id, now)

    def _vanished(self, now):
        keep = []
        for t in self.tracks:
            gone_for = now - t.seen
            if gone_for >= GONE_AFTER and not t.reported and not t.edge and t.in_view:
                t.reported = True
                x, y = self.to_ledger(t.x, t.y)
                self.ledger.mob_gone(t.species, x, y, t.seen, track=t.id)
                self.gone_spots.append((t.x, t.y, t.seen))
            if gone_for < FORGET_AFTER:
                keep.append(t)
        self.tracks = keep

    def _search(self, small, on_top, now):
        """Look for monsters we aren't following: where something's moving, and the whole view in turns."""
        if not self.bank.raw:
            return
        if self.bank.scale is None:
            self.bank.scale = self.finder.step(small, self.bank)
            return
        species = list(self.bank.raw)
        self._turn += 1
        n, _, stats, _ = cv2.connectedComponentsWithStats(cv2.dilate(on_top, np.ones((5, 5), np.uint8)))
        s = self._sprite_scale()
        for k in range(1, n):
            x, y, bw, bh, area = stats[k]
            if bw < 14 * s or bh < 14 * s or bw > 260 * s or bh > 260 * s:
                continue
            if self._followed(x + bw / 2, y + bh / 2, bw, bh):
                continue
            self._try_start(small, species, x - 12, y - 12, x + bw + 12, y + bh + 12, now)
        if self._turn % FULL_SEARCH_EVERY == 0 or self.scenery.looks <= WARM_UP:     # (at first: before they're learned in)
            self._search_at = (self._search_at + 1) % len(species)
            self._try_start(small, [species[self._search_at]], 0, 0, small.shape[1], small.shape[0], now, whole=True)

    def _followed(self, sx, sy, bw, bh, now=None):
        for t in self.tracks:
            if now is not None and now - t.seen >= RECENT:
                continue
            tx, ty = self._to_screen(t.x, t.y)
            if abs(tx - sx) < (t.w + bw) / 2 and abs(ty - sy) < (t.h + bh) / 2:
                return True
        return False

    def _try_start(self, small, species, x0, y0, x1, y1, now, whole=False):
        h, w = small.shape[:2]
        x0, y0, x1, y1 = max(0, int(x0)), max(0, int(y0)), min(w, int(x1)), min(int(h * 0.9), int(y1))
        area = small[y0:y1, x0:x1]
        if area.size == 0:
            return
        scores = []
        for sp in species:
            got = best_match(area, self.bank.templates(sp))
            if got:
                scores.append((got[0], sp, got))
        if not scores:
            return
        scores.sort(key=lambda g: -g[0])
        score, sp, got = scores[0]
        if score < MATCH_NEW or (len(scores) > 1 and score - scores[1][0] < MATCH_MARGIN):
            return
        nx, ny = x0 + got[1] + got[3] / 2, y0 + got[2] + got[4] / 2
        if self._followed(nx, ny, got[3], got[4]):
            return
        if len(species) == 1 and len(self.bank.raw) > 1:        # (one sprite's search: ask the others too)
            for other in self.bank.raw:
                if other != sp:
                    o = best_match(small[max(0, y0 + got[2] - 4):y0 + got[2] + got[4] + 4,
                                         max(0, x0 + got[1] - 4):x0 + got[1] + got[3] + 4], self.bank.templates(other))
                    if o and score - o[0] < MATCH_MARGIN:
                        return
        wx, wy = self._to_world(nx, ny)
        self.tracks.append(Track(self._next, sp, wx, wy, got[3], got[4], now))
        self._next += 1
        self._doubt_under(wx, wy, got[3] + 16, got[4] + 12)

    def _doubt_under(self, wx, wy, bw, bh):
        """Ground under a monster just found, if the scenery doesn't really know that ground."""
        where = self.where
        sx, sy = self._to_screen(wx, wy)
        w, h = self.size
        x0, y0 = int(max(0, sx - bw / 2)), int(max(0, sy - bh / 2))
        x1, y1 = int(min(w, sx + bw / 2)), int(min(h, sy + bh / 2))
        calm = self.scenery.calm[where[1] + y0:where[1] + y1, where[0] + x0:where[0] + x1]
        self.scenery.doubt[where[1] + y0:where[1] + y1, where[0] + x0:where[0] + x1] |= calm < CALM_LOOKS

    # ---------- drops ----------

    def _icon_box(self):
        s = self._sprite_scale()
        return ICON * s * ICON_MIN, ICON * s * ICON_MAX

    def _zones(self, now):
        """Where a drop could be landing now: around monsters that have just stopped being found."""
        self.gone_spots = [g for g in self.gone_spots if now - g[2] <= DROP_ZONE_S]
        zones = list(self.gone_spots)
        zones += [(t.x, t.y, t.seen) for t in self.tracks if not t.reported and 0.12 <= now - t.seen]
        return zones

    def _in_zone(self, wx, wy, zones):
        """The zone this spot is in: when its monster vanished (the latest, if several), or None."""
        s = self._sprite_scale()
        times = [z[2] for z in zones if abs(z[0] - wx) <= DROP_ZONE * s and abs(z[1] - wy) <= DROP_ZONE_Y * s]
        return max(times) if times else None

    def _ground(self, small, on_top, x0, y0, now):
        zones = self._zones(now)
        low, high = self._icon_box()
        seen_now = []
        if zones:
            k = max(3, round(6 * self._sprite_scale()) | 1)     # (a drop like the scenery comes in pieces)
            solid = cv2.morphologyEx(on_top, cv2.MORPH_CLOSE, np.ones((k, k), np.uint8))
            n, labels, stats, _ = cv2.connectedComponentsWithStats(solid)
            for k in range(1, n):
                x, y, bw, bh, area = stats[k]
                if not (low <= bw <= high and low <= bh <= high) or area < 0.25 * bw * bh:
                    continue
                cx, cy = x + bw / 2, y + bh / 2
                if self._followed(cx, cy, bw, bh, now):      # (not one that's gone: its drop lands right there)
                    continue
                wx, wy = self._to_world(cx, cy)
                vanished = self._in_zone(wx, wy, zones)
                if vanished is None:
                    continue
                if any(abs(d.x - wx) <= d.w / 2 + STAY_X and abs(d.y - wy) <= d.h / 2 + STAY_Y for d in self.drops):
                    continue
                seen_now.append((wx, wy, bw, bh, x, y, vanished))
        keep = []
        for wx, wy, bw, bh, sx, sy, vanished in seen_now:
            spot = next((c for c in self.spots if abs(c.x - wx) <= STAY_X and abs(c.y - wy) <= STAY_Y), None)
            if spot is None:
                if not self._was_steady(int(sx), int(sy), int(bw), int(bh), x0, y0):
                    continue
                if not self._came_after(int(sx), int(sy), int(bw), int(bh), x0, y0, on_top, vanished):
                    continue
                if self._ghost(small, int(sx), int(sy), int(bw), int(bh), x0, y0):
                    continue
                spot = Spot(wx, wy, int(bw), int(bh), now, now)
                self.spots.append(spot)
            else:
                spot.last = now
                spot.w, spot.h = max(spot.w, int(bw)), max(spot.h, int(bh))
            keep.append(spot)
            if now - spot.first >= STAY_S:
                self._become_drop(spot, small, now)
        self.spots = [c for c in self.spots if c.ledger_id is None and (c in keep or now - c.last < 0.3)]

    def _came_after(self, sx, sy, bw, bh, x0, y0, on_top, vanished):
        """Did this come after the monster vanished? What was there before can't be what it dropped."""
        born = self.scenery.born[y0 + sy:y0 + sy + bh, x0 + sx:x0 + sx + bw]
        on = on_top[sy:sy + bh, sx:sx + bw] > 0
        return bool(on.any()) and float(np.median(born[on])) >= vanished - 0.3

    def _ghost(self, small, sx, sy, bw, bh, x0, y0):
        """A monster that stood still from the start got learned into the scenery. When it goes, the
        spot differs from the "scenery", and looks new. Then the scenery itself shows the monster:
        that's put right, and it's no drop."""
        pad = 60
        H, W = small.shape[:2]
        ax0, ay0 = max(0, sx - pad), max(0, sy - pad)
        ax1, ay1 = min(W, sx + bw + pad), min(H, sy + bh + pad)
        pic = self.scenery.pic[y0 + ay0:y0 + ay1, x0 + ax0:x0 + ax1]
        area = np.clip(pic, 0, 255).astype(np.uint8)
        for species in self.bank.raw:
            got = best_match(area, self.bank.templates(species))
            if got and got[0] >= GHOST:
                x, y, tw, th = got[1:]
                pic[y:y + th, x:x + tw] = small[ay0 + y:ay0 + y + th, ax0 + x:ax0 + x + tw].astype(np.int16)
                return True
        return False

    def _was_steady(self, sx, sy, bw, bh, x0, y0):
        """Had this spot been quiet before now? Scenery that moves by itself never is."""
        f = self.scenery.flicker[y0 + sy:y0 + sy + bh, x0 + sx:x0 + sx + bw]
        return f.size > 0 and float(f.mean()) <= FLICKER_MAX

    def _crop(self, small, x, y, w, h):
        sx, sy = self._to_screen(x, y)
        x0, y0 = int(sx - w / 2), int(sy - h / 2)
        H, W = small.shape[:2]
        if x0 < 0 or y0 < 0 or x0 + w > W or y0 + h > H:
            return None
        return small[y0:y0 + h, x0:x0 + w]

    def _become_drop(self, spot, small, now):
        pic = self._crop(small, spot.x, spot.y, spot.w, spot.h)
        if pic is None:
            return
        spot.picture = pic.copy()
        lx, ly = self.to_ledger(spot.x, spot.y)
        lo = self.ledger.loot_seen(lx, ly, spot.first, picture=spot.picture)
        spot.ledger_id = lo.id
        self.drops.append(spot)

    def _still_there(self, small, d):
        """Does the spot still show this drop? It bobs, so it's looked for a little above and below."""
        sx, sy = self._to_screen(d.x, d.y)
        x0, y0 = int(sx - d.w / 2 - STAY_X), int(sy - d.h / 2 - STAY_Y)
        x1, y1 = int(sx + d.w / 2 + STAY_X), int(sy + d.h / 2 + STAY_Y)
        H, W = small.shape[:2]
        if x0 < 0 or y0 < 0 or x1 > W or y1 > H:
            return None                         # out of view: no news
        area = small[y0:y1, x0:x1]
        if area.shape[0] < d.picture.shape[0] or area.shape[1] < d.picture.shape[1]:
            return None
        res = cv2.matchTemplate(area, d.picture, cv2.TM_CCOEFF_NORMED)
        return float(np.nan_to_num(res).max()) >= SAME_DROP

    def _watch_drops(self, small, on_top, now):
        keep = []
        for d in self.drops:
            there = self._still_there(small, d)
            if there is None:
                keep.append(d)
                continue
            if there:
                d.missing = 0
                if d.lost_at is not None:
                    d.lost_at = None
                    self.ledger.loot_back(d.ledger_id)
                d.last = now
                keep.append(d)
                continue
            d.missing += 1
            if d.missing == LOST_LOOKS_LOOT and d.lost_at is None:
                d.lost_at = d.last
                self.ledger.loot_lost(d.ledger_id, d.last)
            if d.lost_at is None or now - d.lost_at < FORGET_LOOT:
                keep.append(d)
        self.drops = keep

    # ---------- for checking by eye ----------

    def picture(self):
        """What it sees right now, drawn on the working picture."""
        small = self.last.get("small")
        if small is None:
            return None
        out = small.copy()
        for t in self.tracks:
            sx, sy = self._to_screen(t.x, t.y)
            col = (0, 0, 255) if t.reported else (0, 255, 0)
            cv2.rectangle(out, (int(sx - t.w / 2), int(sy - t.h / 2)), (int(sx + t.w / 2), int(sy + t.h / 2)), col, 1)
            name = self.data.name_of(t.species) if self.data else str(t.species)
            cv2.putText(out, name, (int(sx - t.w / 2), int(sy - t.h / 2) - 3), cv2.FONT_HERSHEY_SIMPLEX, 0.35, col, 1)
        for d in self.drops:
            sx, sy = self._to_screen(d.x, d.y)
            col = (0, 165, 255) if d.lost_at is not None else (255, 255, 0)
            cv2.rectangle(out, (int(sx - d.w / 2), int(sy - d.h / 2)), (int(sx + d.w / 2), int(sy + d.h / 2)), col, 1)
        return out
