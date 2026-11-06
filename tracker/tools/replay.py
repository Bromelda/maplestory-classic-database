"""Runs the drop scanner over a recording of the game, instead of the live game, and shows what it saw.
This is how to find out how well it really works, and to tune it.

    python tools/replay.py                                   every clip the tracker has saved
    python tools/replay.py <a clip>.avi [--out seen.mp4]     one of them, with a video of what it saw
    python tools/replay.py other.mp4 --map "The Land of Wild Boar II" [--out seen.mp4] [--gh 10]

The tracker saves its own clips, with what it read from the message stack beside them. For a video from
anything else (OBS, Xbox Game Bar), at the game window's size, it reads the message lines from the video
the same way the live tracker does. The output video has green boxes on monsters being followed, red on
those that vanished, cyan on drops being watched, orange on drops that left the ground.
"""
import argparse
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import cv2

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from fieldwatch import FieldWatch  # noqa: E402
from lootwatch import DropLedger  # noqa: E402
from scandata import GameData  # noqa: E402
from dropscan import SCAN_POLL, feed  # noqa: E402
from linecount import LineCounter  # noqa: E402


def replay_clip(path, out_path=None, setup=None):
    """Runs one of the tracker's own clips through the scanner: (ledger, field, what the .json says).
    setup: called with the scanner first, to change something for this run."""
    path = Path(path)
    info = json.loads(path.with_suffix(".json").read_text(encoding="utf-8"))
    data = GameData(ROOT / "assets" / "scan_data.json")
    counter = LineCounter(data)
    counter.set_map(info["map"], 0.0)
    ledger = DropLedger(data, on_other=counter.other_kill)
    ledger.counter = counter
    ledger.set_map(info["map"])
    field = FieldWatch(ledger, ROOT / "assets" / "mob", data, scale=info.get("scale"))
    field.set_species(data.species_on(info["map"]))
    if setup:
        setup(field)
    events = list(info.get("events", []))

    def said(upto):
        while events and events[0]["t"] <= upto:
            e = events.pop(0)
            feed(ledger, [SimpleNamespace(**x) for x in e.get("lines", [])], e.get("found", []), e["t"], counter)

    cap, out, t = cv2.VideoCapture(str(path)), None, 0.0
    for t in info["times"]:
        ok, frame = cap.read()
        if not ok:
            break
        said(t)
        field.look(frame, t)
        ledger.tick(t)
        if out_path:
            pic = field.picture()
            if pic is not None:
                if out is None:
                    out = cv2.VideoWriter(str(out_path), cv2.VideoWriter_fourcc(*"mp4v"), 1 / SCAN_POLL, (pic.shape[1], pic.shape[0]))
                out.write(pic)
    cap.release()
    said(float("inf"))
    for extra in range(0, 120):         # (time passes, so that everything gets decided)
        ledger.tick(t + extra)
    if out:
        out.release()
    return ledger, field, info


def show(ledger, field, data):
    print(f"\nSprite scale found: {field.bank.scale}, started over {field.resets - 1} times")
    print(f"Monsters seen to vanish: {ledger.vanished_seen}, drops seen landing: {ledger.drops_seen}")
    print(ledger.summary_line())
    print("Skipped because:", dict(ledger.skipped))
    print("Drop list:", {data.name_of(s): dict(c) for s, c in ledger.drop_list().items()})
    print("New for the database:", {data.name_of(s): v for s, v in ledger.new_drops().items()})
    print("Rates:", {data.name_of(s): v for s, v in ledger.rates().items()})
    print("Pickups not tied to anything:", ledger.untied)
    if getattr(ledger, "counter", None):
        print("From the lines:", ledger.counter.results(float("inf")))


def all_clips(folder):
    clips = sorted(Path(folder).glob("clip-*.avi"))
    if not clips:
        sys.exit(f"No clips in {folder}")
    for clip in clips:
        if not clip.with_suffix(".json").exists():
            print(f"{clip.name}: wasn't finished")
            continue
        ledger, _, info = replay_clip(clip)
        print(f"{clip.name}  {info['map']}, {info['times'][-1]:.0f} s: vanished {ledger.vanished_seen}, landed {ledger.drops_seen}, "
              f"untied {len(ledger.untied)}. {ledger.summary_line()}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video", nargs="?", help="a video. Without one: every clip the tracker has saved")
    ap.add_argument("--map", help="the map's name, as in the database (not needed for the tracker's clips)")
    ap.add_argument("--out", help="write a video of what it saw")
    ap.add_argument("--gh", type=float, default=None, help="the game's digit height (1080p: about 10). Without it, no message lines are read.")
    args = ap.parse_args()
    if not args.video:
        all_clips(Path(os.environ.get("APPDATA", ".")) / "MapleEXP" / "drops" / "clips")
        return
    data = GameData(ROOT / "assets" / "scan_data.json")
    if Path(args.video).with_suffix(".json").exists():
        ledger, field, info = replay_clip(args.video, args.out)
        print(f"{info['map']}, {info['times'][-1]:.0f} s, {len(info['times'])} frames.\nLive at the end of this clip: {info.get('live')}")
        show(ledger, field, data)
        return
    if not args.map:
        sys.exit("For a video from something else, say which map it is with --map")
    found = data.find_map(args.map)
    if not found:
        sys.exit(f"Don't know the map {args.map!r}")
    ledger = DropLedger(data)
    ledger.set_map(found)
    field = FieldWatch(ledger, ROOT / "assets" / "mob", data)
    field.set_species(data.species_on(found))
    print("Monsters here:", [data.name_of(s) for s in field.species])
    watcher = items = None
    if args.gh:
        import msgwatch as mw                   # (the tracker's own message reader)
        from itemwatch import ItemReader
        items = ItemReader(ROOT / "assets")
        watcher = mw.MessageWatcher(mw.Font(ROOT / "assets"), lambda band, right, s: items.is_line(band, right, s))
    cap = cv2.VideoCapture(args.video)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    step = max(1, round(fps * SCAN_POLL))
    out, frame_no, t = None, 0, 0.0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frame_no += 1
        t = frame_no / fps
        if watcher:                             # (the messages are looked at more often than the field)
            if frame_no % max(1, round(fps * 0.1)) == 0:
                h, w = frame.shape[:2]
                x, y, ww, hh = mw.stack_area((0, 0, w, h), args.gh)
                for line in watcher.look(frame[y:y + hh, x:x + ww], args.gh, t):
                    print(f"{t:7.2f}  line: {line.kind} {line.amount}")
                    if line.kind == "exp":
                        ledger.exp(line.amount, line.born)
                    elif line.kind == "bonus":
                        ledger.party_exp(line.born)
                    elif line.kind == "mesos":
                        ledger.pickup("mesos", line.amount, "", t)
                    elif line.kind == "text" and line.colour == "white" and line.band is not None:
                        got = items.read(line.band, line.span, args.gh / mw.GH0)
                        if got and got[0] == "item":
                            print(f"{t:7.2f}  item: {got[1:]}")
                            ledger.pickup(got[1], got[2], got[3], t)
        if frame_no % step:
            continue
        field.look(frame, t)
        ledger.tick(t)
        if args.out:
            pic = field.picture()
            if pic is not None:
                if out is None:
                    out = cv2.VideoWriter(args.out, cv2.VideoWriter_fourcc(*"mp4v"), 1 / SCAN_POLL, (pic.shape[1], pic.shape[0]))
                out.write(pic)
    for extra in range(0, 120):
        ledger.tick(t + extra)
    if out:
        out.release()
    show(ledger, field, data)


if __name__ == "__main__":
    main()
