"""The field scanner (fieldwatch.py) on made-up footage: real map art and real monster sprites from the
database, moved around the way the game moves them, with a stand-in for the player and real item icons
for the drops. It proves the logic and the tracking hold together. It does NOT prove how well this works
in the real game: that needs real footage (see tools/replay.py).

Run it:  python tests/test_fieldwatch.py"""
import sys
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT.parent
sys.path.insert(0, str(ROOT))
import fieldwatch as fw  # noqa: E402
from lootwatch import DropLedger  # noqa: E402
from scandata import GameData  # noqa: E402

failures = 0
DATA = GameData(ROOT / "assets" / "scan_data.json")
FPS = 8
VIEW_W, VIEW_H = 1280, 720
SCREEN_SCALE = 1.32 * VIEW_H / 1080 * 1.5     # sprites on screen, per sprite pixel (the same share of the window as 1080p)


def check(name, ok, detail=""):
    global failures
    print(("PASS " if ok else "FAIL ") + name + (f"   {detail}" if detail and not ok else ""))
    failures += not ok


def load_world():
    """A real map's art, as the world to scroll around in (sized like a large map)."""
    art = sorted((SITE / "assets" / "map-art").glob("*.webp"), key=lambda p: -p.stat().st_size)[0]
    im = np.array(Image.open(art).convert("RGB"))[..., ::-1].copy()
    scale = max(3000 / im.shape[1], 1200 / im.shape[0])
    world = cv2.resize(im, None, fx=scale, fy=scale, interpolation=cv2.INTER_LINEAR)
    # Sharpen the art a bit: the game's own foreground is crisp pixel art with a lot to line up on.
    return world


def load_sprite(species):
    frames = fw.sprite_frames(ROOT / "assets" / "mob" / f"{DATA.gid_of(species)}.gif")
    out = []
    for bgr, mask in frames:
        w, h = round(bgr.shape[1] * SCREEN_SCALE), round(bgr.shape[0] * SCREEN_SCALE)
        out.append((cv2.resize(bgr, (w, h), interpolation=cv2.INTER_NEAREST), cv2.resize(mask, (w, h), interpolation=cv2.INTER_NEAREST)))
    return out


def raw_icon(name):
    im = np.array(Image.open(SITE / "assets" / "item" / name).convert("RGBA"))
    return im[..., 2::-1].copy(), (im[..., 3] > 128).astype(np.uint8) * 255


def load_icon(name):
    bgr, mask = raw_icon(name)
    w, h = round(bgr.shape[1] * SCREEN_SCALE), round(bgr.shape[0] * SCREEN_SCALE)
    return cv2.resize(bgr, (w, h), interpolation=cv2.INTER_NEAREST), cv2.resize(mask, (w, h), interpolation=cv2.INTER_NEAREST)


def paste(img, x, y, sprite, flip=False):
    """Draws a sprite with its middle at (x, y), where it's on the picture."""
    bgr, mask = sprite
    if flip:
        bgr, mask = bgr[:, ::-1], mask[:, ::-1]
    h, w = bgr.shape[:2]
    x0, y0 = int(x - w / 2), int(y - h / 2)
    cx0, cy0, cx1, cy1 = max(0, x0), max(0, y0), min(img.shape[1], x0 + w), min(img.shape[0], y0 + h)
    if cx1 <= cx0 or cy1 <= cy0:
        return
    m = mask[cy0 - y0:cy1 - y0, cx0 - x0:cx1 - x0] > 0
    img[cy0:cy1, cx0:cx1][m] = bgr[cy0 - y0:cy1 - y0, cx0 - x0:cx1 - x0][m]


class Mob:
    def __init__(self, species, x, y, dies=None, walks=30.0, reach=70.0):
        self.species, self.x0, self.y, self.dies = species, x, y, dies
        self.x, self.walks, self.reach = x, walks, reach
        self.sprite = load_sprite(species)
        self.heading = 1

    def move(self, t):
        self.x = self.x0 + self.reach * np.sin(t * self.walks / max(1.0, self.reach))
        self.heading = 1 if np.cos(t * self.walks / max(1.0, self.reach)) >= 0 else -1


class Drop:
    def __init__(self, icon, x, y, t, picked=None):
        self.icon, self.x, self.y, self.t, self.picked = icon, x, y, t, picked


