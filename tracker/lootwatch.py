"""Decides which monster a pickup came from, and whether it counts. No pictures in here, only events.

What goes in (from fieldwatch.py and the message stack):
    mob_gone   a monster we were following vanished at this spot
    mob_back   ...it turned out to be still there (it was only hidden)
    exp        a "You received EXP" line: one of MY kills, just now
    party_exp  a "Bonus EXP for PARTY" line: I'm in a party
    loot_seen  something new is lying on the ground at this spot
    loot_lost  ...it's gone from that spot (or something is standing on it)
    loot_back  ...it's still there after all
    pickup     a white line: what I actually picked up

The rules, as agreed for the database:

* A drop only counts when it is certain which KIND of monster it came from.
    - Two different monsters dying on top of each other: nothing there counts.
    - Someone else's kill nearby: fine if it's the same monster, not if it's a different one.
* There are two records, kept apart:
    - the drop LIST: "this monster drops this item". One clear sighting is enough, and another
      player's kill of the same monster is allowed.
    - the drop RATE: only kills that are mine, solo, and fully accounted for.
* Whether a kill counts for the rate is decided from what was around when it died, never from what
  it dropped. Throwing out kills after looking at their drops would bend the numbers.
* A kill that left something on the ground which was never picked up is left out of the rate
  (with its reason shown), so the items you don't bother with don't look rarer than they are.
* A missed pickup is better than a wrong one: anything unclear is left out and counted as skipped.

Positions are in the world's pixels at the size of the game's own sprites (see Rules.scale), so the
distances mean the same whatever size the game window is.
"""
from collections import Counter
from dataclasses import dataclass, field


@dataclass
class Rules:
    near: float = 110.0         # how far from a death its drops can land (sprite pixels)
    near_y: float = 90.0        # ...and up or down
    apart_s: float = 3.8        # two deaths this close in time and place could share a drop (loot_before + loot_after)
    exp_s: float = 1.6          # how far apart a monster's vanishing and my EXP line can be
    loot_before: float = 1.3    # a drop can be seen this long before its monster has finished vanishing
    loot_after: float = 2.5     # ...and this long after (drops fall first, and are seen once they settle)
    pick_before: float = 1.0    # a pickup line can come this long after the item left the ground
    pick_after: float = 0.6     # ...or this long before
    left_after: float = 60.0    # still on the ground after this long: I left it there
    settle: float = 5.2         # how long to wait for all the evidence (loot_before + apart_s, a little more)
    blind_s: float = 20.0       # with no picture of the drop: how recent the kills must be
    report_exp_mismatch: bool = True


# Why a kill was left out of the rate. These show in the report: "412 kills counted, 58 skipped".
WHY = {
    "mixed": "a different monster died on top of it",
    "unlocated": "another kill nearby couldn't be placed",
    "others": "another player's kill was mixed in",
    "party": "in a party",
    "left": "left something on the ground",
    "taken": "its drop vanished with no pickup line",
    "untied": "a pickup near it couldn't be tied to a spot",
    "camera": "the view jumped",
    "exp": "the EXP didn't fit this monster",
    "away": "left the map first",
}


@dataclass
class Death:
    id: int
    species: str                # monster id, or None if nobody can tell
    x: float                    # None if no one saw where
    y: float
    t: float
    track: int = None
    own: bool = False
    exp: int = None
    party: bool = False
    camera_ok: bool = True
    clean: bool = None          # None until decided, apart_s after it died
    skip: set = field(default_factory=set)
    loots: list = field(default_factory=list)
    counted: bool = None        # decided last: None until then
    void: bool = False          # it wasn't a death after all


@dataclass
class Loot:
    id: int
    x: float
    y: float
    t: float
    t_lost: float = None
    deaths: list = None         # who may have dropped it, once worked out
    status: str = "open"        # open, tied, foreign, mixed, credited, left, taken
    picture: object = None      # what it looked like (kept with the credit, to check by eye)
    credit: object = None
    item: str = None            # what its picture says it is, if there was one: an item's name, or "mesos"


