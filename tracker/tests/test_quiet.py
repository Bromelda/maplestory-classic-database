"""The things that keep the tracker out of the way: starting by itself, tucking away once, the hotkeys, the view followed
with windows left open, and the "learned so far" lines. No game or window needed."""
import json
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace as NS
from unittest import mock

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import maple_exp  # noqa: E402
from dropscan import learned_lines  # noqa: E402
from fieldwatch import Camera  # noqa: E402

failures = 0


def check(name, ok, detail=""):
    global failures
    print(("PASS" if ok else "FAIL"), name, "" if ok else detail)
    failures += not ok


class Fake:
    """The parts of the App these use."""

    def __init__(self, **cfg):
        self.cfg = {"auto_start": True, "auto_tuck": True, "hud": True, "hotkeys": dict(maple_exp.DEFAULT_HOTKEYS), **cfg}
        self.reader = NS(mode="window", hwnd=1)
        self.tracker = NS(req=100)
        self.session = NS(started=False)
        self.recent = NS(add=lambda text: None)
        self.settings_win = None
        self.hud = NS(editing=False)
        self.card_off = False
        self.tucked_once = False
        self.status = NS(set=lambda text: None)
        self.hotkey_note = None
        self.root = object()
        self.began = self.toggled = 0

    def _begin(self):
        self.began += 1
        self.session.started = True

    def toggle_window(self):
        self.toggled += 1


def plat(front=True, own=False, tucked=False):
    return NS(game_in_front=lambda: front, own_window_in_front=lambda: own, window_tucked=lambda root: tucked)


settle = maple_exp.App._settle_in

a = Fake()
a.tracker.req = None
with mock.patch.object(maple_exp, "PLATFORM", plat()):
    settle(a)
    check("nothing happens before the EXP bar is read", a.began == 0 and a.toggled == 0)
    a.tracker.req = 100
    settle(a)
    check("then it starts by itself", a.began == 1)
    check("and tucks away", a.toggled == 1)
    settle(a)
    check("only once", a.began == 1 and a.toggled == 1)
    a.session.started = True            # (pressing Pause keeps this: a Pause isn't undone)
    settle(a)
    check("a pause stays a pause", a.began == 1)

a = Fake(auto_start=False, auto_tuck=False)
with mock.patch.object(maple_exp, "PLATFORM", plat()):
    settle(a)
    check("both can be turned off", a.began == 0 and a.toggled == 0)

a = Fake()
with mock.patch.object(maple_exp, "PLATFORM", plat(own=True)):
    settle(a)
    check("it stays while you're using it", a.toggled == 0 and not a.tucked_once and a.began == 1)
with mock.patch.object(maple_exp, "PLATFORM", plat(front=False)):
    settle(a)
    check("it stays while another program's in front", a.toggled == 0)
a.settings_win = NS(winfo_exists=lambda: True)
with mock.patch.object(maple_exp, "PLATFORM", plat()):
    settle(a)
    check("it stays while Settings is open", a.toggled == 0)
    a.settings_win = None
    settle(a)
    check("and goes when you've gone to the game", a.toggled == 1)

a = Fake()
maple_exp.App._hotkey(a, "window")
check("the window's hotkey", a.toggled == 1)
maple_exp.App._hotkey(a, "card")
check("the card's hotkey hides it", a.card_off is True)
check("for this run: the setting's untouched", a.cfg["hud"] is True)
maple_exp.App._hotkey(a, "card")
check("and shows it", a.card_off is False)
a.items_opened = 0
a.open_items = lambda: setattr(a, "items_opened", a.items_opened + 1)
maple_exp.App._hotkey(a, "items")
check("the Items window's hotkey", a.items_opened == 1)
check("every action has a name and a key", set(maple_exp.HOTKEY_ACTIONS) == set(maple_exp.DEFAULT_HOTKEYS))
for key in maple_exp.DEFAULT_HOTKEYS.values():
    check(f"{key} can't be typed in chat", maple_exp.parse_hotkey(key) and "+F" in key)

from platforms import hotkey_text, presses, to_register, typing_key  # noqa: E402
if sys.platform == "win32":
    from unittest import mock
    from platforms.windows import WindowsPlatform
    seen = []
    with mock.patch("os.startfile", seen.append, create=True), mock.patch("os.path.realpath", lambda p: "REAL:" + str(p)):
        WindowsPlatform.open_folder(None, "C:/folder")
    check("the folder's opened at its real path, not the Store Python's view of it", seen == ["REAL:C:/folder"], seen)
SHIFT = 0x4
for key, vk in (("0", 0x30), ("9", 0x39), ("7", 0x37), ("Z", 0x5A), ("F8", 0x77), ("Num0", 0x60), ("-", 0xBD), ("\\", 0xDC), ("Home", 0x24)):
    check(f"{key} can be a hotkey with no Shift", maple_exp.parse_hotkey(key) == (0, vk), maple_exp.parse_hotkey(key))
    check(f"pressing {key} gives its name", hotkey_text(False, False, False, vk) == key, hotkey_text(False, False, False, vk))
