"""Puts the drop scanner together: the field watcher, the rules, and the files it leaves behind.

The tracker hands it pictures of the game window and the lines it read from the message stack. It keeps
everything on this PC, in the data folder's "drops" folder:

    session-<when>.json     what one play session found (tools/drop_report.py adds them all up)
    log.jsonl               every drop tied to a monster, one per line, as it happened
    pictures/               what each of those looked like on the ground, to check by eye
    clips/                  short videos around kills, for finding out why it got something wrong (clips.py).
                            There's a switch for these in Settings.
"""
import json
import re
import threading
import time
from collections import Counter, deque
from pathlib import Path

import cv2

from clips import ClipKeeper
from fieldwatch import FieldWatch
from linecount import SKIPPED as LINE_SKIPPED, LineCounter
from lootwatch import WHY, DropLedger
from scandata import SCANNER_VERSION, GameData

SAVE_EVERY = 30.0           # seconds
SCAN_POLL = 0.1             # how often to look at the field
CLIP_EVERY = 0.2            # how often a look goes in a clip. Each is over a megabyte, and clips don't need them all
NEED_KILLS = 200            # kills of a monster before its rates can go on the site (as in tools/publish_drops.py)
LEARNED_SECONDS = 30.0      # how often the "learned so far" lines are added up again


def next_look(due, now, every=SCAN_POLL):
    """When the next look is due: on a steady beat, so a slow look's made up for by the quick ones after it, unless it's
    fallen far behind (the PC's busy): then it starts again from now, rather than rushing to catch up."""
    due += every
    return due if due >= now - 3 * every else now


def line_lines(sessions, need=NEED_KILLS, kept=3):
    """What the message lines have added up to, every session so far: lines for the Reading tab."""
    solo, kills, listed, skipped = Counter(), Counter(), {}, Counter()
    for s in sessions:
        line = s.get("line") or {}
        solo.update(line.get("solo_kills") or {})
        kills.update(line.get("kills") or {})
        skipped.update(line.get("skipped") or {})
        for mob, items in (line.get("listed") or {}).items():
            for item, (got, n) in items.items():
                have = listed.setdefault(mob, {}).setdefault(item, [0, 0])
                have[0] += got
                have[1] += n
    if not solo and not skipped:
        return []
    out = [f"From the lines, alone: {sum(solo.values()):,} kills named"]
    if solo:
        out[0] += " (" + " · ".join(f"{mob} {n:,} of {need}" for mob, n in solo.most_common(kept)) + ")"
    found = [(mob, item, *m) for mob, items in listed.items() for item, m in items.items() if m[0]]
    found.sort(key=lambda f: -f[3])
    if found:
        out.append("Items only one kind here drops: " + " · ".join(f"{item} {got:,} in {n:,} {mob}" for mob, item, got, n in found[:kept]))
    if kills:
        out.append(f"In stretches of one kind: {sum(kills.values()):,} kills, with mesos and everything else counted too")
    return out


def learned_lines(sessions, reasons, need=NEED_KILLS, kept=3):
    """What every session so far adds up to, as lines for the Reading tab. sessions: their saved results. reasons: what
    each reason for skipping a kill means."""
    kills, skipped = Counter(), Counter()
    for s in sessions:
        kills.update(s.get("kills") or {})
        skipped.update(s.get("skipped") or {})
    from_lines = line_lines(sessions, need, kept)
    if not kills and not skipped:
        return from_lines or ["Learned so far: nothing yet"]
    out = from_lines + [f"Seen in the pictures: {sum(kills.values()):,} kills counted"]
    if skipped:
        top = ", ".join(f"{reasons.get(k, k)} ({n:,})" for k, n in skipped.most_common(kept))
        out[0] += f". Most often skipped: {top}"
    if kills:
        out.append(" · ".join(f"{name} {n:,} of {need}" for name, n in kills.most_common(kept)))
    if skipped and skipped.most_common(1)[0][0] == "party":
        out.append("Party kills don't count towards rates yet. Hunting alone is what teaches it the most.")
    return out


