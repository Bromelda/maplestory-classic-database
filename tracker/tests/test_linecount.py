"""Counting from the message lines (linecount.py), on real map names and the database's real numbers. Run it:
python tests/test_linecount.py"""
import sys
from pathlib import Path
from types import SimpleNamespace as NS

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from dropscan import feed, learned_lines, next_look  # noqa: E402
from linecount import CHUNK_S, LEAD_S, PARTY_S, LineCounter, Meter  # noqa: E402
from scandata import GameData  # noqa: E402

failures = 0
DATA = GameData(ROOT / "assets" / "scan_data.json")


def check(name, ok, detail=""):
    global failures
    print(("PASS " if ok else "FAIL ") + name + (f"   {detail}" if detail and not ok else ""))
    failures += not ok


ONE_KIND = next(name for name, m in DATA.maps.items() if len(m["spawns"]) == 1 and DATA.exp_of(m["spawns"][0]))
ONLY = DATA.maps[ONE_KIND]["spawns"][0]
MIXED = "Deep Valley II"
BOAR, STUMP = "fire_boar", "axe_stump"
check("the map used here has the monsters this expects", {BOAR, STUMP} <= set(DATA.species_on(MIXED)), DATA.species_on(MIXED))
XP = DATA.exp_of(ONLY)
name = DATA.name_of


def counter(where=ONE_KIND):
    c = LineCounter(DATA)
    c.set_map(where, 0.0)
    return c


def hunt(c, start, kills, every=5.0, xp=XP):
    """Kills, one every few seconds: returns when the last one was."""
    for k in range(kills):
        c.kill(xp, start + k * every)
    return start + (kills - 1) * every


# One kind of monster, alone.
c = counter()
last = hunt(c, 100.0, 21)
inside = 100.0 + LEAD_S + 1
c.pickup("Thing", 1, inside)
c.pickup("mesos", 50, inside + 2)
c.pickup("Too Early", 1, 100.0 + LEAD_S - 1)
c.pickup("Too Late", 1, last + 1)
c.away(last + 2)
r = c.results(last + 2)
want = sum(1 for k in range(21) if 100.0 + k * 5.0 > 100.0 + LEAD_S)
check("kills count after the start of the stretch", r["kills"].get(name(ONLY)) == want, r)
check("the start's are skipped, and said so", r["skipped"].get("lead") == 21 - want, r["skipped"])
check("an item in the stretch counts", r["drops"][name(ONLY)].get("Thing") == 1, r["drops"])
check("mesos in the stretch count", r["mesos"][name(ONLY)] == [1, 50], r["mesos"])
check("what's picked up at the start doesn't: it may be left over", "Too Early" not in r["drops"][name(ONLY)], r["drops"])
check("what's picked up after the last kill doesn't", "Too Late" not in r["drops"][name(ONLY)], r["drops"])

# A stretch that's still going counts, in what's saved, and doesn't get counted twice.
c = counter()
last = hunt(c, 0.0, 11)
first = c.results(last)["kills"]
check("a stretch still going shows", first.get(name(ONLY)), first)
check("looking doesn't change it", c.results(last)["kills"] == first and not c.kills)

# Kills decide it, not drops: a kill that dropped nothing is a kill.
c = counter()
last = hunt(c, 0.0, 11)
check("no drops at all is still kills", c.results(last)["kills"].get(name(ONLY)) and not c.results(last)["drops"])

# Another kind ends a stretch.
c = counter(MIXED)
a, b = DATA.exp_of(BOAR), DATA.exp_of(STUMP)
last = hunt(c, 0.0, 11, xp=a)
c.pickup("Thing", 1, 40.0)
c.kill(b, last + 1)
c.pickup("After", 1, last + 2)
last2 = hunt(c, last + 3, 3, xp=a)
r = c.results(last2)
check("another kind ends a stretch", r["kills"].get(name(BOAR)) == 6 and r["drops"][name(BOAR)] == {"Thing": 1}, r)
check("and a new one needs its own start", name(STUMP) not in r["kills"], r["kills"])
check("what's picked up then counts for neither", "After" not in str(r["drops"]), r["drops"])

