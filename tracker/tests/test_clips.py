"""The scanner's clips (clips.py) and replaying them (tools/replay.py), on the same made-up footage as
test_fieldwatch.py. The main question: does a clip hold enough to see the same thing again?

Run it:  python tests/test_clips.py"""
import json
import shutil
import sys
import tempfile
import time
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))
import clips as clips_module  # noqa: E402
import cv2  # noqa: E402
import numpy as np  # noqa: E402
from clips import ClipKeeper  # noqa: E402
from dropscan import DropScan  # noqa: E402
from replay import replay_clip  # noqa: E402

# The made-up footage, from the top of test_fieldwatch.py (everything before its checks start).
source = (ROOT / "tests" / "test_fieldwatch.py").read_text(encoding="utf-8")
sim = {"__file__": str(ROOT / "tests" / "test_fieldwatch.py"), "__name__": "footage"}
exec(source[:source.index("# It finds the sprites")], sim)
Mob, Scene, Drop = sim["Mob"], sim["Scene"], sim["Drop"]
WORLD, ICON_A, GROUND, SCALE, SX, XP = sim["WORLD"], sim["ICON_A"], sim["GROUND"], sim["SCALE"], sim["screen_x"], sim["XP"]
MAP = "A Hill West of Henesys"
ITEM = "Pig's Ribbon"
failures = 0


def check(name, ok, detail=""):
    global failures
    print(("PASS " if ok else "FAIL ") + name + (f"   {detail}" if detail and not ok else ""))
    failures += not ok


def line(kind, amount, born):
    return SimpleNamespace(kind=kind, amount=amount, born=born)


def wait_for(ok, seconds=10.0):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if ok():
            return True
        time.sleep(0.05)
    return ok()


def spot(ledger):
    return [c for c in ledger.credits if not c.void and c.how == "spot" and c.species == "pig" and c.name == ITEM]


def play(folder, deaths, seconds):
    """A session in DropScan: pigs die at the given times, each drop is picked up 3 seconds later."""
    (folder / "sprite_sizes.json").parent.mkdir(parents=True, exist_ok=True)
    (folder / "sprite_sizes.json").write_text(json.dumps({"720": SCALE}), encoding="utf-8")
    scan = DropScan(ROOT / "assets", folder)
    scan.map_seen(MAP, 0.0)
    scan.field.icons.add(ITEM, *sim["RAW_ICON_A"])
    mobs = [Mob("pig", SX - 300 + 300 * i, GROUND, dies=d) for i, d in enumerate(deaths)]
    drops = [Drop(ICON_A, m.x0 + 10, GROUND + 6, m.dies + 0.1, picked=m.dies + 3.0) for m in mobs]
    scene = Scene(WORLD, mobs, drops)
    waiting = sorted([(m.dies, "exp") for m in mobs] + [(m.dies + 3.05, "pick") for m in mobs])
    t = 0.0
    while t < seconds:
        while waiting and waiting[0][0] <= t:
            _, what = waiting.pop(0)
            if what == "exp":
                scan.heard([line("exp", XP["pig"], t)], [], t)
            else:
                scan.heard([], [("item", ITEM, 1, "Etc")], t)
        scan.look(scene.frame(t), t)
        t += 0.125
    return scan, t