class Scene:
    def __init__(self, world, mobs, drops=(), camera=None, player=None, blinker=None):
        self.world, self.mobs, self.drops = world, mobs, list(drops)
        self.camera = camera or (lambda t: (1000.0, 300.0))
        self.player = player
        self.blinker = blinker
        self.stand_in = load_sprite("tutorial_jr_sentinel") if "tutorial_jr_sentinel" in DATA.monsters else None

    def frame(self, t):
        cx, cy = self.camera(t)
        cx, cy = int(cx), int(cy)
        img = self.world[cy:cy + VIEW_H, cx:cx + VIEW_W].copy()
        if self.blinker:                            # scenery that moves by itself
            bx, by = self.blinker
            on = int(t * 5) % 2 == 0
            cv2.circle(img, (bx - cx, by - cy), 16, (40, 200, 240) if on else (20, 60, 200), -1)
        for m in self.mobs:
            if m.dies is None or t < m.dies:
                m.move(t)
                sprite = m.sprite[int(t * 6) % len(m.sprite)]
                paste(img, m.x - cx, m.y - cy, sprite, m.heading < 0)
        for d in self.drops:
            if t >= d.t and (d.picked is None or t < d.picked):
                bob = 3 * np.sin(t * 5)
                paste(img, d.x - cx, d.y - cy + bob, d.icon)
        if self.player:
            px, py = self.player(t)
            if self.stand_in:
                paste(img, px - cx, py - cy, self.stand_in[int(t * 4) % len(self.stand_in)])
        # The game's own windows, fixed on the screen.
        cv2.rectangle(img, (0, int(VIEW_H * 0.87)), (VIEW_W, VIEW_H), (70, 70, 70), -1)
        cv2.rectangle(img, (0, 0), (int(VIEW_W * 0.15), int(VIEW_H * 0.22)), (200, 200, 210), -1)
        return img


def spot_credits(led, species, item="Pig's Ribbon"):
    """Credits worked out by watching the spot (not just "it's the only monster on this map")."""
    return [c for c in led.credits if not c.void and c.how == "spot" and c.species == species and c.name == item]


def play(scene, species, seconds, events=(), scale=None, map_name=None):
    """Plays a scene through the scanner. events: [(time, what the message stack says)]."""
    led = DropLedger(DATA)
    if map_name:
        led.set_map(map_name)
    led.species_here = list(species)
    field = fw.FieldWatch(led, ROOT / "assets" / "mob", DATA, scale=scale)
    field.set_species(species)
    field.icons.add("Pig's Ribbon", *RAW_ICON_A)
    queue = sorted(events, key=lambda e: e[0])
    cost, frames = 0.0, 0
    t = 0.0
    while t < seconds:
        t0 = time.perf_counter()
        field.look(scene.frame(t), t)
        cost += time.perf_counter() - t0
        frames += 1
        while queue and queue[0][0] <= t:
            _, what = queue.pop(0)
            if what[0] == "exp":
                led.exp(what[1], t)
            elif what[0] == "party":
                led.party_exp(t)
            else:
                led.pickup(what[1], what[2], "Etc", t)
        led.tick(t)
        t += 1 / FPS
    # Time passes after the scene, so that everything gets decided.
    for extra in range(0, 80):
        led.tick(seconds + extra)
    return led, field, cost / max(1, frames)


