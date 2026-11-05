"""What the scanner knows about the game: which monsters live where, their EXP, what they're known to
drop. It comes from the fan database's own data (assets/scan_data.json, made by tools/make_scan_data.py)."""
import difflib
import json
import re
from pathlib import Path


# Raise this after any fix that changes what gets counted. tools/publish_drops.py only uses sessions from
# the current version, so results from before a fix can't mix in with the good ones.
SCANNER_VERSION = 2


def _key(text):
    return " ".join(re.sub(r"[^a-z0-9 ]", " ", str(text).lower()).split())


class GameData:
    def __init__(self, path):
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
        self.monsters = raw["monsters"]
        self.maps = raw["maps"]
        self.item_gids = raw.get("item_gids", {})
        self._map_keys = {_key(name): name for name in self.maps}
        self._drops = {mid: {_key(n) for n in m.get("drops", [])} for mid, m in self.monsters.items()}

    def find_map(self, name):
        """The database's name for a map name read off the screen (reading can be a little off)."""
        if not name:
            return None
        k = _key(name)
        if k in self._map_keys:
            return self._map_keys[k]
        close = difflib.get_close_matches(k, list(self._map_keys), n=2, cutoff=0.86)
        if len(close) == 1 or (len(close) == 2 and difflib.SequenceMatcher(None, k, close[0]).ratio()
                               - difflib.SequenceMatcher(None, k, close[1]).ratio() >= 0.04):
            return self._map_keys[close[0]]
        return None

    def species_on(self, map_name):
        """The monsters that live on this map (their ids)."""
        found = self.find_map(map_name)
        return list(self.maps[found]["spawns"]) if found else []

    def exp_of(self, species):
        m = self.monsters.get(species)
        return m.get("exp") if m else None

    def name_of(self, species):
        m = self.monsters.get(species)
        return m["name"] if m else (species or "Unknown")

    def drops_of(self, species):
        m = self.monsters.get(species)
        return m.get("drops", []) if m else []

    def icon_of(self, item):
        """The game's number for an item, which names its picture in assets/icons."""
        return self.item_gids.get(item)

    def gid_of(self, species):
        m = self.monsters.get(species)
        return m.get("gid") if m else None

    def known_drop(self, species, item):
        """Does the database already list this drop? Long names may be cut off on screen, so a name
        ending in "..." matches by its start."""
        known = self._drops.get(species, set())
        k = _key(item)
        if str(item).rstrip().endswith("..."):
            return any(n.startswith(k) for n in known)
        return k in known
