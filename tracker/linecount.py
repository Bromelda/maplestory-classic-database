"""Counts kills and what they dropped from the message lines alone, and checks how much of the lines it's reading.

The lines are far more complete than the pictures: on real clips, 349 EXP lines against 157 monsters seen to vanish.
And hunting alone, a line says exactly which monster it was, because each kind gives its own amount of EXP: 46 is a
Wild Boar. The pictures (fieldwatch.py) are the backup, not the count.

It doesn't try to say which kill each item came from. There are two ways to be sure of the kind of monster:

  Stretches  Spans of time when one kind of monster, and only that kind, was being killed. Everything picked up in one
             came from that kind: rate = what was picked up in its stretches / the kills in them. Mesos as well.
  Listed     Real hunting mixes kinds, minute by minute. But if only one kind on this map is known to drop an item (only
             Fire Boars drop Fire Boar's Tooth), it can only have come from that kind, however mixed the kills were:
             rate = how many were picked up / that kind's kills in the same time. So its kills count for an item
             whether or not one dropped.

The rules:

* Whether any of it counts is decided from the kills and how well they were read, never from what dropped.
* A stretch ends at: a kill of another kind, a line that fits no monster here, a party bonus line, a new map, the game
  going out of front (nothing's being read), or the pictures seeing another kind die that wasn't my kill.
* The first LEAD_S seconds of a stretch aren't counted, for its kills or its pickups: what's picked up then may be left
  over from before. Pickups after the last kill aren't counted either. In steady play these edges even out: the first
  pickups counted come from kills just before the window, and the last kills' drops are still on the ground.
* A span where the EXP lines don't add up to what the EXP bar gained had lines going unread, so it's left out.

Party play isn't counted here at all, for now: the amounts don't name the monster. See the README.
"""
from collections import Counter, deque

LEAD_S = 20.0               # seconds into a stretch before anything counts. (As in lootwatch's blind_s)
PARTY_S = 30.0              # a party bonus line means a party for this long
CHUNK_S = 300.0             # a long stretch is checked in pieces this long, so a bad minute costs only its own piece
MIN_READ = 0.9              # share of what the EXP bar gained that the lines must add up to
METER_S = 300.0             # how far back the live meter looks
LUMP_LEAST, LUMP_TIMES = 500, 6     # EXP going up by this much at once, and this many times the biggest line read: a quest's reward, not kills

SKIPPED = {"lead": "the start of a stretch", "party": "in a party", "exp": "the EXP fit no monster here (or more than one)",
           "unread": "EXP lines were going unread", "nomap": "the map wasn't known yet", "others": "another kind was killed by someone else",
           "away": "the game wasn't in front", "changed": "another kind came right after"}


def _same_item(listed, said):
    """Is what the line said this item? (A long name is cut off with "...".)"""
    a, b = listed.lower(), str(said).lower()
    return a == b or (b.endswith("...") and a.startswith(b.rstrip(". ")))


class ExpText:
    """What the EXP number next to the MP bar says was gained, whether tracking's paused or not. seen() gives what it went up by."""

    def __init__(self):
        self.last = None

    def seen(self, exp, req):
        """A trusted reading: the EXP, and how much the level takes (None if it's not known yet)."""
        if exp is None:
            return 0
        last, self.last = self.last, (exp, req)
        if last is None:
            return 0
        was, was_req = last
        if exp >= was and (req == was_req or req is None or was_req is None):
            return exp - was
        if exp < was and was_req and req != was_req:
            return was_req - was + exp      # (a level up)
        return 0                            # (it fell: a death)