base = Path(tempfile.mkdtemp(prefix="clips"))
try:
    # ---------- the whole way: a live session, its clips, and seeing the same thing again ----------
    folder = base / "session"
    scan, end = play(folder, [18.0, 60.0], 80.0)
    for extra in range(0, 120):
        scan.ledger.tick(end + extra)
    live = spot(scan.ledger)
    check("the live run saw both kills' drops", len(live) == 2, ([(c.species, c.name, c.how) for c in scan.ledger.credits], scan.ledger.summary()))
    scan.finish()
    made = sorted((folder / "clips").glob("clip-*.avi"))
    check("kills far apart make separate clips", len(made) == 2, made)
    check("nothing was kept from the quiet parts", sum(p.stat().st_size for p in made) > 0 and all(
        json.loads(p.with_suffix(".json").read_text(encoding="utf-8"))["times"][-1] <= 30 for p in made))
    info = json.loads(made[0].with_suffix(".json").read_text(encoding="utf-8"))
    check("the .json has the map and sprite size", info["map"] == MAP and info["scale"] == SCALE, info["map"])
    check("the clip starts before the kill", 8.5 <= 18.0 - (info["times"][0]) and info["times"][0] == 0.0)
    # (times start from the clip's first frame, so the kill is around BEFORE seconds in)
    exp_at = [e["t"] for e in info["events"] if e["lines"]]
    check("the EXP line is in the clip, with its time", len(exp_at) == 1 and 9.0 <= exp_at[0] <= 10.5, exp_at)
    check("the pickup is in the clip", any(e["found"] for e in info["events"]), info["events"])
    check("the frame times are kept", len(info["times"]) > 60 and abs(info["times"][1] - 0.25) < 0.01, info["times"][:3])
    cap = cv2.VideoCapture(str(made[0]))
    frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    ok, first = cap.read()
    cap.release()
    check("the video opens, with every frame", ok and frames == len(info["times"]) and first.shape[:2] == (720, 1280), (ok, frames, len(info["times"])))
    print(f"   {made[0].stat().st_size / 1024 / 1024 / info['times'][-1]:.1f} MB per second of clip at 1280x720")

    for k, clip in enumerate(made):
        ledger, field, _ = replay_clip(clip, setup=lambda f: f.icons.add(ITEM, *sim["RAW_ICON_A"]))
        found = spot(ledger)
        check(f"replaying clip {k + 1} sees its drop by the spot, as the live run did", len(found) == 1 and ledger.kills_counted["pig"] == 1,
              ([(c.species, c.name, c.how) for c in ledger.credits], ledger.summary(), ledger.vanished_seen, ledger.drops_seen, ledger.untied))
        check(f"...and starts knowing the sprite size", field.bank.scale == SCALE, field.bank.scale)
    out = base / "seen.mp4"
    replay_clip(made[0], out)
    check("the replay can draw what it saw", out.exists() and out.stat().st_size > 0)

    # Kills close together stay in one clip.
    folder = base / "close"
    scan, _ = play(folder, [15.0, 22.0], 35.0)
    scan.finish()
    made = sorted((folder / "clips").glob("clip-*.avi"))
    check("kills close together share a clip", len(made) == 1, made)
    check("...and it holds both", len([e for e in json.loads(made[0].with_suffix(".json").read_text(encoding="utf-8"))["events"] if e["lines"]]) == 2)

    # ---------- the keeper by itself ----------
    pic = np.random.default_rng(1).integers(0, 255, (120, 160, 3), dtype=np.uint8)

    def feed_frames(keeper, start, seconds):
        t = start
        while t < start + seconds:
            keeper.frame(pic, t)
            t += 0.125
        return t

    # Nothing happens: nothing's written, and memory holds only the last BEFORE seconds.
    k = ClipKeeper(base / "quiet")
    feed_frames(k, 0.0, 30.0)
    check("no kills, no clips", not (base / "quiet").exists() and k.thread is None)
    check("memory holds only the last few seconds", len(k.ring) <= clips_module.BEFORE * 8 + 1, len(k.ring))
    k.finish()

    # A long fight becomes several clips, each with its own lead-in.
    k = ClipKeeper(base / "long", lambda: {"map": "x"})
    t = feed_frames(k, 0.0, 12.0)
    for _ in range(26):                 # (a kill every 10 seconds, for 260 seconds)
        k.mark(t)
        t = feed_frames(k, t, 10.0)
    k.finish()
    long_clips = sorted((base / "long").glob("clip-*.avi"))
    check("a long fight is split up", len(long_clips) >= 2, long_clips)
    longest = max(json.loads(p.with_suffix(".json").read_text(encoding="utf-8"))["times"][-1] for p in long_clips)
    check("no clip runs past the longest", longest <= clips_module.LONGEST + clips_module.BEFORE + 1, longest)
    check("every clip has its .json", all(p.with_suffix(".json").exists() for p in long_clips))

    # The switch.
    k = ClipKeeper(base / "off")
    k.switch(False)
    k.frame(pic, 1.0)
    k.mark(1.0)
    k.frame(pic, 1.1)
    check("switched off, it keeps nothing", not k.ring and k.name is None and k.thread is None)
    k.switch(True)
    k.frame(pic, 2.0)
    k.mark(2.0)
    check("switched on again, it works", k.name is not None)
    k.switch(False)
    check("switching off closes an open clip", k.name is None)
    check("...and it gets written", wait_for(lambda: list((base / "off").glob("clip-*.json"))))
    k.finish()

    # A clip stays open only while frames come in (tracking stopped, game minimized).
    saved = clips_module.IDLE
    clips_module.IDLE = 0.2
    k = ClipKeeper(base / "idle")
    feed_frames(k, 0.0, 2.0)
    k.mark(2.0)
    check("a clip closes when frames stop coming", wait_for(lambda: k.name is None and list((base / "idle").glob("clip-*.json"))))
    clips_module.IDLE = saved
    k.finish()

    # A window size change, and a map change.
    k = ClipKeeper(base / "size")
    feed_frames(k, 0.0, 2.0)
    k.mark(2.0)
    k.frame(np.zeros((240, 320, 3), np.uint8), 2.2)
    check("a new window size closes the clip", k.name is None and k.shape == (240, 320, 3), k.name)
    k.finish()
    check("...and the video is whole", len(list((base / "size").glob("clip-*.json"))) == 1)
    k = ClipKeeper(base / "map")
    feed_frames(k, 0.0, 2.0)
    k.cut()
    check("a new map forgets the frames from the old one", not k.ring)
    k.finish()

    # The oldest go first, past the limit, and only clips are touched.
    folder = base / "trim"
    folder.mkdir()
    (folder / "keep-me.avi").write_bytes(b"x" * 100)
    for n in range(4):
        (folder / f"clip-{n}.avi").write_bytes(b"x" * 1000)
        (folder / f"clip-{n}.json").write_text("{}")
        time.sleep(0.02)
    saved = clips_module.KEEP_BYTES
    clips_module.KEEP_BYTES = 2500
    ClipKeeper(folder)._trim(folder / "clip-3.avi")
    clips_module.KEEP_BYTES = saved
    left = sorted(p.name for p in folder.glob("*.avi"))
    check("the oldest clips are deleted past the limit", left == ["clip-2.avi", "clip-3.avi", "keep-me.avi"], left)
    check("...with their .json", not (folder / "clip-0.json").exists() and (folder / "clip-2.json").exists())

    # A folder it can't write to loses the clip, not the tracker.
    blocked = base / "blocked"
    blocked.write_text("a file where the folder should be")
    k = ClipKeeper(blocked)
    feed_frames(k, 0.0, 1.0)
    k.mark(1.0)
    feed_frames(k, 1.0, 1.0)
    check("a folder it can't write to is noted", wait_for(lambda: k.problem), k.problem)
    k.finish()
finally:
    shutil.rmtree(base, ignore_errors=True)

print(f"\n{failures} failed" if failures else "\nAll passed")
sys.exit(1 if failures else 0)
