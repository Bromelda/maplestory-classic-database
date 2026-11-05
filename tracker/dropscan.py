"""Puts the drop scanner together: the field watcher, the rules, and the files it leaves behind.

The tracker hands it pictures of the game window and the lines it read from the message stack. It keeps
everything on this PC, in the data folder's "drops" folder:

    session-<when>.json     what one play session found (tools/drop_report.py adds them all up)
    log.jsonl               every drop tied to a monster, one per line, as it happened
    pictures/               what each of those looked like on the ground, to check by eye

Those small crops are the only pictures it ever keeps.
"""
import json
import re
import threading
import time
from pathlib import Path

import cv2

from fieldwatch import FieldWatch
from lootwatch import DropLedger
from scandata import SCANNER_VERSION, GameData

SAVE_EVERY = 30.0           # seconds
SCAN_POLL = 0.125           # how often to look at the field


def _safe(text):
    return re.sub(r"[^A-Za-z0-9_-]+", "_", str(text))[:60]


class DropScan:
    def __init__(self, assets, folder):
        self.assets, self.folder = Path(assets), Path(folder)
        self.data = GameData(self.assets / "scan_data.json")
        self.lock = threading.Lock()
        self.ledger = DropLedger(self.data, on_credit=self._credited)
        self.field = FieldWatch(self.ledger, self.assets / "mob", self.data)
        self.map = None
        self.started = time.strftime("%Y%m%d-%H%M%S")
        self.saved_at = 0.0
        self.pictures = 0
        self.height = None              # the game window's height, at the last look
        self.scales = self._load_scales()

    # ---------- what comes in ----------

    def map_seen(self, name, now):
        """The map's name as read off the screen."""
        found = self.data.find_map(name) if name else None
        if found == self.map or (found is None and name):
            return                      # (a misread name isn't a new map)
        with self.lock:
            self.map = found
            self.ledger.set_map(found, now)
            self.field.set_species(self.data.species_on(found) if found else [])

    def heard(self, lines, found, now):
        """New message lines. lines: msgwatch.Line, for the EXP. found: pickups as read: ("mesos", amount)
        or ("item", name, qty, tab)."""
        with self.lock:
            for line in lines:                  # (first, so a kill's own line knows it's a party)
                if line.kind == "bonus":
                    self.ledger.party_exp(line.born)
            for line in lines:
                if line.kind == "exp" and line.amount is not None:
                    self.ledger.exp(line.amount, line.born)
            for p in found:
                if p[0] == "mesos":
                    self.ledger.pickup("mesos", p[1], "", now)
                elif p[0] == "item":
                    self.ledger.pickup(p[1], p[2], p[3], now)

    def look(self, frame, now):
        """A picture of the game window."""
        with self.lock:
            self._sprite_size(frame.shape[0], now)
            if self.field.species:
                self.field.look(frame, now)
                self._remember_size(frame.shape[0])
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
                "rate_mesos": {name(s): list(m) for s, m in led.rate_mesos.items()}}

    def save(self):
        with self.lock:
            out = self.results()
        if not (out["counted"] or out["drop_list"] or out["skipped"]):
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
                return "Drop scanner: waiting for a map with monsters"
            if self.field.bank.scale is None:
                return "Drop scanner: looking for monsters to learn their size"
            return "Drop scanner: " + self.ledger.summary_line()