class Meter:
    """How much of what happened was read: the lines against the numbers on screen. Counts for the whole run, and for
    the last few minutes."""

    def __init__(self, window=METER_S):
        self.window = window
        self.recent = deque()           # (when, what, how much)
        self.total = Counter()
        self.box_value = None           # the mesos count when it was last seen
        self.since_seen = 0             # mesos lines since then
        self.visited_town = False       # been in a town since then
        self.last_check = None          # (the lines' mesos, what the count gained) at the last comparison
        self.biggest = 0                # the biggest EXP line read

    def add(self, what, amount, t):
        if what == "exp_lines":
            self.biggest = max(self.biggest, amount)
        self.recent.append((t, what, amount))
        self.total[what] += amount
        self.forget(t)

    def forget(self, now):
        while self.recent and now - self.recent[0][0] > self.window:
            self.recent.popleft()

    def last(self, now):
        """What the last few minutes add up to."""
        self.forget(now)
        out = Counter()
        for _, what, amount in self.recent:
            out[what] += amount
        return out

    @staticmethod
    def share(numbers, lines, screen):
        """How much of what the screen's number gained the lines account for. Over 100% is lines counted twice. None: nothing to compare."""
        return numbers[lines] / numbers[screen] if numbers[screen] > 0 else None

    def line(self, now):
        """How much is being read, in words."""
        n, parts = self.last(now), []
        for label, lines, screen in (("EXP", "exp_lines", "exp_bar"), ("mesos", "mesos_checked", "mesos_box")):
            s = self.share(n, lines, screen)
            if s is not None:
                parts.append(f"{label} {s:.0%}")
        seen = n["items_read"] + n["items_unread"]
        if seen:
            parts.append(f"item names {n['items_read']:,} of {seen:,}")
        text = ("Reading, last 5 minutes: " + " · ".join(parts)) if parts else "Reading: nothing to compare yet"
        if self.total["exp_bar"] > 0:
            text += (f"\nEXP since it opened: lines read {self.total['exp_lines']:,}, and the number by your MP went up "
                     f"{self.total['exp_bar']:,} ({self.total['exp_lines'] / self.total['exp_bar']:.0%}). Over 100% is lines counted twice.")
        if self.total["exp_lump"] > 0:
            text += f"\nLeft out of that: {self.total['exp_lump']:,} EXP that came all at once, most likely from a quest."
        if self.last_check:
            counted, gained = self.last_check
            text += f"\nLast check against your inventory: counted {counted:,} mesos picked up, and it went up by {gained:,}"
        return text

    def mesos_seen(self, value, t, in_town=False):
        """The mesos count, read off the inventory whenever it's open. The mesos lines since it was last seen ought to add
        up to the difference, however long it's been closed. Mesos going down, or a town (a shop), means there's nothing to
        compare: it starts again from here."""
        if in_town:
            self.visited_town = True
        if value == self.box_value:
            return
        gained = None if self.box_value is None else value - self.box_value
        if gained is not None and gained > 0 and not self.visited_town:
            self.add("mesos_box", gained, t)
            self.add("mesos_checked", self.since_seen, t)
            self.last_check = (self.since_seen, gained)
        self.box_value, self.since_seen, self.visited_town = value, 0, in_town

    def mesos_line(self, amount, t):
        self.add("mesos_lines", amount, t)
        self.since_seen += amount

    def results(self):
        return {k: self.total[k] for k in ("exp_lines", "exp_bar", "exp_lump", "mesos_lines", "mesos_checked", "mesos_box", "items_read", "items_unread")}


class Stretch:
    """A span of time on a map. species: the one kind in it. None: any kinds, for the listed items."""

    def __init__(self, species, begins, counts_from):
        self.species, self.begins, self.counts_from = species, begins, counts_from
        self.kills, self.picks = [], []
        self.exp_lines = self.exp_bar = 0
        self.biggest = 0                # the biggest single line: the bar's readings lag behind it, so that much is let off