WORLD = load_world()
icons = sorted(p.name for p in (SITE / "assets" / "item").glob("*.png"))
ICON_A = load_icon(icons[len(icons) // 3])
RAW_ICON_A = raw_icon(icons[len(icons) // 3])
GROUND = 700.0
# Everything up to t=4 is the scanner getting to know the map.
SCALE = fw.WORK_H / VIEW_H * SCREEN_SCALE
print(f"sprites on screen at {SCREEN_SCALE:.2f}, working scale {SCALE:.2f}")
XP = {k: DATA.exp_of(k) for k in ("pig", "slime", "green_mushroom", "wild_boar", "snail")}
screen_x = 1000 + 640

# It finds the sprites' size by itself.
mob = Mob("pig", screen_x, GROUND)
led, field, _ = play(Scene(WORLD, [mob]), ["pig"], 6.0)
check("finds how big sprites show", field.bank.scale is not None and abs(field.bank.scale - SCALE) < 0.12, field.bank.scale)

# A clean kill. It dies, the drop lands, I walk over it and pick it up.
mob = Mob("pig", screen_x, GROUND, dies=8.0)
scene = Scene(WORLD, [mob], [Drop(ICON_A, screen_x + 10, GROUND + 6, 8.1, picked=11.0)])
led, field, cost = play(scene, ["pig"], 14.0, [(8.0, ("exp", XP["pig"])), (11.05, ("pick", "Pig's Ribbon", 1))], scale=SCALE)
check("clean kill: tied to the monster by its spot", len(spot_credits(led, "pig")) == 1, ([(c.species, c.name, c.how) for c in led.credits], led.summary(), led.untied, len(led.loots)))
check("clean kill: counts for the rate", led.kills_counted["pig"] == 1 and "pig" in led.rates(), (led.summary(), led.rates()))
print(f"   one look takes {cost * 1000:.0f} ms (a look every {1000 / FPS:.0f} ms)")

# The same, with the view scrolling all the while: the spot must stay the spot.
mob = Mob("pig", screen_x, GROUND, dies=8.0)
pan = lambda t: (1000.0 + 90 * np.sin(t * 0.8), 300.0 + 8 * np.sin(t * 1.3))
scene = Scene(WORLD, [mob], [Drop(ICON_A, screen_x + 10, GROUND + 6, 8.1, picked=11.0)], camera=pan)
led, field, _ = play(scene, ["pig"], 14.0, [(8.0, ("exp", XP["pig"])), (11.05, ("pick", "Pig's Ribbon", 1))], scale=SCALE)
check("scrolling view: tied to the monster by its spot", len(spot_credits(led, "pig")) == 1, ([(c.species, c.name, c.how) for c in led.credits], led.summary(), led.untied, len(led.loots)))
drift = abs(field.camera.x * VIEW_H / fw.WORK_H - (pan(13.875)[0] - pan(0)[0]))
check("scrolling view: camera error stays small", drift <= 6, drift)

# Two different monsters dying on top of each other: no credit, both skipped.
a = Mob("pig", screen_x, GROUND, dies=8.0, reach=15)
b = Mob("green_mushroom", screen_x + 30, GROUND, dies=8.3, reach=15)
scene = Scene(WORLD, [a, b], [Drop(ICON_A, screen_x + 15, GROUND + 6, 8.4, picked=11.0)])
led, field, _ = play(scene, ["pig", "green_mushroom"], 14.0,
                     [(8.0, ("exp", XP["pig"])), (8.3, ("exp", XP["green_mushroom"])), (11.05, ("pick", "Pig's Ribbon", 1))], scale=SCALE)
check("different monsters together: no credit", not [c for c in led.credits if not c.void], ([(c.species, c.name) for c in led.credits], led.summary()))

# Two different monsters far apart: each kept separately.
a = Mob("pig", screen_x - 350, GROUND, dies=8.0)
b = Mob("green_mushroom", screen_x + 350, GROUND, dies=8.2)
scene = Scene(WORLD, [a, b], [Drop(ICON_A, screen_x - 340, GROUND + 6, 8.1, picked=11.0)])
led, field, _ = play(scene, ["pig", "green_mushroom"], 14.0,
                     [(8.0, ("exp", XP["pig"])), (8.2, ("exp", XP["green_mushroom"])), (11.05, ("pick", "Pig's Ribbon", 1))], scale=SCALE)
check("different monsters far apart: goes to the right one", len(spot_credits(led, "pig")) == 1 and "green_mushroom" not in led.drop_list(), (led.drop_list(), led.summary()))

# Another player's kill of the same monster: on the list, not the rate.
mob = Mob("pig", screen_x, GROUND, dies=8.0)
scene = Scene(WORLD, [mob], [Drop(ICON_A, screen_x + 10, GROUND + 6, 8.1, picked=11.0)])
led, field, _ = play(scene, ["pig"], 14.0, [(11.05, ("pick", "Pig's Ribbon", 1))], scale=SCALE)
check("another player's kill: on the list", len(spot_credits(led, "pig")) == 1, (led.drop_list(), led.summary()))
check("another player's kill: not on the rate", not led.rates(), led.rates())

# Left on the ground: the kill's out of the rate.
mob = Mob("pig", screen_x, GROUND, dies=8.0)
scene = Scene(WORLD, [mob], [Drop(ICON_A, screen_x + 10, GROUND + 6, 8.1)])
led, field, _ = play(scene, ["pig"], 14.0, [(8.0, ("exp", XP["pig"]))], scale=SCALE)
check("left on the ground: seen as a drop", any(lo.deaths for lo in led.loots), len(led.loots))
check("left on the ground: kill's out of the rate", led.skipped["left"] == 1 and not led.rates(), (led.skipped, led.rates()))

# A kill that dropped nothing is still a kill.
mob = Mob("pig", screen_x, GROUND, dies=8.0)
led, field, _ = play(Scene(WORLD, [mob]), ["pig"], 14.0, [(8.0, ("exp", XP["pig"]))], scale=SCALE)
check("dropped nothing: still counted", led.kills_counted["pig"] == 1 and not led.loots, (led.kills_counted, [(round(lo.x), round(lo.y), lo.t) for lo in led.loots][:8], led.summary()))

# A monster that stands still from the start gets learned into the scenery. When it dies, what shows
# where it stood mustn't look like a drop. Tried with a small monster, the size of an icon.
mob = Mob("snail", screen_x, GROUND, dies=9.0, walks=0, reach=0)
led, field, _ = play(Scene(WORLD, [mob]), ["snail"], 15.0, [(9.0, ("exp", XP["snail"]))], scale=SCALE)
check("stood still, then died: no drop made up", led.kills_counted["snail"] == 1 and not led.loots, (led.summary(), [(round(lo.x), round(lo.y), lo.t) for lo in led.loots][:5]))

# ...and when one that stood still does drop something, it's still seen.
mob = Mob("snail", screen_x, GROUND, dies=9.0, walks=0, reach=0)
scene = Scene(WORLD, [mob], [Drop(ICON_A, screen_x + 40, GROUND + 4, 9.1, picked=12.0)])
led, field, _ = play(scene, ["snail"], 16.0, [(9.0, ("exp", XP["snail"])), (12.05, ("pick", "Pig's Ribbon", 1))], scale=SCALE)
check("stood still, then dropped: tied by its spot", len(spot_credits(led, "snail")) == 1, ([(c.species, c.name, c.how) for c in led.credits], led.summary(), led.untied, len(led.loots)))

# I'm standing right on it when I pick it up.
mob = Mob("pig", screen_x, GROUND, dies=8.0)
stand = lambda t: (screen_x + 10, GROUND - 10) if t >= 10.5 else (screen_x + 300, GROUND - 10)
scene = Scene(WORLD, [mob], [Drop(ICON_A, screen_x + 10, GROUND + 6, 8.1, picked=11.0)], player=stand)
led, field, _ = play(scene, ["pig"], 15.0, [(8.0, ("exp", XP["pig"])), (11.05, ("pick", "Pig's Ribbon", 1))], scale=SCALE)
check("standing on it at the pickup: tied by its spot", len(spot_credits(led, "pig")) == 1, ([(c.species, c.name, c.how) for c in led.credits], led.summary(), led.untied, len(led.loots)))

# A skill's flash over the whole screen for a moment mustn't lose the place.
mob = Mob("pig", screen_x, GROUND, dies=8.0)
scene = Scene(WORLD, [mob], [Drop(ICON_A, screen_x + 10, GROUND + 6, 8.1, picked=11.0)])
plain = scene.frame
scene.frame = lambda t: np.clip(plain(t).astype(np.int16) + (90 if 7.8 <= t < 8.05 else 0), 0, 255).astype(np.uint8)
led, field, _ = play(scene, ["pig"], 14.0, [(8.0, ("exp", XP["pig"])), (11.05, ("pick", "Pig's Ribbon", 1))], scale=SCALE)
check("a flash on screen: still tied by its spot", len(spot_credits(led, "pig")) == 1 and field.resets == 1, ([(c.species, c.name, c.how) for c in led.credits], led.summary(), field.resets, len(led.loots)))

# The player walking about, and scenery blinking, aren't drops.
mob = Mob("pig", screen_x - 300, GROUND)
walk = lambda t: (screen_x + 220 * np.sin(t * 0.9), GROUND - 10)
led, field, _ = play(Scene(WORLD, [mob], player=walk, blinker=(int(screen_x + 330), int(GROUND - 180))), ["pig"], 16.0, scale=SCALE)
check("the player and blinking scenery aren't drops", len(led.loots) == 0, [(round(lo.x), round(lo.y), lo.t) for lo in led.loots][:8])

# A monster walking out of view hasn't died.
mob = Mob("pig", screen_x, GROUND, walks=260, reach=900)
led, field, _ = play(Scene(WORLD, [mob]), ["pig"], 14.0, scale=SCALE)
check("walking out of view isn't dying", not [d for d in led.deaths if not d.void], [(d.x, d.t) for d in led.deaths])

print(f"\n{failures} failed" if failures else "\nAll passed")
sys.exit(1 if failures else 0)