# The lines still name the kills, however mixed, and an item only one kind here drops can be counted.
c = counter(MIXED)
tooth = next(i for i in DATA.drops_of(BOAR) if i == "Fire Boar's Tooth")
check("this item's only known from the one kind here", [s for s in DATA.species_on(MIXED) if DATA.known_drop(s, tooth)] == [BOAR])
for k in range(60):
    c.kill(a if k % 2 else b, k * 2.0)
    if k in (21, 41):
        c.pickup(tooth, 1, k * 2.0 + 0.5)
    if k == 31:
        c.pickup("Maple Leaf", 1, k * 2.0 + 0.5)
r = c.results(120.0)
boars = sum(1 for k in range(60) if k % 2 and k * 2.0 > LEAD_S)
check("mixed kills still get named", r["solo_kills"].get(name(BOAR)) == boars and r["solo_kills"].get(name(STUMP)), r["solo_kills"])
check("a mixed hunt has no stretches", not r["kills"], r["kills"])
check("an item only it drops counts, against its kills", r["listed"][name(BOAR)].get(tooth) == [2, boars], r["listed"].get(name(BOAR), {}).get(tooth))
check("an item several kinds drop isn't", "Maple Leaf" not in str(r["listed"]), r["listed"])
check("no drop still counts as a kill for what it could have dropped",
      all(m == [0, boars] for i, m in r["listed"][name(BOAR)].items() if i != tooth), r["listed"][name(BOAR)])
c2 = counter(MIXED)
c2.kill(a, 0.0)
c2.kill(a, LEAD_S + 1)
c2.pickup(tooth[:9] + "...", 1, LEAD_S + 0.5)
check("a name cut short still counts", c2.results(30.0)["listed"][name(BOAR)][tooth][0] == 1, c2.results(30.0)["listed"][name(BOAR)][tooth])

# Two kinds here giving the same EXP: their kills can't be told apart.
same = next(((m, s, o) for m, v in DATA.maps.items() for s in v["spawns"] for o in v["spawns"]
             if s != o and DATA.exp_of(s) and DATA.exp_of(s) == DATA.exp_of(o)), None)
check("the database has such a map", same is not None)
c = counter(same[0])
hunt(c, 0.0, 11, xp=DATA.exp_of(same[1]))
r = c.results(60.0)
check("the same EXP as another kind here names nobody", not r["kills"] and not r["solo_kills"] and r["skipped"]["exp"] == 11, r)
check("and its items aren't anyone's", not [i for i, o in c._owners().items() if o in same[1:]])

# What isn't known, and what doesn't count.
c = counter()
c.kill(XP + 1000, 5.0)
check("an amount that fits nothing is noted", c.skipped["exp"] == 1 and c.odd_amounts[XP + 1000] == 1)
c = LineCounter(DATA)
c.kill(XP, 5.0)
check("no map yet: nothing", c.skipped["nomap"] == 1 and not c.open)
c = counter()
last = hunt(c, 0.0, 11)
c.party(last + 1)
c.kill(XP, last + 2)
check("a party ends it", c.skipped["party"] == 1 and c.kills[ONLY] == 6, (c.skipped, c.kills))
c.kill(XP, last + 1 + PARTY_S)
check("and goes on counting as one for a while", c.skipped["party"] == 2, c.skipped)
c.kill(XP, last + 2 + PARTY_S)
check("then it's alone again", c.open is not None)
c = counter()
last = hunt(c, 0.0, 11)
c.set_map("Deep Valley II", last + 1)
check("a new map ends it", not c.open and not c.span and c.kills[ONLY] == 6)
c = counter()
last = hunt(c, 0.0, 11)
c.away(last + 1)
check("the game going out of front ends it", not c.open and not c.span and c.kills[ONLY] == 6)
c = counter(MIXED)
hunt(c, 0.0, 11, xp=a)
c.other_kill(STUMP, 30.0)
check("the pictures seeing another kind die, with no line, ends it", not c.open and c.kills[BOAR] == 2, (c.open, c.kills))
check("kills after that don't count, and say why", c.skipped["others"] == 4, c.skipped)
c = counter(MIXED)
hunt(c, 0.0, 11, xp=a)
c.other_kill(BOAR, 30.0)
check("another of the same kind doesn't", c.open is not None)

