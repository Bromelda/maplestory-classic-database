"""The drop rules (lootwatch.py), one situation at a time, as events with no pictures involved.
Run it:  python tests/test_lootwatch.py"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from lootwatch import DropLedger  # noqa: E402

failures = 0


def check(name, ok, detail=""):
    global failures
    print(("PASS " if ok else "FAIL ") + name + (f"   {detail}" if detail and not ok else ""))
    failures += not ok


class Data:
    """A small made-up game: two monsters live together on one map, one lives alone on another."""
    exp = {"pig": 13, "boar": 46, "slime": 3, "twin_a": 20, "twin_b": 20}
    drops = {"pig": {"pig's ribbon"}, "boar": {"boar tooth"}, "slime": {"squishy liquid"}}
    here = {"Mixed": ["pig", "boar"], "Alone": ["slime"], "Twins": ["twin_a", "twin_b"]}

    def species_on(self, name):
        return self.here.get(name, [])

    def exp_of(self, s):
        return self.exp.get(s)

    def known_drop(self, s, item):
        return item.lower() in self.drops.get(s, set())


def ledger(map_name="Mixed"):
    led = DropLedger(Data())
    led.set_map(map_name)
    return led


def run_to(led, t):
    now = 0.0
    while now <= t:
        led.tick(now)
        now += 0.25


def kill(led, species, x, t, exp=None, own=True, track=None):
    led.mob_gone(species, x, 100.0, t, track=track)
    if own:
        led.exp(exp if exp is not None else Data.exp[species], t + 0.1)


def drop(led, x, t, picked_at=None, name="Pig's Ribbon", qty=1):
    lo = led.loot_seen(x, 110.0, t)
    if picked_at is not None:
        led.loot_lost(lo.id, picked_at)
        led.pickup(name, qty, "Etc", picked_at + 0.1)
    return lo


# A clean kill: it dies, it drops, I pick it up there.
led = ledger()
kill(led, "pig", 500, 10.0)
drop(led, 505, 10.6, picked_at=12.0)
run_to(led, 30)
check("clean kill: on the list", led.drop_list().get("pig", {}).get("Pig's Ribbon") == 1, led.drop_list())
check("clean kill: on the rate", led.rates()["pig"]["items"]["Pig's Ribbon"] == (1, 1.0), led.rates())
check("clean kill: counted once", led.summary()["counted"] == 1 and led.summary()["skipped"] == 0, led.summary())

# A kill with no drop still counts for the rate: that's what makes it a rate.
led = ledger()
kill(led, "pig", 500, 10.0)
kill(led, "pig", 1500, 40.0)
drop(led, 1500, 40.5, picked_at=41.0)
run_to(led, 60)
check("kill with no drop counts: 1 in 2", led.rates()["pig"]["items"]["Pig's Ribbon"] == (1, 0.5), led.rates())

# Two different monsters dying on top of each other: nothing there counts.
led = ledger()
kill(led, "pig", 500, 10.0)
kill(led, "boar", 520, 10.5)
drop(led, 510, 11.0, picked_at=12.0)
run_to(led, 30)
check("different monsters together: no credit", not led.credits, led.credits)
check("different monsters together: both skipped", led.summary()["skipped"] == 2 and led.skipped["mixed"] == 2, led.summary())

# The same two, far apart on the map: both fine.
led = ledger()
kill(led, "pig", 500, 10.0)
kill(led, "boar", 1500, 10.5)
drop(led, 505, 11.0, picked_at=12.0)
drop(led, 1505, 11.0, picked_at=14.0, name="Boar Tooth")
run_to(led, 30)
check("different monsters far apart: each credited",
      led.drop_list().get("pig", {}).get("Pig's Ribbon") == 1 and led.drop_list().get("boar", {}).get("Boar Tooth") == 1, led.drop_list())

# Two of the same monster on top of each other: it makes no difference which.
led = ledger()
kill(led, "pig", 500, 10.0)
kill(led, "pig", 520, 10.3)
drop(led, 510, 11.0, picked_at=12.0)
run_to(led, 30)
check("same monster together: credited", led.drop_list().get("pig", {}).get("Pig's Ribbon") == 1, led.drop_list())
check("same monster together: 1 drop in 2 kills", led.rates()["pig"]["items"]["Pig's Ribbon"] == (1, 0.5), led.rates())

# Someone else's kill of the same monster, nearby: the list yes, the rate no.
led = ledger()
kill(led, "pig", 500, 10.0)
kill(led, "pig", 520, 10.3, own=False)
drop(led, 510, 11.0, picked_at=12.0)
run_to(led, 30)
check("other player's same monster: on the list", led.drop_list().get("pig", {}).get("Pig's Ribbon") == 1, led.drop_list())
check("other player's same monster: not on the rate", not led.rates() and led.skipped["others"] == 1, (led.rates(), led.skipped))

# Someone else's kill of a different monster, nearby: not counted.
led = ledger()
kill(led, "pig", 500, 10.0)
kill(led, "boar", 520, 10.3, own=False)
drop(led, 510, 11.0, picked_at=12.0)
run_to(led, 30)
check("other player's different monster: no credit", not led.credits and led.skipped["mixed"] == 1, (led.credits, led.skipped))

# Someone else's kill alone, and I pick up the drop later: the list, never the rate.
led = ledger()
kill(led, "pig", 500, 10.0, own=False)
drop(led, 505, 10.5, picked_at=20.0)
run_to(led, 40)
check("only another player's kill: on the list", led.drop_list().get("pig", {}).get("Pig's Ribbon") == 1, led.drop_list())
check("only another player's kill: no rate", not led.rates(), led.rates())

# Something picked up that was already lying there, no kill near it: nothing to say about it.
led = ledger()
drop(led, 505, 5.0, picked_at=8.0)
run_to(led, 20)
check("old item on the ground: no credit", not led.credits, led.credits)

# A kill that left its drop on the ground: out of the rate, so skipped junk doesn't look rare.
led = ledger()
kill(led, "pig", 500, 10.0)
kill(led, "pig", 1500, 100.0)
drop(led, 505, 10.5)
drop(led, 1505, 100.5, picked_at=102.0)
run_to(led, 120)
check("left on the ground: that kill's out", led.skipped["left"] == 1 and led.kills_counted["pig"] == 1, (led.skipped, led.kills_counted))
check("left on the ground: the rate is only from the other", led.rates()["pig"]["items"]["Pig's Ribbon"] == (1, 1.0), led.rates())

# A drop that vanished with no pickup line (someone took it): out too.
led = ledger()
kill(led, "pig", 500, 10.0)
lo = drop(led, 505, 10.5)
led.loot_lost(lo.id, 12.0)
run_to(led, 30)
check("taken by someone else: kill's out", led.skipped["taken"] == 1, led.skipped)

# In a party: list yes, rate no.
led = ledger()
led.party_exp(9.0)
kill(led, "pig", 500, 10.0)
drop(led, 505, 10.5, picked_at=12.0)
run_to(led, 30)
check("party: on the list", led.drop_list().get("pig", {}).get("Pig's Ribbon") == 1, led.drop_list())
check("party: no rate", not led.rates() and led.skipped["party"] == 1, (led.rates(), led.skipped))

# The monster was only hidden (it came back), and the EXP was another's: not a death.
led = ledger()
kill(led, "pig", 500, 10.0, own=False, track=7)
led.mob_back(7, 10.8)
drop(led, 505, 10.5, picked_at=12.0)
run_to(led, 30)
check("came back: not a death, so no credit", not led.credits, led.credits)

# My EXP line picks the vanishing it fits, not just the nearest in time.
led = ledger()
led.mob_gone("pig", 500, 100, 10.0)
led.mob_gone("boar", 1500, 100, 10.05)
led.exp(46, 10.1)
run_to(led, 30)
check("EXP line goes to the monster it fits", led.kills_seen["boar"] == 1 and led.kills_seen["pig"] == 0, led.kills_seen)

# The EXP says it was a different monster here than the sprite did: nobody knows, so out.
led = ledger()
led.mob_gone("pig", 500, 100, 10.0)
led.exp(46, 10.1)
drop(led, 505, 10.5, picked_at=12.0)
run_to(led, 30)
check("EXP disagrees with the sprite: no credit", not led.credits, led.credits)

# A kill nobody could place, of a different monster, at the same time: can't be sure, so out.
led = ledger()
kill(led, "pig", 500, 10.0)
led.exp(46, 10.2)
drop(led, 505, 10.5, picked_at=12.0)
run_to(led, 30)
check("different kill I couldn't place: no credit", not led.credits, led.credits)

# Two things left the ground at once from different monsters, one line: which? Nobody knows.
led = ledger()
kill(led, "pig", 500, 10.0)
kill(led, "boar", 1500, 10.0)
a = drop(led, 505, 10.5)
b = drop(led, 1505, 10.5)
led.loot_lost(a.id, 12.0)
led.loot_lost(b.id, 12.0)
led.pickup("Pig's Ribbon", 1, "Etc", 12.1)
run_to(led, 30)
check("two things gone at once, different monsters: no credit", not led.credits, led.credits)

# A credit, and then the item turns out to be still lying there (something had covered it).
led = ledger()
kill(led, "pig", 500, 10.0)
lo = drop(led, 505, 10.5, picked_at=12.0)
run_to(led, 20)
check("before it came back: credited", len(led.drop_list().get("pig", {})) == 1, led.drop_list())
led.loot_back(lo.id)
check("came back: the credit is taken away", not led.drop_list().get("pig"), led.drop_list())

# No pictures at all on a map where only one kind of monster lives: the list, never the rate.
led = ledger("Alone")
led.exp(3, 10.0)
led.pickup("Squishy Liquid", 1, "Etc", 12.0)
run_to(led, 30)
check("one-monster map, no pictures: on the list", led.drop_list().get("slime", {}).get("Squishy Liquid") == 1, led.drop_list())
check("one-monster map, no pictures: no rate", not led.rates(), led.rates())

# On a one-monster map, a pickup whose drop wasn't seen landing goes on the list, but the kill it may
# have come from can't then count as "dropped nothing", or the rate would come out too low.
led = ledger("Alone")
kill(led, "slime", 500, 10.0)
led.pickup("Squishy Liquid", 1, "Etc", 12.0)
run_to(led, 30)
check("unseen drop on a one-monster map: on the list", led.drop_list().get("slime", {}).get("Squishy Liquid") == 1, led.drop_list())
check("unseen drop on a one-monster map: kill's out of the rate", led.skipped["untied"] == 1 and not led.rates(), (led.skipped, led.rates()))

# No pictures on a map with several: nothing can be said.
led = ledger()
led.exp(13, 10.0)
led.pickup("Pig's Ribbon", 1, "Etc", 12.0)
run_to(led, 30)
check("two-monster map, no pictures: no credit", not led.credits, led.credits)

# A pickup with nowhere to go next to a kill: that kill can't be called "dropped nothing".
led = ledger()
kill(led, "pig", 500, 10.0)
led.pickup("Pig's Ribbon", 1, "Etc", 12.0)
run_to(led, 30)
check("pickup with no spot: kill's out of the rate", led.skipped["untied"] == 1 and not led.rates(), (led.skipped, led.rates()))

# Mesos are drops too, with an average.
led = ledger()
kill(led, "pig", 500, 10.0)
lo = led.loot_seen(505, 110, 10.5)
led.loot_lost(lo.id, 12.0)
led.pickup("mesos", 30, "", 12.1)
run_to(led, 30)
check("mesos: rate and average", led.rates()["pig"]["mesos"] == (1, 1.0, 30.0), led.rates())

# A drop the database doesn't have for this monster gets flagged.
led = ledger()
kill(led, "pig", 500, 10.0)
drop(led, 505, 10.5, picked_at=12.0, name="Dark Nightshift")
kill(led, "pig", 900, 20.0)
drop(led, 905, 20.5, picked_at=22.0)
run_to(led, 40)
check("new for the database is flagged", led.new_drops() == {"pig": ["Dark Nightshift"]}, led.new_drops())

# Leaving the map: what's unresolved doesn't count.
led = ledger()
kill(led, "pig", 500, 10.0)
drop(led, 505, 10.5)
led.set_map("Alone", now=11.5)
check("left the map: kill's out", led.skipped["away"] == 1 and not led.rates(), (led.skipped, led.rates()))

# The decision for the rate doesn't look at the drop: same situation, drop or no drop, same answer.
results = []
for with_drop in (False, True):
    led = ledger()
    kill(led, "pig", 500, 10.0)
    kill(led, "boar", 520, 10.5)
    if with_drop:
        drop(led, 510, 11.0, picked_at=12.0)
    run_to(led, 30)
    results.append((led.kills_counted["pig"], sum(led.skipped.values())))
check("decided before seeing the drop", results[0] == results[1] == (0, 2), results)

print(f"\n{failures} failed" if failures else "\nAll passed")
sys.exit(1 if failures else 0)