def _safe(text):
    return re.sub(r"[^A-Za-z0-9_-]+", "_", str(text))[:60]


def feed(ledger, lines, found, now, counter=None):
    """Tells the rules what the message stack said, and the line counter (linecount.py), if there is one. The live
    tracker and a replay of a clip both use this."""
    for line in lines:                  # (first, so a kill's own line knows it's a party)
        if line.kind == "bonus":
            ledger.party_exp(line.born)
            if counter:
                counter.party(line.born)
                counter.bonus_amount(line.amount, line.born)
    for line in lines:
        if line.kind == "exp" and line.amount is not None:
            ledger.exp(line.amount, line.born)
            if counter:
                counter.kill(line.amount, line.born)
    for p in found:
        if p[0] == "mesos":
            ledger.pickup("mesos", p[1], "", now)
            if counter:
                counter.pickup("mesos", p[1], now)
        elif p[0] == "item":
            ledger.pickup(p[1], p[2], p[3], now)
            if counter:
                counter.pickup(p[1], p[2], now)
        elif p[0] == "unread" and counter:
            counter.unread(now)


class DropScan:
    def __init__(self, assets, folder):
        self.assets, self.folder = Path(assets), Path(folder)
        self.data = GameData(self.assets / "scan_data.json")
        self.lock = threading.Lock()
        self.lines = LineCounter(self.data)
        self.ledger = DropLedger(self.data, on_credit=self._credited, on_other=self.lines.other_kill)
        self.field = FieldWatch(self.ledger, self.assets / "mob", self.data)
        self.map = None
        self.started = time.strftime("%Y%m%d-%H%M%S")
        self.saved_at = 0.0
        self.pictures = 0
        self.height = None              # the game window's height, at the last look
        self.scales = self._load_scales()
        self.clips = ClipKeeper(self.folder / "clips", self._clip_info)
        self.happened = 0               # monsters seen to vanish and drops seen landing, at the last look
        self.gh_measured = None         # (for the clips: what the tracker measured the game's UI size as)
        self.lines_heard = 0
        self.learned_text, self.learned_at = None, 0.0
        self.clip_at = 0.0
        self.looks = deque(maxlen=50)   # when the latest looks were
        self.on_map = None              # told what can drop on a new map: (a set of item names)
        self.blind = False              # the minimap's name has been out of sight for a while: the map may have changed

    # ---------- what comes in ----------

    def map_seen(self, name, now):
        """The map's name as read off the screen."""
        found = self.data.find_map(name) if name else None
        if self.blind and found:
            with self.lock:
                self.blind = False
                self.lines.set_map(found, now)
        if found == self.map or (found is None and name):
            return                      # (a misread name isn't a new map)
        with self.lock:
            self.clips.cut()
            self.map = found
            self.ledger.set_map(found, now)
            self.lines.set_map(found, now)
            self.field.set_species(self.data.species_on(found) if found else [])
            if self.on_map:
                self.on_map({i for s in self.data.species_on(found) for i in self.data.drops_of(s)} if found else None)

    def map_lost(self, now):
        """The minimap's name has been out of sight for a while, so which map this is isn't certain. The lines' EXP can't name
        a monster without it: nothing counts until the name can be read again."""
        with self.lock:
            if not self.blind:
                self.blind = True
                self.lines.set_map(None, now)

    def map_lines(self):
        """What's known about this map, from the database, as lines of text."""
        with self.lock:
            blind, name = self.blind, self.map
            odd = [(a, n) for a, n in self.lines.odd_amounts.most_common(3) if n >= 3]
            only = len(self.lines._owners()) if name and not blind else 0
        if blind:
            return ["Can't see the map's name, so kills aren't counting. Open the minimap."]
        if not name:
            return ["Map not read yet. Kills start counting once the minimap's name can be read."]
        d, species = self.data, self.data.species_on(name)
        if not species:
            return [f"{name}: no monsters live here."]
        counts = d.counts_on(name)
        mobs = " · ".join(f"{d.name_of(s)} ({d.exp_of(s)} EXP{f', {counts[s]} here' if counts.get(s) else ''})" for s in species)
        out = [f"{name}: {mobs}"]
        same = {}
        for s in species:
            same.setdefault(d.exp_of(s), []).append(d.name_of(s))
        for names in same.values():
            if len(names) > 1:
                out.append(f"{' and '.join(names)} give the same EXP, so their kills can't be told apart.")
        if only:
            out.append(f"{only} items here are known from only one of these, so they can count in a mixed hunt.")
        if odd:
            out.append("EXP lines that fit nothing here: " + ", ".join(f"{a} ({n} times)" for a, n in odd))
        return out

    def heard(self, lines, found, now):
        """New message lines. lines: msgwatch.Line, for the EXP. found: pickups as read: ("mesos", amount)
        or ("item", name, qty, tab)."""
        with self.lock:
            self.lines_heard += len(lines)
            feed(self.ledger, lines, found, now, self.lines)
            said = [{"kind": x.kind, "amount": x.amount, "born": x.born} for x in lines if x.kind in ("exp", "bonus")]
            if said or found:
                self.clips.event({"lines": said, "found": [list(p) for p in found]}, now)
                if not self.ledger.in_party(now):
                    self.clips.mark(now)

    def exp_bar(self, gained, now):
        """The EXP bar's gone up: what the lines ought to add up to."""
        with self.lock:
            self.lines.exp_bar(gained, now)

    def mesos_seen(self, value, now, in_town=False):
        """The mesos count as read off the inventory, whenever it's open: the lines since it was last seen ought to add up
        to the difference."""
        with self.lock:
            # (A town, or anywhere with no monsters: not hunting, and maybe a shop.)
            self.lines.mesos_seen(value, now, in_town or bool(self.map and not self.data.species_on(self.map)))

    def away(self, now):
        """The game's not in front: nothing's being read."""
        with self.lock:
            self.lines.away(now)

    def meter_line(self, now):
        """How much of the lines are being read, and how often the field's being looked at, for the Reading tab."""
        with self.lock:
            text = self.lines.meter.line(now)
            looks = list(self.looks)
        if len(looks) >= 2 and now - looks[-1] < 2.0:
            text += f" · looking at the field {(len(looks) - 1) / (looks[-1] - looks[0]):.1f} times a second"
        return text

    def learned(self):
        """Every session so far, as lines of text."""
        now = time.monotonic()
        if self.learned_text is None or now - self.learned_at >= LEARNED_SECONDS:
            self.learned_at = now
            with self.lock:
                current = self.results()
            sessions = [current]
            for path in self.folder.glob("session-*.json"):
                if path.stem == f"session-{self.started}":
                    continue
                try:
                    s = json.loads(path.read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    continue
                if isinstance(s, dict) and s.get("version") == SCANNER_VERSION:
                    sessions.append(s)
            self.learned_text = learned_lines(sessions, WHY)
        return self.learned_text

    def look(self, frame, now):
        """A picture of the game window."""
        with self.lock:
            self.looks.append(now)
            self._sprite_size(frame.shape[0], now)
            if self.field.species:
                if not self.ledger.in_party(now) and now - self.clip_at >= CLIP_EVERY - 0.01:
                    self.clip_at = now
                    self.clips.frame(frame, now)        # (party play can't teach the rates: no clips of it, so they last)
                self.field.look(frame, now)
                self._remember_size(frame.shape[0])
                happened = self.ledger.vanished_seen + self.ledger.drops_seen
                if happened != self.happened:   # (the EXP line may never have been read: that's worth seeing)
                    self.happened = happened
                    self.clips.mark(now)
            self.ledger.tick(now)
        if now - self.saved_at >= SAVE_EVERY:
            self.saved_at = now
            self.save()

    # ---------- how big sprites show ----------
    # Working it out takes a few seconds, and a kill in that time can't have its drop seen. So it's
    # remembered, for each size of game window. A new window size means starting again.

    def _load_scales(self):
        try:
            got = json.loads((self.folder / "sprite_sizes.json").read_text(encoding="utf-8"))
            return {str(k): float(v) for k, v in got.items()}
        except (OSError, ValueError, TypeError, AttributeError):
            return {}

    def _sprite_size(self, height, now):
        if height == self.height:
            return
        if self.height is not None:
            self.ledger.close_all(now, "camera")
            self.field.start_again()
        self.height = height
        self.field.bank.scale = self.scales.get(str(height))

    def _remember_size(self, height):
        scale = self.field.bank.scale
        if scale is None or self.scales.get(str(height)) == scale:
            return
        self.scales[str(height)] = scale
        try:
            self.folder.mkdir(parents=True, exist_ok=True)
            (self.folder / "sprite_sizes.json").write_text(json.dumps(self.scales), encoding="utf-8")
        except OSError:
            pass

    # ---------- what goes out ----------

    def _clip_info(self):
        return {"map": self.map, "scale": self.field.bank.scale, "version_scanner": SCANNER_VERSION,
                "live": self.ledger.summary_line(), "gh_measured": self.gh_measured, "lines_heard": self.lines_heard}

    def keep_clips(self, on):
        with self.lock:
            self.clips.switch(on)

    def finish(self):
        """The tracker's closing."""
        self.save()
        with self.lock:
            self.clips.finish()

    def _credited(self, c):
        """A drop was tied to a monster (called from inside the ledger, the lock is held)."""
        entry = {"when": time.strftime("%Y-%m-%d %H:%M:%S"), "map": c.map, "monster": self.data.name_of(c.species),
                 "item": c.name, "qty": c.qty, "own_kill": c.own, "how": c.how, "new": c.new}
        try:
            self.folder.mkdir(parents=True, exist_ok=True)
            if c.picture is not None and self.pictures < 2000:
                folder = self.folder / "pictures"
                folder.mkdir(exist_ok=True)
                name = f"{self.started}-{self.pictures:04d}-{_safe(self.data.name_of(c.species))}-{_safe(c.name)}.png"
                ok, png = cv2.imencode(".png", c.picture)
                if ok:
                    (folder / name).write_bytes(png.tobytes())
                    entry["picture"] = name
                    self.pictures += 1
            with open(self.folder / "log.jsonl", "a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        except OSError:
            pass                        # (a full disk doesn't stop the tracker)

    def results(self):
        led, name = self.ledger, self.data.name_of
        return {"session": self.started, "version": SCANNER_VERSION, "map": self.map, "counted": led.summary()["counted"],
                "skipped": dict(led.skipped), "untied_pickups": len(led.untied), "tied_pickups": led.summary()["drops"],
                "drop_list": {name(s): dict(items) for s, items in led.drop_list().items()},
                "new_drops": {name(s): items for s, items in led.new_drops().items()},
                "kills": {name(s): n for s, n in led.kills_counted.items()},
                "rate_drops": {name(s): dict(c) for s, c in led.rate_drops.items()},
                "rate_mesos": {name(s): list(m) for s, m in led.rate_mesos.items()},
                "line": self.lines.results(time.monotonic())}

    def save(self):
        with self.lock:
            out = self.results()
        if not (out["counted"] or out["drop_list"] or out["skipped"] or out["line"]["skipped"] or out["line"]["solo_kills"]):
            return
        try:
            self.folder.mkdir(parents=True, exist_ok=True)
            path = self.folder / f"session-{self.started}.json"
            tmp = path.with_suffix(".tmp")
            tmp.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
            tmp.replace(path)
        except OSError:
            pass

    def status(self):
        """One line for the tracker's window."""
        with self.lock:
            if not self.field.species:
                return ("Drop scanner: waiting for a map with monsters" if self.map
                        else "Drop scanner: can't start until the map's name is read (needs Tesseract and the minimap open)")
            if self.field.bank.scale is None:
                return "Drop scanner: looking for monsters to learn their size"
            return "Drop scanner: " + self.ledger.summary_line()
