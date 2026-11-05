"""Runs the tracker's message reader over its own clips, and writes down what it could and couldn't read.
For finding out why the EXP and pickup lines aren't being read.

    python tools/check_messages.py

It writes message_check.txt in the drops folder and changes nothing else.
"""
import os
import sys
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import msgwatch as mw  # noqa: E402

FOLDER = Path(os.environ.get("APPDATA", ".")) / "MapleEXP" / "drops"
CLIPS_TO_READ = 3


def check(clip, gh, say):
    watcher = mw.MessageWatcher(mw.Font(ROOT / "assets"))
    cap = cv2.VideoCapture(str(clip))
    fps_times = 0.0
    frames, with_rows, kinds, shown = 0, 0, {}, 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        fps_times += 0.2
        frames += 1
        h, w = frame.shape[:2]
        x, y, ww, hh = mw.stack_area((0, 0, w, h), gh)
        area = frame[y:y + hh, x:x + ww]
        rows, _ = watcher.rows(area, gh)
        if any(rows):
            with_rows += 1
        if shown < 6 and any(rows):
            shown += 1
            say(f"    frame {frames}: " + "; ".join(f"row {k}: {r.said} right={r.right} bright={r.bright:.2f} {r.colour}" for k, r in enumerate(rows) if r))
        for line in watcher.look(area, gh, fps_times):
            kinds[line.kind] = kinds.get(line.kind, 0) + 1
    cap.release()
    say(f"  gh {gh}: {frames} frames, {with_rows} with rows found, lines read: {kinds}, edge {watcher.edge}, peak {watcher.peak}")


def main():
    clips = sorted((FOLDER / "clips").glob("clip-*.avi"))[:CLIPS_TO_READ]
    if not clips:
        sys.exit(f"No clips in {FOLDER / 'clips'}")
    out = []

    def say(text):
        print(text)
        out.append(text)

    for clip in clips:
        say(clip.name)
        cap = cv2.VideoCapture(str(clip))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        cap.release()
        base = height / 2160 * mw.GH0        # (gh is 20 in a 4K game)
        for gh in (round(base, 2), round(base * 0.9, 2), round(base * 1.1, 2)):
            check(clip, gh, say)
    (FOLDER / "message_check.txt").write_text("\n".join(out) + "\n", encoding="utf-8")
    print(f"\nWrote {FOLDER / 'message_check.txt'}")


if __name__ == "__main__":
    main()