# The EXP bar against the lines.
c = counter()
last = hunt(c, 0.0, 11)
c.exp_bar(XP * 100, last)
check("lines not adding up to the bar: left out", not c.results(last)["kills"], c.results(last))
c.away(last + 1)
check("and said why", c.skipped["unread"] == 6 and not c.kills, (c.skipped, c.kills))
check("the same for the listed items", not c.solo_kills, c.solo_kills)
c = counter()
last = hunt(c, 0.0, 11)
c.exp_bar(XP * 6, last)
check("lines adding up to the bar: fine", c.results(last)["kills"].get(name(ONLY)) == 6, c.results(last))
c = counter()
last = hunt(c, 0.0, 11)
c.exp_bar(XP * 7, last)
check("one line's worth out is the bar being behind, not a miss", c.results(last)["kills"].get(name(ONLY)) == 6, c.results(last))
c = counter()
last = hunt(c, 0.0, 11)
check("no bar to compare with doesn't stop it", c.results(last)["kills"].get(name(ONLY)) == 6)

# A long stretch is checked in pieces: a bad minute costs only its own piece.
c = counter()
every = 10.0
n = int(2 * CHUNK_S / every)
bad_from = CHUNK_S + LEAD_S + 50
for k in range(n):
    t = k * every
    c.kill(XP, t)
    if k and t > LEAD_S:
        c.exp_bar(XP * (20 if t > bad_from else 1), t)
c.away(n * every)
check("a long stretch keeps its good piece", 0 < c.kills[ONLY] < n - LEAD_S / every and c.skipped["unread"] > 0, (c.kills, c.skipped))
check("every kill's accounted for, once", c.kills[ONLY] + sum(c.skipped.values()) == n, (c.kills, c.skipped, n))
c = counter()
for k in range(int(2.5 * CHUNK_S / every)):
    c.kill(XP, k * every)
    if k == 40:
        c.pickup("Mid", 1, k * every + 1)
c.away(1e6)
check("nothing's lost or doubled between the pieces", c.drops[ONLY]["Mid"] == 1 and c.kills[ONLY] + c.skipped["lead"] == int(2.5 * CHUNK_S / every), (c.kills, c.skipped))

# The meter.
m = Meter(window=100.0)
check("nothing to compare says so", "nothing" in m.line(0.0))
m.add("exp_lines", 90, 10.0)
m.add("exp_bar", 100, 11.0)
m.add("mesos_checked", 30, 12.0)
m.add("mesos_box", 60, 13.0)
m.add("items_read", 3, 14.0)
m.add("items_unread", 1, 15.0)
text = m.line(20.0)
check("it says how much was read", "EXP 90%" in text and "mesos 50%" in text and "item names 3 of 4" in text, text)
m.add("exp_bar", 1, 200.0)
check("only the last few minutes", "EXP 0%" in m.line(200.0), m.line(200.0))
check("the run's totals are kept", m.results()["exp_lines"] == 90 and m.results()["exp_bar"] == 101, m.results())
m = Meter()
m.add("exp_lines", 200, 1.0)
m.add("exp_bar", 100, 1.0)
check("lines past the bar show, as counted twice", "EXP 200%" in m.line(2.0), m.line(2.0))
m = Meter()
m.mesos_line(200, 1.0)
check("with the inventory never seen, no mesos figure", "mesos" not in m.line(2.0), m.line(2.0))