@dataclass
class Credit:
    species: str
    name: str                   # item name, or "mesos"
    qty: int
    tab: str
    t: float
    own: bool                   # every monster it could have come from was my kill
    how: str                    # "spot": watched from the kill to the pickup. "only": the only monster here.
    map: str = None
    new: bool = False           # not in the database's list for this monster
    picture: object = None
    deaths: list = field(default_factory=list)
    void: bool = False


def _could_be(seen, said):
    """Could what was seen on the ground be what the pickup line says? (A long name is cut off with "...".)"""
    if seen is None:
        return True
    a, b = seen.lower(), str(said).lower()
    return a == b or (b.endswith("...") and a.startswith(b.rstrip(". "))) or (a.endswith("...") and b.startswith(a.rstrip(". ")))


class DropLedger:
    """Feed it events, call tick() now and then. credits has the drops, kills the deaths decided."""

    def __init__(self, data=None, rules=None, on_credit=None, on_other=None):
        self.data = data                # scandata.GameData, or None
        self.rules = rules or Rules()
        self.on_credit = on_credit
        self.on_other = on_other        # a monster seen to vanish with no EXP line of mine: (species, when)
        self.map = None
        self.species_here = []
        self.vision = False             # is something actually watching the field?
        self.deaths, self.loots, self.credits = [], [], []
        self.pickups = []               # waiting to be worked out
        self.pending_exp = []           # EXP lines not matched to a spot yet
        self.party_until = -1.0
        self._next = 1
        self.kills_counted = Counter()  # species -> kills that count for the rate
        self.kills_seen = Counter()     # species -> my kills
        self.skipped = Counter()        # why -> kills left out of the rate
        self.rate_drops = {}            # species -> Counter of item -> how many times it dropped
        self.rate_mesos = {}            # species -> [how many times, total]
        self.untied = []                # pickups with nowhere to go: (name, qty, t)
        self.vanished_seen = 0          # monsters seen to vanish, all told
        self.drops_seen = 0             # drops seen landing, all told

    def _id(self):
        self._next += 1
        return self._next - 1

    # ---------- where we are ----------

    def set_map(self, name, now=None):
        """A new map: anything still unresolved here can't be finished now."""
        if name == self.map:
            return
        if now is not None:
            self.close_all(now, "away")
        self.map = name
        self.species_here = list(self.data.species_on(name)) if self.data and name else []

    def close_all(self, now, why):
        """Stop waiting for what's open (left the map, the view jumped). Kills not decided yet go out."""
        self.tick(now)
        for d in self.deaths:
            if d.counted is None and not d.void:
                if d.own:
                    d.skip.add(why)
                d.clean = bool(d.clean)
                self._decide_kill(d)
        for lo in self.loots:
            if lo.status in ("open", "tied"):
                lo.status = "left"
        self.pending_exp.clear()

    # ---------- events ----------

    def mob_gone(self, species, x, y, t, track=None, camera_ok=True):
        self.vanished_seen += 1
        d = Death(self._id(), species, x, y, t, track=track, camera_ok=camera_ok)
        self.deaths.append(d)
        # An EXP line that's already in may be this one's. (If it comes later, exp() finds this.)
        best = min((e for e in self.pending_exp if abs(e[1] - t) <= self.rules.exp_s),
                   key=lambda e: self._pair_cost(d, e[0], e[1]), default=None)
        if best:
            self.pending_exp.remove(best)
            self._own(d, best[0], best[1])
        return d

    def mob_back(self, track, now):
        """It was only hidden: that wasn't a death. Its EXP line (if it took one) goes back in the pile."""
        for d in reversed(self.deaths):
            if d.track == track and not d.void and d.counted is None and now - d.t <= self.rules.settle:
                d.void = True
                if d.own:
                    self.kills_seen[d.species] -= 1
                    self.pending_exp.append((d.exp, d.t))
                return

    def exp(self, amount, t):
        """A "You received EXP" line: a kill of mine."""
        candidates = [d for d in self.deaths if not d.own and not d.void and d.counted is None and abs(d.t - t) <= self.rules.exp_s]
        if candidates:
            d = min(candidates, key=lambda c: self._pair_cost(c, amount, t))
            self._own(d, amount, t)
        else:
            self.pending_exp.append((amount, t))

    def party_exp(self, t):
        """A party bonus line: the numbers around now aren't a solo player's."""
        self.party_until = max(self.party_until, t + 30.0)
        for d in self.deaths:                   # (the kill that gave it came a moment before)
            if d.own and abs(d.t - t) <= self.rules.exp_s:
                d.party = True

    def loot_seen(self, x, y, t, picture=None, item=None):
        self.drops_seen += 1
        lo = Loot(self._id(), x, y, t, picture=picture, item=item)
        self.loots.append(lo)
        return lo

    def loot_lost(self, loot_id, t):
        lo = self._loot(loot_id)
        if lo is not None and lo.t_lost is None:
            lo.t_lost = t

    def loot_back(self, loot_id):
        """It's still on the ground. If it was credited already, that credit was wrong: take it back."""
        lo = self._loot(loot_id)
        if lo is None:
            return
        lo.t_lost = None
        if lo.credit is not None and not lo.credit.void:
            self._void(lo.credit)
            lo.credit = None
        if lo.status in ("credited", "taken"):
            lo.status = "tied" if lo.deaths else "open"

    def pickup(self, name, qty, tab, t):
        """A white line: mesos (name "mesos", qty the amount) or an item."""
        self.pickups.append((name, qty, tab, t))

    # ---------- working it out ----------

    def _loot(self, loot_id):
        return next((lo for lo in reversed(self.loots) if lo.id == loot_id), None)

    def _pair_cost(self, death, amount, t):
        """Which vanishing an EXP line goes with: the closest in time, and the one it fits."""
        cost = abs(death.t - t)
        if self.data and amount is not None and death.species and not self._party(t):
            if self.data.exp_of(death.species) != amount:
                cost += 10.0
        return cost

    def _party(self, t):
        return t <= self.party_until

    def in_party(self, t):
        """Has a party bonus line been seen lately?"""
        return self._party(t)

    def _own(self, d, amount, t):
        d.own, d.exp = True, amount
        d.t = min(d.t, t)               # the line comes as it dies: the sprite can take longer to go
        self.kills_seen[d.species] += 1
        if self._party(t):
            d.party = True
        if not d.camera_ok:
            d.skip.add("camera")
        if self.data and d.species and amount is not None and not d.party:
            want = self.data.exp_of(d.species)
            others = [s for s in self.species_here if s != d.species and self.data.exp_of(s) == amount]
            if want != amount and others:       # the EXP says it was a different monster here
                d.skip.add("exp")
                d.species = None

    def species_for_exp(self, amount):
        """Which monster here gives this much EXP, if exactly one does."""
        if not self.data or amount is None:
            return None
        got = [s for s in self.species_here if self.data.exp_of(s) == amount]
        return got[0] if len(got) == 1 else None

    def tick(self, now):
        r = self.rules
        # EXP lines nobody's vanishing took: a kill of mine I can't place. Only the amount says what it was.
        for amount, t in list(self.pending_exp):
            if now - t > r.exp_s + 0.2:
                self.pending_exp.remove((amount, t))
                d = Death(self._id(), self.species_for_exp(amount), None, None, t, own=True, exp=amount, party=self._party(t))
                self.kills_seen[d.species] += 1
                self.deaths.append(d)
        for d in self.deaths:
            if d.clean is None and not d.void and now - d.t >= r.apart_s:
                self._decide_clean(d)
        for lo in self.loots:
            if lo.status == "open" and now - lo.t >= r.settle:
                self._tie(lo)
        for p in list(self.pickups):
            if now - p[3] >= r.settle:
                self.pickups.remove(p)
                self._resolve_pickup(*p)
        for lo in self.loots:
            if lo.status in ("open", "tied", "foreign", "mixed"):
                if lo.t_lost is not None and now - lo.t_lost > r.settle + r.pick_after:
                    if lo.status == "tied":
                        for d in lo.deaths:
                            d.skip.add("taken")
                    lo.status = "taken"
                elif lo.t_lost is None and now - lo.t > r.left_after:
                    if lo.status == "tied":
                        for d in lo.deaths:
                            d.skip.add("left")
                    lo.status = "left"
        for d in self.deaths:
            if d.counted is None and not d.void and d.clean is not None and self._kill_finished(d, now):
                self._decide_kill(d)
        self._tidy(now)

    def _tidy(self, now):
        """Forget what's been decided and can't matter any more (a session can be hours long)."""
        keep_s = self.rules.settle + self.rules.apart_s + self.rules.blind_s + self.rules.left_after
        self.deaths = [d for d in self.deaths if not ((d.counted is not None or d.void) and now - d.t > keep_s)]
        self.loots = [lo for lo in self.loots if not (lo.status not in ("open", "tied") and now - lo.t > keep_s + 10)]

    def _decide_clean(self, d):
        """Decided from what else died around it, and nothing else: its own drops have no say."""
        r = self.rules
        clean = d.species is not None
        for o in self.deaths:
            if o is d or o.void or abs(o.t - d.t) > r.apart_s:
                continue
            if o.x is None or d.x is None:              # someone died and nobody knows where
                if o.species != d.species or o.species is None:
                    clean = False
                    d.skip.add("unlocated")
                continue
            if abs(o.x - d.x) <= r.near and abs(o.y - d.y) <= r.near_y:
                if o.species != d.species or o.species is None:
                    clean = False
                    d.skip.add("mixed")
                elif not o.own and d.own:
                    d.skip.add("others")                # same monster, so the list is fine, but not the rate
        d.clean = clean
        if d.party:
            d.skip.add("party")
        if self.on_other and not d.own and d.species:
            self.on_other(d.species, d.t)

    def _kill_finished(self, d, now):
        """No more can happen to this kill: its drops have had time to land and all have been settled."""
        r = self.rules
        if now - d.t < r.loot_after + r.settle:
            return False
        return all(lo.status not in ("open", "tied") for lo in d.loots)

    def _decide_kill(self, d):
        d.counted = bool(d.own and d.clean and d.x is not None and not d.skip)
        if not d.own:
            return
        if d.counted:
            self.kills_counted[d.species] += 1
            for lo in d.loots:
                if lo.credit is None or lo.credit.void or not lo.credit.own:
                    continue
                if lo.credit.name == "mesos":
                    m = self.rate_mesos.setdefault(d.species, [0, 0])
                    # (a drop shared between kills of the same monster is added once, by its first kill)
                    if lo.credit.deaths and lo.credit.deaths[0] == d.id:
                        m[0] += 1
                        m[1] += lo.credit.qty
                elif lo.credit.deaths and lo.credit.deaths[0] == d.id:
                    self.rate_drops.setdefault(d.species, Counter())[lo.credit.name] += 1
        else:
            reasons = sorted(d.skip) or (["mixed"] if d.clean is False else ["unlocated"])
            self.skipped[reasons[0]] += 1

    def _tie(self, lo):
        """Who may have dropped this: every death close enough in time and place."""
        r = self.rules
        near = [d for d in self.deaths if not d.void and d.x is not None
                and -r.loot_before <= lo.t - d.t <= r.loot_after
                and abs(d.x - lo.x) <= r.near and abs(d.y - lo.y) <= r.near_y]
        lo.deaths = near
        if not near:
            lo.status = "foreign"               # it was here before, or from a kill I never saw
            return
        if len({d.species for d in near}) > 1 or any(d.species is None for d in near):
            lo.status = "mixed"
            for d in near:
                d.skip.add("mixed")
            return
        lo.status = "tied"
        for d in near:
            if lo not in d.loots:
                d.loots.append(lo)

    def _resolve_pickup(self, name, qty, tab, t):
        r = self.rules
        for lo in self.loots:
            if lo.status == "open":
                self._tie(lo)
        taken = [lo for lo in self.loots
                 if lo.t_lost is not None and lo.credit is None
                 and lo.status in ("tied", "foreign", "mixed")
                 and -r.pick_after <= t - lo.t_lost <= r.pick_before
                 and _could_be(lo.item, name)]
        if taken:
            lo = min(taken, key=lambda x: abs(t - x.t_lost))
            others = [o for o in taken if o is not lo]
            # Two things left the ground at once and one line came: which was it? Only sure if
            # it makes no difference: both from the same monster.
            if any(o.status != "tied" or lo.status != "tied" or o.deaths[0].species != lo.deaths[0].species for o in others):
                self._untied(name, qty, t)
                return
            if lo.status == "foreign":
                self._untied(name, qty, t, mark=False)      # not from a kill I saw: nothing to say about it
                lo.status = "taken"
                return
            if lo.status == "mixed":
                lo.status = "taken"
                return
            self._credit_spot(lo, name, qty, tab, t)
            return
        if self._credit_blind(name, qty, tab, t):
            return
        self._untied(name, qty, t)

    def _credit_spot(self, lo, name, qty, tab, t):
        deaths = lo.deaths
        species = deaths[0].species
        if not all(d.clean for d in deaths):
            lo.status = "mixed"
            return
        own = all(d.own for d in deaths)
        c = Credit(species, name, qty, tab, t, own, "spot", self.map, self._is_new(species, name), lo.picture, [d.id for d in deaths])
        lo.credit, lo.status = c, "credited"
        self._add(c)

    def _credit_blind(self, name, qty, tab, t):
        """No drop was seen leaving the ground. If only one kind of monster lives on this map, it can
        still only have come from that one (the list, never the rate)."""
        if len(self.species_here) != 1:
            return False
        species = self.species_here[0]
        if not any(d.species == species and d.own and 0 <= t - d.t <= self.rules.blind_s for d in self.deaths):
            return False
        self._add(Credit(species, name, qty, tab, t, False, "only", self.map, self._is_new(species, name)))
        self._mark_untied(t)            # (the list has it, but which kill it was from is still unknown)
        return True

    def _untied(self, name, qty, t, mark=True):
        self.untied.append((name, qty, t))
        if mark:
            self._mark_untied(t)

    def _mark_untied(self, t):
        """A drop went unseen. A recent kill of mine may really have dropped it, so none of them can be
        counted as having dropped nothing."""
        for d in self.deaths:
            if d.own and not d.void and 0 <= t - d.t <= self.rules.blind_s and not d.loots and d.counted is None:
                d.skip.add("untied")

    def _is_new(self, species, name):
        if name == "mesos" or not self.data:
            return False
        return not self.data.known_drop(species, name)

    def _add(self, c):
        self.credits.append(c)
        if self.on_credit:
            self.on_credit(c)

    def _void(self, c):
        c.void = True

    # ---------- the results ----------

    def drop_list(self):
        """{species: {item: times seen}}: what each monster was seen to drop."""
        out = {}
        for c in self.credits:
            if not c.void and c.name != "mesos":
                out.setdefault(c.species, Counter())[c.name] += 1
        return out

    def new_drops(self):
        """{species: [items]} seen here that the database doesn't list for that monster yet."""
        out = {}
        for c in self.credits:
            if not c.void and c.new and c.name not in out.get(c.species, []):
                out.setdefault(c.species, []).append(c.name)
        return out

    def rates(self):
        """{species: {"kills": n, "items": {item: (times, chance)}, "mesos": (times, chance, average)}}."""
        out = {}
        for species, kills in self.kills_counted.items():
            if not kills:
                continue
            items = {k: (v, v / kills) for k, v in self.rate_drops.get(species, {}).items()}
            m = self.rate_mesos.get(species)
            out[species] = {"kills": kills, "items": items, "mesos": (m[0], m[0] / kills, m[1] / m[0]) if m and m[0] else None}
        return out

    def summary(self):
        counted = sum(self.kills_counted.values())
        skipped = sum(self.skipped.values())
        return {"counted": counted, "skipped": skipped, "why": dict(self.skipped),
                "drops": sum(1 for c in self.credits if not c.void), "untied": len(self.untied)}

    def summary_line(self):
        s = self.summary()
        return f"{s['counted']} kills counted, {s['skipped']} skipped, {s['drops']} drops tied to a monster"
