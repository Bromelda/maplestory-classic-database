"""A running account of one run: mesos made and spent, and potions picked up and used, from when the tracker opens
until it closes. Each time it opens, it starts fresh. Saved after every change in daybook.json in the tracker's data
folder, under the date the run started.

Mesos only show while the inventory's open, so the first reading of the run is where the run starts, and each
later one is compared with the one before. Mesos picked up are known from the message lines, so if the count
went up by less than that, or down, the difference went to a shop.

Nothing in the game says when a potion's used, but HP or MP jumps. A jump the size of a known potion is that
potion. MP potions can heal more than their listed amount (a skill can raise it), so a jump up to 30% over a
listed amount is shown with "~" as probably that one. Any other jump, like a Heal from a party member, is listed
by its size and not called a potion.

When an item's count can be seen, the count is the truth: what you had, plus what you picked up, less what you
have now, is what you used, and a rise beyond your pickups was bought. While the count is in view, HP and MP jumps
are ignored for that item. While it isn't, they keep the tally going, and the next count corrects them.
"""
import json
import threading
import time
from pathlib import Path

HP_JUMP, MP_JUMP = 50, 70       # smaller rises are natural recovery. On real footage HP recovers up to about 48 at a time, MP about 46
EXACT = 5                       # how far off a listed amount still counts as that potion
BOOST = 1.3                     # how far over a listed amount a jump can be and still probably be that potion
LIVE = 5                        # seconds since an item's count was seen that it still counts as in view
SETTLE = 2                      # seconds a count waits for a pickup line that explains it (the lines can lag)
QUICK_DROP, QUICK_RISE = 5, 20  # a bigger change than this at once is probably a misread
LOOKS_DROP, LOOKS_RISE, LOOKS_ODD = 2, 3, 8     # how many looks in a row have to agree on a new count
PICKED_RISE = 3                 # a rise this small with no pickup line is a pickup whose line wasn't read, not a purchase
LOOKS_LOST = 1200               # a number with digits lost (216 and 21) is nearly always a misread: about 5 minutes of looks


def _blank():
    return {"start": None, "now": None, "picked_mesos": 0, "spent": 0, "other": 0, "pending_mesos": 0, "items": {}, "jumps": {}}


def _item(day, name):
    it = day["items"].setdefault(name, {})
    for key, value in (("picked", 0), ("used", 0), ("bought", 0), ("first", None), ("count", None), ("seen", None),
                       ("pending", 0), ("from_jumps", 0)):
        it.setdefault(key, value)
    return it


def _digits_lost(a, b):
    """Is one number the other with digits lost at the start or end? (1068 and 106, 846 and 46)"""
    short, long = sorted((str(a), str(b)), key=len)
    return len(short) != len(long) and (long.startswith(short) or long.endswith(short))