# Checked against the inventory, whenever it's open.
m = Meter()
m.mesos_seen(1000, 0.0)
check("the first look just says where it starts", "mesos" not in m.line(1.0), m.line(1.0))
m.mesos_line(70, 50.0)
m.mesos_line(20, 90.0)
check("with it closed, nothing to compare", "mesos" not in m.line(100.0), m.line(100.0))
m.mesos_seen(1100, 120.0)
check("open again: the lines against the difference", "mesos 90%" in m.line(121.0) and "counted 90" in m.line(121.0) and "up by 100" in m.line(121.0), m.line(121.0))
m = Meter()
m.mesos_seen(1000, 0.0)
m.mesos_line(50, 200.0)
m.mesos_seen(1050, 1000.0)
check("however long it was closed", "mesos 100%" in m.line(1001.0), m.line(1001.0))
m = Meter()
m.mesos_seen(1000, 0.0)
m.mesos_line(50, 10.0)
m.mesos_seen(800, 20.0)
check("mesos going down (spent): nothing to compare", "mesos" not in m.line(21.0) and m.since_seen == 0, m.line(21.0))
m.mesos_line(30, 25.0)
m.mesos_seen(830, 30.0)
check("and it starts again from there", "mesos 100%" in m.line(31.0), m.line(31.0))
m = Meter()
m.mesos_seen(1000, 0.0)
m.mesos_seen(1000, 5.0, in_town=True)
m.mesos_line(10, 6.0)
m.mesos_seen(5000, 20.0)
check("a town in between (selling): nothing to compare", "mesos" not in m.line(21.0), m.line(21.0))
m.mesos_line(40, 25.0)
m.mesos_seen(5040, 30.0)
check("and back out of town it starts again", "mesos 100%" in m.line(31.0), m.line(31.0))


# What the tracker's message reader says goes in the right way.
class Ledger:
    def __getattr__(self, name):
        return lambda *a: None


c = counter()
feed(Ledger(), [NS(kind="exp", amount=XP, born=1.0)], [], 1.0, c)
check("feed: an EXP line's a kill", c.open and len(c.open.kills) == 1 and c.meter.total["exp_lines"] == XP)
feed(Ledger(), [], [("mesos", 7), ("item", "Thing", 2, "Etc"), ("unread",), ("exp", XP)], 2.0, c)
check("feed: pickups and unread lines", c.meter.total["mesos_lines"] == 7 and c.meter.total["items_read"] == 1 and c.meter.total["items_unread"] == 1, c.meter.total)
feed(Ledger(), [NS(kind="bonus", amount=4, born=3.0)], [], 3.0, c)
check("feed: a bonus line's a party, and EXP", c.party_until > 3.0 and c.meter.total["exp_lines"] == XP + 4 and not c.open)

# The Log page.
text = learned_lines([{"line": {"solo_kills": {"Pig": 40}, "kills": {"Pig": 30}, "skipped": {"lead": 5},
                                "listed": {"Pig": {"Pig's Ribbon": [12, 40], "Other": [0, 40]}}}},
                      {"line": {"solo_kills": {"Pig": 10}, "listed": {"Pig": {"Pig's Ribbon": [3, 10]}}}}], {})
check("the lines' count shows first", "50 kills named" in text[0] and "Pig 50 of 200" in text[0], text)
check("items add up, and rare ones show against their kills", "Pig's Ribbon 15 in 50 Pig" in " ".join(text), text)
check("items never picked up aren't listed", "Other" not in " ".join(text), text)
check("stretches show", "30 kills" in " ".join(text), text)
check("old sessions without it are fine", learned_lines([{"kills": {"Pig": 1}}], {})[0].startswith("Seen in the pictures"))

# The beat.
check("on the beat", next_look(10.0, 10.05, 0.1) == 10.1)
check("a slow look's made up for", next_look(10.0, 10.15, 0.1) == 10.1)
check("a look that took twice as long's made up for too", next_look(10.0, 10.3, 0.1) == 10.1)
check("too far behind starts again", next_look(10.0, 10.5, 0.1) == 10.5)

print(f"\n{failures} failed" if failures else "\nAll passed")
sys.exit(1 if failures else 0)