class LineCounter:
    quest_exp = 0                       # a quest's EXP read off the screen, that the number hasn't shown yet

    """Feed it what the lines say. All times from the same clock."""

    def __init__(self, data):
        self.data = data
        self.map = None
        self.party_until = -1.0
        self.open = None                # the stretch going on, of one kind
        self.span = None                # the time going on, alone on this map, with any kinds
        self.meter = Meter()
        self.kills = Counter()          # species -> kills counted
        self.drops = {}                 # species -> Counter of item -> how many times it was picked up
        self.mesos = {}                 # species -> [how many times, total]
        self.skipped = Counter()        # why -> kills not counted
        self.stretches = 0
        self.odd_amounts = Counter()    # EXP lines that fit no monster here: worth a look if one keeps coming
        self.solo_kills = Counter()     # species -> kills named by their line, alone, whatever else was going on
        self.listed = {}                # species -> item -> [how many picked up, kills in that time]
        self.on_maps = {}               # map -> Counter of item -> how many times it was picked up there, whoever it came from

    # ---------- what comes in ----------

    def set_map(self, name, now):
        if name != self.map:
            self._close(now, "away")
            self._close_span(now)
            self.map = name

    def party(self, t):
        self._close(t, "party")
        self._close_span(t)
        self.party_until = max(self.party_until, t + PARTY_S)

    def bonus_amount(self, amount, t):
        """A bonus line's EXP is still EXP the bar gains."""
        if amount:
            self.meter.add("exp_lines", amount, t)

    def kill(self, amount, t):
        """A "You received EXP" line."""
        if amount:
            self.meter.add("exp_lines", amount, t)
        if t <= self.party_until:
            self.skipped["party"] += 1
            return
        if self.map is None:
            self.skipped["nomap"] += 1
            return
        species = self._species_for(amount)
        self._span_kill(species, amount, t)
        if species is None:
            self._close(t, "exp")
            self.skipped["exp"] += 1
            self.odd_amounts[amount] += 1
            return
        s = self.open
        if s and s.species != species:
            self._close(t, "changed")
            s = None
        elif s and t - s.counts_from >= CHUNK_S:
            last = s.kills[-1]
            self._close(t, "chunk")     # (carries straight on: this kind's been going on for minutes, nothing's left over)
            s = self.open = Stretch(species, s.begins, last)
        if s is None:
            s = self.open = Stretch(species, t, t + LEAD_S)
        s.kills.append(t)
        if t > s.counts_from and amount:
            s.exp_lines += amount
            s.biggest = max(s.biggest, amount)

    def pickup(self, name, qty, t):
        if name == "mesos":
            self.meter.mesos_line(qty, t)
        else:
            self.meter.add("items_read", 1, t)
            if self.map:
                self.on_maps.setdefault(self.map, Counter())[name] += 1
        if self.open:
            self.open.picks.append((name, qty, t))
        if self.span and name != "mesos":
            self.span.picks.append((name, qty, t))

    def unread(self, t):
        """A white line that couldn't be read."""
        self.meter.add("items_unread", 1, t)

    def quest_reward(self, exp, mesos, t):
        """A quest's reward was read off the screen: EXP and mesos no line will say."""
        self.quest_exp += exp
        if mesos:
            self.meter.visited_town = True      # (so the mesos start again from here, as after a shop)

    def exp_number(self, gained, t):
        """The EXP number's gone up by this much since the last reading. A quest's reward has no line to read: a big jump is one,
        even if its reward wasn't seen, and its mesos come with it."""
        taken = min(gained, self.quest_exp)
        if taken:
            self.quest_exp -= taken
            self.meter.add("exp_lump", taken, t)
            gained -= taken
        if not gained:
            return
        if gained >= max(LUMP_LEAST, LUMP_TIMES * self.meter.biggest):
            self.meter.add("exp_lump", gained, t)
            self.meter.visited_town = True      # (so the mesos start again from here, as after a shop)
        else:
            self.exp_bar(gained, t)

    def exp_bar(self, gained, t):
        """The EXP bar's gone up by this much, from kills."""
        self.meter.add("exp_bar", gained, t)
        for s in (self.open, self.span):
            if s and t > s.counts_from:
                s.exp_bar += gained

    def mesos_seen(self, value, t, in_town=False):
        """The mesos count, off the inventory, whenever it's open."""
        self.meter.mesos_seen(value, t, in_town)

    def other_kill(self, species, t):
        """The pictures saw this kind vanish, and no EXP line went with it: someone else's kill, or something hidden."""
        if self.open and species != self.open.species:
            self._close(t, "others")

    def away(self, t):
        """The game's gone out of front: nothing's being read now."""
        self._close(t, "away")
        self._close_span(t)

    # ---------- working it out ----------

    def _species_for(self, amount):
        """Which monster on this map gives this much EXP, if exactly one kind does."""
        if not amount or not self.data:
            return None
        got = [s for s in self.data.species_on(self.map) if self.data.exp_of(s) == amount]
        return got[0] if len(got) == 1 else None

    def _span_kill(self, species, amount, t):
        s = self.span
        if s and t - s.counts_from >= CHUNK_S:
            last = s.kills[-1][1]
            self._close_span(t)
            s = self.span = Stretch(None, s.begins, last)
        if s is None:
            s = self.span = Stretch(None, t, t + LEAD_S)
        s.kills.append((species, t))
        if t > s.counts_from and amount:
            s.exp_lines += amount
            s.biggest = max(s.biggest, amount)

    def _owners(self):
        """Which items here only one kind on this map is known to drop: {item: species}."""
        species, out = self.data.species_on(self.map) if self.data else [], {}
        for s in species:
            if sum(self.data.exp_of(o) == self.data.exp_of(s) for o in species) != 1:
                continue                # (its kills can't be told from another kind's)
            for item in self.data.drops_of(s):
                if not any(o != s and self.data.known_drop(o, item) for o in species):
                    out[item] = s
        return out

    def _worked_out_span(self, s):
        """What a span comes to: ({species: kills}, {species: {item: [picked up, kills]}})."""
        counted = [k for k in s.kills if k[1] > s.counts_from]
        if not counted or (s.exp_bar > 0 and s.exp_lines + s.biggest < MIN_READ * s.exp_bar):
            return {}, {}
        kills = Counter(k[0] for k in counted if k[0])
        picks, listed = [p for p in s.picks if s.counts_from < p[2] <= counted[-1][1]], {}
        for item, owner in self._owners().items():
            if kills[owner]:
                got = sum(1 for p in picks if _same_item(item, p[0]))
                listed.setdefault(owner, {})[item] = [got, kills[owner]]
        return kills, listed

    def _close_span(self, t):
        s, self.span = self.span, None
        if s:
            kills, listed = self._worked_out_span(s)
            self._add_span(self.solo_kills, self.listed, kills, listed)

    @staticmethod
    def _add_span(solo_kills, into, kills, listed):
        solo_kills.update(kills)
        for owner, items in listed.items():
            have = into.setdefault(owner, {})
            for item, (got, n) in items.items():
                m = have.setdefault(item, [0, 0])
                m[0] += got
                m[1] += n

    def _worked_out(self, s, end):
        """What a stretch comes to, if it ended now: (kills, what was picked up, why any were left out)."""
        why = Counter()
        kills = [k for k in s.kills if k <= end]
        why["changed"] += len(s.kills) - len(kills)
        counted = [k for k in kills if k > s.counts_from]
        why["lead"] += len(kills) - len(counted)
        if not counted:
            return 0, [], why
        if s.exp_bar > 0 and s.exp_lines + s.biggest < MIN_READ * s.exp_bar:
            why["unread"] += len(counted)
            return 0, [], why
        return len(counted), [p for p in s.picks if s.counts_from < p[2] <= counted[-1]], why

    def _close(self, t, why):
        s, self.open = self.open, None
        if s is None:
            return
        kills, picks, left_out = self._worked_out(s, t)
        if why != "chunk" and left_out["changed"]:      # (kills after the end: the end was found out late)
            left_out[why] += left_out.pop("changed")
        self.skipped.update({k: v for k, v in left_out.items() if v})
        if kills:
            self.stretches += 1
            self._add(self.kills, self.drops, self.mesos, s.species, kills, picks)

    @staticmethod
    def _add(kills, drops, mesos, species, n, picks):
        kills[species] += n
        for name, qty, _ in picks:
            if name == "mesos":
                m = mesos.setdefault(species, [0, 0])
                m[0] += 1
                m[1] += qty
            else:
                drops.setdefault(species, Counter())[name] += 1

    # ---------- what goes out ----------

    def results(self, now):
        """Everything so far, the stretch still going included, by monsters' names. For the session file."""
        kills, drops, skipped = Counter(self.kills), {k: Counter(v) for k, v in self.drops.items()}, Counter(self.skipped)
        mesos = {k: list(v) for k, v in self.mesos.items()}
        solo, listed = Counter(self.solo_kills), {k: {i: list(m) for i, m in v.items()} for k, v in self.listed.items()}
        if self.span:
            self._add_span(solo, listed, *self._worked_out_span(self.span))
        if self.open:
            n, picks, left_out = self._worked_out(self.open, now)
            skipped.update({k: v for k, v in left_out.items() if v})
            if n:
                self._add(kills, drops, mesos, self.open.species, n, picks)
        name = self.data.name_of if self.data else str
        return {"kills": {name(s): n for s, n in kills.items()}, "drops": {name(s): dict(c) for s, c in drops.items()},
                "mesos": {name(s): m for s, m in mesos.items()}, "skipped": dict(skipped), "stretches": self.stretches,
                "solo_kills": {name(s): n for s, n in solo.items()},
                "listed": {name(s): v for s, v in listed.items()},
                "on_maps": {m: dict(c) for m, c in self.on_maps.items()},
                "odd_amounts": {str(k): v for k, v in self.odd_amounts.most_common(10)}, "read": self.meter.results()}
