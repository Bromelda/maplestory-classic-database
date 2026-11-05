"""Keeps short videos of the game window around kills and pickups, so the scanner's mistakes can be seen,
replayed and fixed (tools/replay.py). Each clip has a .json beside it with what the live tracker knew: the
map, the sprite size, when each frame was taken, and the message lines it read. So a replay gets the same
facts the live run had, and only the field has to be watched again.

Recent frames are held in memory as JPEGs, so a clip can start before the thing that caused it. Everything
is written by its own thread, and a problem here only costs a clip: it never stops the tracker. Clips stay
on this PC, and the oldest are deleted once they use up KEEP_BYTES.
"""
import json
import queue
import threading
import time
from collections import deque
from pathlib import Path

import cv2
import numpy as np

BEFORE = 10.0               # seconds kept from before a kill (the replay needs them to learn the scenery)
AFTER = 10.0                # seconds kept after the last thing that happened
LONGEST = 120.0             # a clip's longest length. A long fight becomes several, and a crash loses only the last
IDLE = 4.0                  # seconds with no frames before a clip is closed (tracking stopped, or the game's hidden)
KEEP_BYTES = 5 * 1024 ** 3  # all clips together, at most
QUALITY = 90                # JPEG quality
NOMINAL_FPS = 8             # what a video player assumes. The real times are in the .json
MOST_WAITING = 400          # frames waiting to be written before new ones are skipped (a slow disk)


def _plain(value):
    return value.item() if isinstance(value, np.generic) else str(value)


class ClipKeeper:
    def __init__(self, folder, info=None):
        self.folder = Path(folder)
        self.info = info or dict        # (what goes in the .json about the session: map, scale, summary)
        self.on = True
        self.made = 0
        self.problem = None
        self.lock = threading.Lock()
        self.ring = deque()             # recent frames: (jpeg, time)
        self.recent = deque()           # recent events
        self.events = []                # the current clip's events
        self.name, self.started, self.until, self.shape = None, None, None, None
        self.last_info, self.last_frame = {}, 0.0
        self.number = 0
        self.q = queue.Queue()
        self.thread = None

    # ---------- what comes in (from the tracker's threads) ----------

    def frame(self, frame, now):
        if not self.on:
            return
        ok, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, QUALITY])
        if not ok:
            return
        with self.lock:
            self.last_frame = time.monotonic()
            if frame.shape != self.shape:       # (a new window size can't go in the same video)
                self._cut()
                self.shape = frame.shape
            self.ring.append((jpeg, now))
            self._forget(now)
            if self.name is None:
                if self.until is not None and now <= self.until:
                    self._start(now)
            elif now > self.until:
                self._end()
            elif now - self.started >= LONGEST:
                self._end()
                self._start(now)                # (starts with the frames before now, so it stands alone)
            elif self.q.qsize() < MOST_WAITING:
                self.q.put(("frame", jpeg, now))

    def event(self, what, now):
        """Something the live tracker read: {"lines": [...], "found": [...]}."""
        if not self.on:
            return
        with self.lock:
            entry = dict(what, t=now)
            self.recent.append(entry)
            if self.name is not None:
                self.events.append(entry)

    def mark(self, now):
        """Something worth seeing is happening: keep this stretch."""
        if not self.on:
            return
        with self.lock:
            self.until = now + AFTER
            if self.name is None and self.ring:
                self._start(now)

    def cut(self):
        """The map changed: what comes next has nothing to do with what's been kept."""
        with self.lock:
            self._cut()

    def switch(self, on):
        with self.lock:
            self.on = bool(on)
            if not self.on:
                self._cut()

    def finish(self):
        """The tracker's closing: writes out what's open."""
        with self.lock:
            self.on = False
            self._cut()
            thread, self.thread = self.thread, None
        if thread:
            self.q.put(("stop",))
            thread.join(15)

    # ---------- keeping track (the lock is held) ----------

    def _forget(self, now):
        while self.ring and now - self.ring[0][1] > BEFORE:
            self.ring.popleft()
        while self.recent and now - self.recent[0]["t"] > BEFORE:
            self.recent.popleft()

    def _cut(self):
        if self.name is not None:
            self._end()
        self.until = None
        self.ring.clear()
        self.recent.clear()

    def _start(self, now):
        self._forget(now)
        if not self.ring:
            return
        self.number += 1
        self.name = f"clip-{time.strftime('%Y%m%d-%H%M%S')}-{self.number:04d}"
        self.started = self.ring[0][1]
        first = self.ring[0][1]
        self.events = [e for e in self.recent if e["t"] >= first]
        self.last_info = self._info()
        if self.thread is None or not self.thread.is_alive():
            self.thread = threading.Thread(target=self._writer, daemon=True)
            self.thread.start()
        self.q.put(("start", self.name))
        for jpeg, t in self.ring:
            self.q.put(("frame", jpeg, t))

    def _end(self):
        self.q.put(("end", self.events, self._info() or self.last_info))
        self.name, self.events = None, []
        self.made += 1

    def _info(self):
        try:
            return self.info()
        except Exception:               # (read without the scanner's lock when closing an idle clip)
            return self.last_info

    # ---------- writing (its own thread) ----------

    def _writer(self):
        video, path, times = None, None, []
        while True:
            try:
                item = self.q.get(timeout=1.0)
            except queue.Empty:
                with self.lock:
                    if self.name is not None and time.monotonic() - self.last_frame > IDLE:
                        self._end()
                        self.until = None
                continue
            try:
                if item[0] == "stop":
                    return
                if item[0] == "start":
                    self.folder.mkdir(parents=True, exist_ok=True)
                    video, path, times = None, self.folder / f"{item[1]}.avi", []
                elif item[0] == "frame" and path is not None:
                    picture = cv2.imdecode(item[1], cv2.IMREAD_COLOR)
                    if video is None:
                        h, w = picture.shape[:2]
                        video = cv2.VideoWriter(str(path), cv2.CAP_OPENCV_MJPEG, cv2.VideoWriter_fourcc(*"MJPG"), NOMINAL_FPS, (w, h))
                        if not video.isOpened():
                            raise OSError(f"couldn't start {path.name}")
                        video.set(cv2.VIDEOWRITER_PROP_QUALITY, QUALITY)
                    video.write(picture)
                    times.append(item[2])
                elif item[0] == "end" and video is not None:
                    video.release()
                    self._sidecar(path, times, item[1], item[2])
                    self._trim(path)
                    video, path = None, None
            except (OSError, ValueError, TypeError, cv2.error) as e:
                self.problem = str(e)
                if video is not None:
                    video.release()
                video, path = None, None

    @staticmethod
    def _sidecar(path, times, events, info):
        first = times[0]
        kept = [dict(e, t=round(e["t"] - first, 3)) for e in events if e["t"] >= first]
        for e in kept:
            for line in e.get("lines", []):
                line["born"] = round(line["born"] - first, 3)
        out = dict(info, version=1, saved=time.strftime("%Y-%m-%d %H:%M:%S"), times=[round(t - first, 3) for t in times], events=kept)
        path.with_suffix(".json").write_text(json.dumps(out, ensure_ascii=False, default=_plain), encoding="utf-8")

    def _trim(self, newest):
        clips = sorted(self.folder.glob("clip-*.avi"), key=lambda p: p.stat().st_mtime)
        total = sum(p.stat().st_size for p in clips)
        for old in clips:
            if total <= KEEP_BYTES or old == newest:
                break
            total -= old.stat().st_size
            old.unlink(missing_ok=True)
            old.with_suffix(".json").unlink(missing_ok=True)
