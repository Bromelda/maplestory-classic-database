"""A running account of one run: mesos made and spent, and potions picked up and used, from when the tracker opens
until it closes. Each time it opens, it starts fresh. Saved after every change in daybook.json in the tracker's data
folder, under the date the run started.

Mesos only show while the inventory's open, so the first reading of the run is where the run starts, and each
later one is compared with the one before. Mesos picked up are known from the message lines, so if the count
went up by less than that, or down, the difference went to a shop, and if it went up by more, it came from selling
(or a quest or a trade: the game doesn't say which). Selling and buying between two readings would cancel out, so what
the potions bought cost at shop prices is taken into account too: whatever the mesos didn't fall by, for those, was sold.

Nothing in the game says when a potion's used, but HP or MP jumps. A jump the size of a known potion is that
potion. MP potions can heal more than their listed amount (a skill can raise it), so a jump up to 30% over a
listed amount is shown with "~" as probably that one. Any other jump, like a Heal from a party member, is listed
by its size and not called a potion.

When an item's count can be seen, the count is the truth: what you had, plus what you picked up, less what you
have now, is what you used, and a rise beyond your pickups was bought. While the count is in view, HP and MP jumps
are ignored for that item. While it isn't, they keep the tally going, and the next count corrects them.

While a shop's open, it's better than that: shopwatch.py sees what was bought or sold, how many and for how much, off the
shop's own window (shop_trade). The count then only has to agree.
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
MATCH_SECONDS = 30              # how long a fall in the mesos can wait to be put down to potions bought
LOOKS_DROP, LOOKS_RISE, LOOKS_ODD = 2, 3, 8     # how many looks in a row have to agree on a new count
PICKED_RISE = 3                 # a rise this small with no pickup line is a pickup whose line wasn't read, not a purchase
LOOKS_LOST = 1200               # a number with digits lost (216 and 21) is nearly always a misread: about 5 minutes of looks
SHOP_WAIT = 20                  # seconds a count waits to show what a shop said was bought or sold


def _blank():
    return {"start": None, "now": None, "picked_mesos": 0, "spent": 0, "sold": 0, "pending_mesos": 0, "cost_seen": 0, "items": {}, "jumps": {}, "shop": {}}


def _item(day, name):
    it = day["items"].setdefault(name, {})
    for key, value in (("picked", 0), ("used", 0), ("bought", 0), ("cost", 0), ("first", None), ("count", None), ("seen", None),
                       ("pending", 0), ("from_jumps", 0), ("sold", 0), ("shop", 0)):
        it.setdefault(key, value)
    return it


def _digits_lost(a, b):
    """Is one number the other with digits lost at the start or end? (1068 and 106, 846 and 46)"""
    short, long = sorted((str(a), str(b)), key=len)
    return len(short) != len(long) and (long.startswith(short) or long.endswith(short))


class DayBook:
    def __init__(self, path, heals=None, today=None, prices=None):
        self.path = Path(path)
        self.heals = heals or {}        # item name: {"hp": amount, "mp": amount, "hp_pct": share, "mp_pct": share}
        self.prices = prices or {}      # item name: what a shop asks for it
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
        self.unmatched, self.unmatched_at = 0, 0.0     # mesos that fell, not yet put down to potions bought
        self.count_maybe = {}           # item name: (a new count, how many looks in a row)
        self.count_at = {}              # item name: when its count was last in view
        self.moved_at = {}              # item name: when its count or its pickups last changed
        self.shop_at = {}               # item name: when a shop last said some were bought or sold

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

    def mesos(self, value, now=None):
        """A confirmed reading of the inventory's mesos."""
        now = time.monotonic() if now is None else now
        with self.lock:
            d = self._day()
            cost = sum(i.get("cost", 0) for i in d["items"].values())
            new_cost, d["cost_seen"] = cost - d["cost_seen"], cost
            if d["start"] is None:
                d["start"], d["now"], d["pending_mesos"] = value, value, 0
            elif d["now"] != value:
                change = value - d["now"] - d["pending_mesos"]
                if change < 0:
                    d["spent"] -= change
                    self.unmatched, self.unmatched_at = self.unmatched - change, now
                else:
                    d["sold"] += change                 # sold something, a quest reward, a trade
                d["now"], d["pending_mesos"] = value, 0
            if new_cost > 0:
                # Potions bought: a fall in the mesos just now was them. If it fell by less, or rose, something was
                # sold in between, which hid the rest of what they cost.
                if now - self.unmatched_at > MATCH_SECONDS:
                    self.unmatched = 0
                matched = min(self.unmatched, new_cost)
                self.unmatched -= matched
                d["spent"] += new_cost - matched
                d["sold"] += new_cost - matched
            self._save()

    def shop_trade(self, kind, name, qty, total, mesos, now=None):
        """What shopwatch.py saw: "bought" or "sold", the item, how many, for how much, and the mesos after."""
        now = time.monotonic() if now is None else now
        sign = -1 if kind == "bought" else 1
        with self.lock:
            d = self._day()
            if d["start"] is None:
                d["start"] = d["now"] = mesos - sign * total
            d["now"] += sign * total
            d["spent" if kind == "bought" else "sold"] += total
            got = d.setdefault("shop", {}).setdefault(kind, {}).setdefault(name, [0, 0])
            got[0] += qty
            got[1] += total
            if name in self.heals or name in d["items"]:
                it = _item(d, name)
                if kind == "bought":
                    it["bought"] += qty
                    it["cost"] += total
                    d["cost_seen"] += total                 # (the mesos have already been put down to this)
                else:
                    it["sold"] += qty
                if it["count"] is not None:
                    it["shop"] -= sign * qty
                    self.shop_at[name] = now
            self._save()
        self.mesos(mesos, now)

    def traded(self):
        """What shops have seen this run: ({item: how many sold}, {item: how many bought})."""
        with self.lock:
            shop = self._day().get("shop", {})
            return tuple({n: v[0] for n, v in shop.get(k, {}).items()} for k in ("sold", "bought"))

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
                from_shop = it["shop"] and it["count"] is not None and value - it["seen"] == it["shop"]
                if from_shop:
                    self.count_maybe.pop(name, None)    # (just what the shop said: no need for more looks)
                elif not self._agreed(name, value, it["seen"]):
                    return                          # (nothing's settled while a new count is still in doubt)
                if it["count"] is None:
                    it["first"] = it["count"] = it["seen"] = value
                    self._save()
                    return
                if from_shop:
                    it["count"] += it["shop"]
                    it["shop"] = 0
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
        if it["shop"]:
            if now - self.shop_at.get(name, now) <= SHOP_WAIT:
                return False                                # (the count hasn't shown what the shop said yet)
            it["shop"] = 0
        if it["count"] is None or (it["seen"] == it["count"] and not it["pending"] and not it["from_jumps"]):
            return False
        change = it["seen"] - it["count"] - it["pending"]   # what the pickups don't explain
        if change > 0 or it["pending"] or it["from_jumps"]:
            if now - self.moved_at.get(name, -SETTLE) < SETTLE:
                return False                                # (its pickup line may be on its way)
        if change > 0:
            used = it["from_jumps"]                         # used while out of view, and got more besides
            if change + used <= PICKED_RISE:
                it["picked"] += change + used
            else:
                it["bought"] += change + used
                it["cost"] = it.get("cost", 0) + (change + used) * self.prices.get(name, 0)
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
                if d["sold"]:
                    text += f" · sold {d['sold']:,}"
                out.append(text)
            parts = [self._item_text(n, i) for n, i in sorted(d["items"].items())
                     if i.get("seen") != 0 or i["used"] or i["picked"] or i.get("bought") or i.get("sold") or i.get("first")]
            parts += [f"{k} ×{n}" for k, n in sorted(d["jumps"].items())]
            if parts:
                out.append("Potions: " + " · ".join(parts))
            for kind, title in (("bought", "Bought at shops"), ("sold", "Sold at shops")):
                got = d.get("shop", {}).get(kind)
                if got:
                    out.append(f"{title}: " + " · ".join(f"{n} ×{q:,} for {t:,}" for n, (q, t) in sorted(got.items())))
            return out

    @staticmethod
    def _item_text(name, it):
        title = name.lstrip("~") + ("?" if name.startswith("~") else "")
        sold = f", sold {it['sold']:,}" if it.get("sold") else ""
        if it.get("count") is None:
            bought = f" bought {it['bought']:,}" if it.get("bought") else ""
            return f"{title} +{it['picked']} −{it['used']}{bought}{sold}"
        cost = f" for {it['cost']:,}" if it.get("cost") else ""
        return (f"{title}: had {it['first']:,}, picked {it['picked']:,}, bought {it['bought']:,}{cost}{sold}, "
                f"used {it['used']:,}, left {it['seen']:,}")