check("with Shift still works", maple_exp.parse_hotkey("Shift+F3") == (SHIFT, 0x72) and maple_exp.parse_hotkey("Ctrl+Alt+R") == (0x3, 0x52))
check("Shift alone or nonsense isn't a key", not maple_exp.parse_hotkey("Shift") and not maple_exp.parse_hotkey("Banana") and not maple_exp.parse_hotkey("Shift+Shift+1"))
check("Enter and the arrows can't be taken from the game", hotkey_text(False, False, False, 0x0D) is None and hotkey_text(False, False, False, 0x25) is None)
got = to_register({"start": (0, 0x30), "reset": (SHIFT, 0x71)})
check("a plain key also fires with Shift held down to attack", ("start", SHIFT, 0x30, False) in got and ("start", 0, 0x30, True) in got, got)
check("a Shift key isn't asked for twice", len([g for g in got if g[0] == "reset"]) == 1, got)
got = to_register({"start": (0, 0x30), "reset": (SHIFT, 0x30)})
check("a plain key doesn't take another hotkey's Shift version", [g for g in got if g[0] == "start"] == [("start", 0, 0x30, True)], got)
got = to_register({"start": (0, 0x30), "repot": (0, 0x77), "reset": (SHIFT, 0x71)}, held=True)
check("a shop's box gets its numbers, and other keys stay", {g[0] for g in got} == {"repot", "reset"}, got)
# Noticing a press. (The top bit: down now. The low bit: pressed since last asked.)
DOWN, TAPPED, UP = -32768, 1, 0
keys = to_register({"window": (0, 0x7A), "start": (SHIFT, 0x72), "reset": (0, 0xBB)})
down = set()
check("nothing pressed", presses(keys, {0x7A: UP, 0x72: UP, 0xBB: UP}, 0, down) == [])
check("a press fires", presses(keys, {0x7A: DOWN, 0x72: UP, 0xBB: UP}, 0, down) == ["window"])
check("held down, only the once", presses(keys, {0x7A: DOWN, 0x72: UP, 0xBB: UP}, 0, down) == [])
check("let go", presses(keys, {0x7A: UP, 0x72: UP, 0xBB: UP}, 0, down) == [])
check("pressed again, it fires again", presses(keys, {0x7A: DOWN, 0x72: UP, 0xBB: UP}, 0, down) == ["window"])
presses(keys, {0x7A: UP, 0x72: UP, 0xBB: UP}, 0, down)
check("a tap between checks isn't lost", presses(keys, {0x7A: TAPPED, 0x72: UP, 0xBB: UP}, 0, down) == ["window"])
check("a plain key with Shift held, attacking", presses(keys, {0x7A: DOWN, 0x72: UP, 0xBB: UP}, SHIFT, set()) == ["window"])
check("not with Ctrl", presses(keys, {0x7A: DOWN, 0x72: UP, 0xBB: UP}, 0x2, set()) == [])
check("Shift+F3 needs Shift", presses(keys, {0x7A: UP, 0x72: DOWN, 0xBB: UP}, 0, set()) == [])
check("and has it", presses(keys, {0x7A: UP, 0x72: DOWN, 0xBB: UP}, SHIFT, set()) == ["start"])
if sys.platform == "win32":
    import time as _time
    import platforms.windows as pw
    pressed, script = [], {"keys": {}}
    with mock.patch.object(pw, "_GetAsyncKeyState", lambda vk: script["keys"].get(vk, 0)), mock.patch.object(pw.WindowsHotkeys, "in_front", lambda self: script.get("front", True)):
        hk = pw.WindowsHotkeys(pressed.append)
        changes = []
        hk.on_change = lambda on, n: changes.append((on, n))
        hk.set({"window": "F11", "reset": "="})
        _time.sleep(0.1)
        script["keys"] = {0x7A: DOWN}
        _time.sleep(0.1)
        script["keys"] = {}
        _time.sleep(0.1)
        check("for real: a press comes through once", pressed == ["window"], pressed)
        check("it says the keys are on", (True, 2) in changes, changes)
        hk.pause(True)
        _time.sleep(0.05)
        script["keys"] = {0x7A: DOWN}
        _time.sleep(0.1)
        check("paused, nothing", pressed == ["window"], pressed)
        script["keys"] = {}
        hk.pause(False)
        hk.hold(True)
        _time.sleep(0.05)
        script["keys"] = {0xBB: DOWN}
        _time.sleep(0.1)
        check("a shop's box waiting: not a plain typing key", pressed == ["window"], pressed)
        script["keys"] = {}
        hk.hold(False)
        _time.sleep(0.05)
        script["front"] = False
        _time.sleep(0.35)
        script["keys"] = {0x7A: DOWN}
        _time.sleep(0.1)
        check("another program in front: nothing", pressed == ["window"], pressed)
        script["keys"], script["front"] = {}, True
        _time.sleep(0.35)
        hk.set({})
        _time.sleep(0.05)