class DayBook:
    def __init__(self, path, heals=None, today=None):
        self.path = Path(path)
        self.heals = heals or {}        # item name: {"hp": amount, "mp": amount, "hp_pct": share, "mp_pct": share}
        self.run = (today or (lambda: time.strftime("%Y-%m-%d")))()     # (a run past midnight stays one run)
        self.lock = threading.Lock()
        self.days = {}
        try:
            self.path.unlink()          # (starting fresh: the last run's over)
        except OSError:
            pass
        self.last = {}                  # "hp"/"mp": the last value believed
        self.most = {}
        self.maybe = {}                 # a new reading, waiting to be seen twice
        self.count_maybe = {}           # item name: (a new count, how many looks in a row)
        self.count_at = {}              # item name: when its count was last in view
        self.moved_at = {}              # item name: when its count or its pickups last changed

    def _day(self):
        return self.days.setdefault(self.run, _blank())

    def _save(self):
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.days, ensure_ascii=False, indent=1), encoding="utf-8")
            tmp.replace(self.path)
        except OSError:
            pass                        # (a full disk doesn't stop the tracker)

    # ---------- mesos ----------

    def mesos(self, value):
        """A confirmed reading of the inventory's mesos."""
        with self.lock:
            d = self._day()
            if d["now"] == value:
                return
            if d["start"] is None:
                d["start"], d["now"], d["pending_mesos"] = value, value, 0
                self._save()
                return
            change = value - d["now"]
            picked = d["pending_mesos"]
            if change < picked:
                d["spent"] += picked - change
            else:
                d["other"] += change - picked       # sold something, a quest reward, a trade
            d["now"], d["pending_mesos"] = value, 0
            self._save()

    def picked_mesos(self, amount):
        with self.lock:
            d = self._day()
            d["picked_mesos"] += amount
            if d["start"] is not None:              # (before the first reading, they're part of where the day starts)
                d["pending_mesos"] += amount
            self._save()

    # ---------- potions ----------

    def picked_item(self, name, qty, tab=None, now=None):
        """An item picked up. Only potions and food are kept, and anything else whose count is being read."""
        with self.lock:
            if name not in self.heals and name not in self._day()["items"]:
                return
            it = _item(self._day(), name)
            it["picked"] += qty
            if it["count"] is not None:             # (before its first count, they're part of what it starts at)
                it["pending"] += qty
                self.moved_at[name] = time.monotonic() if now is None else now
            self._save()

    def count(self, name, value, now=None):
        """One look at how many of an item you have."""
        now = time.monotonic() if now is None else now
        with self.lock:
            it = _item(self._day(), name)
            self.count_at[name] = now
            if value != it["seen"]:
                if not self._agreed(name, value, it["seen"]):
                    return                          # (nothing's settled while a new count is still in doubt)
                if it["count"] is None:
                    it["first"] = it["count"] = it["seen"] = value
                    self._save()
                    return
                it["seen"] = value
                self.moved_at[name] = now
            else:
                self.count_maybe.pop(name, None)
            self._save_if(self._settle(name, it, now))

    def _agreed(self, name, value, was):
        """Have enough looks in a row agreed on this new count?"""
        last, looks = self.count_maybe.get(name, (None, 0))
        looks = looks + 1 if last == value else 1
        self.count_maybe[name] = (value, looks)
        if was is None or value > was:
            need = LOOKS_RISE
        else:
            need = LOOKS_DROP
        if was is not None and (was - value > QUICK_DROP or value - was > QUICK_RISE):
            need = LOOKS_ODD
        if was is not None and _digits_lost(was, value):
            need = LOOKS_LOST
        if looks < need:
            return False
        del self.count_maybe[name]
        return True

    def _settle(self, name, it, now):
        """Works out what the change since the last settled count was. True if anything changed."""
        if it["count"] is None or (it["seen"] == it["count"] and not it["pending"] and not it["from_jumps"]):
            return False
        change = it["seen"] - it["count"] - it["pending"]   # what the pickups don't explain
        if change > 0 or it["pending"] or it["from_jumps"]:
            if now - self.moved_at.get(name, -SETTLE) < SETTLE:
                return False                                # (its pickup line may be on its way)
        if change > 0:
            used = it["from_jumps"]                         # used while out of view, and got more besides
            it["picked" if change + used <= PICKED_RISE else "bought"] += change + used
        else:
            used = -change                                  # (no change at all: those jumps weren't this potion)
        it["used"] += used - it["from_jumps"]
        it["count"], it["pending"], it["from_jumps"] = it["seen"], 0, 0
        return True

    def _save_if(self, changed):
        if changed:
            self._save()

    def vitals(self, hp=None, mp=None):
        """A reading of the status bar: (now, most) for each. A reading only counts when it's seen twice in a row."""
        with self.lock:
            changed = False
            for stat, got in (("hp", hp), ("mp", mp)):
                if got is None:
                    continue
                if self.maybe.get(stat) != got:
                    self.maybe[stat] = got
                    continue
                now, most = got
                before, was_most = self.last.get(stat), self.most.get(stat)
                self.last[stat], self.most[stat] = now, most
                if before is None or was_most != most or before <= 0 or now <= before:
                    continue                # (the first reading, a level up, coming back from dying)
                if self._jump(stat, now - before, now, most):
                    changed = True
            if changed:
                self._save()

    def _jump(self, stat, rise, now, most):
        if rise < (HP_JUMP if stat == "hp" else MP_JUMP):
            return False
        name, times = self._potion_for(stat, rise, most)
        d = self._day()
        if name:
            real = name.lstrip("~")
            counted = d["items"].get(real, {}).get("count") is not None
            if counted:                     # (its count knows better. "~": now it's known which potion it was)
                if time.monotonic() - self.count_at.get(real, -LIVE) <= LIVE:
                    return False            # in view: the count will show it
                it = _item(d, real)
                it["from_jumps"] += times
            else:
                it = _item(d, name)
            it["used"] += times
            return True
        if now >= most:                     # topped up: the jump's cut short, so its size says nothing
            d["jumps"][f"{stat.upper()} to full"] = d["jumps"].get(f"{stat.upper()} to full", 0) + 1
            return True
        key = f"{stat.upper()} +{rise}"
        d["jumps"][key] = d["jumps"].get(key, 0) + 1
        return True

    def _amounts(self, stat, most):
        out = {}
        items = self._day()["items"]
        for name, h in self.heals.items():
            if items.get(name, {}).get("seen") == 0:
                continue                    # (none left: a jump this size is something else)
            if h.get(stat):
                out[name] = h[stat]
            elif h.get(f"{stat}_pct"):
                out[name] = round(h[f"{stat}_pct"] * most)
        return out

    def _potion_for(self, stat, rise, most):
        """(name, how many), or (None, 0). One potion or two at once; "~" when it's a boosted amount."""
        amounts = self._amounts(stat, most)
        for times in (1, 2, 3):
            close = [(abs(rise - times * a), n) for n, a in amounts.items() if abs(rise - times * a) <= EXACT]
            if close:
                return min(close)[1], times
        if stat == "mp":
            for times in (1, 2, 3):
                near = [(rise - times * a, n) for n, a in amounts.items() if times * a < rise <= times * a * BOOST]
                if near:
                    return "~" + min(near)[1], times
        return None, 0

    # ---------- what's shown ----------

    def lines(self):
        """This run, as lines of text."""
        with self.lock:
            d = self._day()
            out = []
            if d["start"] is None:
                out.append("This run: open your inventory to set your starting mesos")
            else:
                made = d["now"] - d["start"]
                text = f"This run: {made:+,} mesos · started {d['start']:,} · now {d['now']:,}"
                if d["spent"]:
                    text += f" · spent {d['spent']:,}"
                out.append(text)
            parts = [self._item_text(n, i) for n, i in sorted(d["items"].items())
                     if i.get("seen") != 0 or i["used"] or i["picked"] or i.get("bought") or i.get("first")]
            parts += [f"{k} ×{n}" for k, n in sorted(d["jumps"].items())]
            if parts:
                out.append("Potions: " + " · ".join(parts))
            return out

    @staticmethod
    def _item_text(name, it):
        title = name.lstrip("~") + ("?" if name.startswith("~") else "")
        if it.get("count") is None:
            return f"{title} +{it['picked']} −{it['used']}"
        return (f"{title}: had {it['first']:,}, picked {it['picked']:,}, bought {it['bought']:,}, "
                f"used {it['used']:,}, left {it['seen']:,}")