check("what counts as typing", typing_key(0x30) and typing_key(0x60) and typing_key(0xBD) and not typing_key(0x77) and not typing_key(0x24))

with tempfile.TemporaryDirectory() as folder:
    path = Path(folder) / "config.json"
    path.write_text(json.dumps({"hotkeys": {"start": "Shift+1", "reset": "Ctrl+R", "repot": "", "edit": "Shift+5", "window": "0", "card": "9"}}), encoding="utf-8")
    with mock.patch.object(maple_exp, "CONFIG_PATH", path):
        keys = maple_exp.load_config()["hotkeys"]
    check("old default keys move to the new ones", keys["start"] == "Shift+F3" and keys["edit"] == "Shift+F5", keys)
    check("one you chose stays", keys["reset"] == "Ctrl+R", keys)
    check("one you turned off stays off", keys["repot"] == "", keys)
    check("plain keys you chose stay", keys["window"] == "0" and keys["card"] == "9", keys)
    check("the new ones arrive", keys["items"] == "Shift+F7", keys)


# The view, with windows left open that don't move with the world.
rng = np.random.default_rng(5)
world = cv2.resize(rng.integers(0, 255, (500, 1500), dtype=np.uint8), (6000, 2000), interpolation=cv2.INTER_CUBIC)
world = cv2.GaussianBlur(world, (5, 5), 0)
windows = [(160, 20, 180, 240), (345, 10, 180, 130), (700, 30, 200, 160), (640, 350, 140, 110)]


def frame(x, y, w=960, h=540):
    f = world[y:y + h, x:x + w].copy()
    for wx, wy, ww, wh in windows:
        f[wy:wy + wh, wx:wx + ww] = 40 + (np.indices((wh, ww)).sum(0) % 37)     # (detailed, like a window full of icons)
    return f


cam, x, y, wrong, trusted = Camera(), 2000, 700, 0, 0
cam.update(frame(x, y))
path = [(11, 0)] * 12 + [(0, 0)] * 6 + [(-7, 3)] * 12 + [(38, -6)] * 5 + [(0, 0)] * 5
for dx, dy in path:
    x, y = x + dx, y + dy
    known = cam.update(frame(x, y))
    trusted += known
    wrong += known and (round(cam.x), round(cam.y)) != (2000 - x, 700 - y) and (round(cam.x), round(cam.y)) != (x - 2000, y - 700)
check("the view's followed with windows open", trusted == len(path), f"{trusted} of {len(path)}")
check("and it's right", wrong == 0, f"{wrong} wrong, ended at {cam.x},{cam.y} for {x - 2000},{y - 700}")
slow, x, y, wrong = Camera(), 2000, 700, 0
slow.update(frame(x, y))
for dx, dy in [(1, 0)] * 15 + [(2, 0)] * 15 + [(0, 1)] * 6 + [(-3, 0)] * 10:     # (ten looks a second: small moves)
    x, y = x + dx, y + dy
    slow.update(frame(x, y))
check("small moves are followed too", abs(abs(slow.x) - abs(x - 2000)) <= 2 and abs(abs(slow.y) - abs(y - 700)) <= 2, (slow.x, slow.y, x - 2000, y - 700))
cam2 = Camera()
cam2.update(frame(2000, 700))
check("staying put is staying put", cam2.update(frame(2000, 700)) and (cam2.x, cam2.y) == (0, 0), (cam2.x, cam2.y))
lost = Camera()
lost.update(frame(2000, 700))
other = cv2.GaussianBlur(rng.integers(0, 255, (540, 960), dtype=np.uint8), (5, 5), 0)
check("a different picture altogether isn't trusted", not lost.update(other))


why = {"party": "in a party", "camera": "the view jumped"}
check("nothing yet", learned_lines([], why) == ["Learned so far: nothing yet"])
text = learned_lines([{"kills": {"Pig": 40, "Slime": 3}, "skipped": {"party": 9, "camera": 2}},
                      {"kills": {"Pig": 10}, "skipped": {"party": 1}}], why)
check("sessions add up", "53 kills counted" in text[0] and "in a party (10)" in text[0] and "the view jumped (2)" in text[0], text)
check("monsters show how far they've got", "Pig 50 of 200" in text[1] and "Slime 3 of 200" in text[1], text)
check("mostly party says what would help", "alone" in text[-1], text)
check("not otherwise", "alone" not in " ".join(learned_lines([{"kills": {"Pig": 4}, "skipped": {"camera": 2}}], why)))

print(f"\n{failures} failed" if failures else "\nAll passed")
sys.exit(1 if failures else 0)
