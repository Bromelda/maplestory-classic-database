"""From scanner sessions to the website's drop tables: the checks in tools/publish_drops.py and the merge in
the site's tools/scanned_drops.py, on the real database. Run it:  python tests/test_publish.py"""
import contextlib
import io
import json
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT))
import publish_drops as pub  # noqa: E402
import scanned_drops as sd  # noqa: E402
from scandata import SCANNER_VERSION  # noqa: E402

failures = 0
MONSTERS = json.loads((ROOT.parent / "data" / "monsters.json").read_text(encoding="utf-8"))
ITEMS = {i["id"]: i["name"] for i in json.loads((ROOT.parent / "data" / "items.json").read_text(encoding="utf-8"))}
SLIME = next(m for m in MONSTERS if m["name"] == "Slime")


def check(name, ok, detail=""):
    global failures
    print(("PASS " if ok else "FAIL ") + name + (f"   {detail}" if detail and not ok else ""))
    failures += not ok


def faithful_session(kills=1000, factor=1.0, version=SCANNER_VERSION):
    """A session whose rates match what the database has for Slime, multiplied by factor (a scanner that
    misses half the drops has factor 0.5)."""
    drops, mesos = {}, [0, 0]
    for d in SLIME["drops"]:
        if d["rate"] is None:
            continue
        hits = round(d["rate"] / 100 * kills * factor)
        if d["item"] == "meso":
            mesos = [hits, hits * 10]
        elif hits:
            drops[ITEMS[d["item"]]] = hits
    return {"version": version, "counted": kills, "skipped": {"left": 20}, "untied_pickups": 2, "tied_pickups": sum(drops.values()) + mesos[0],
            "drop_list": {"Slime": dict(drops)}, "new_drops": {}, "kills": {"Slime": kills},
            "rate_drops": {"Slime": drops}, "rate_mesos": {"Slime": mesos}}


def run(session_list, *args):
    """Runs the tool on these sessions. Returns (exit code, what it printed, the file it wrote, or None)."""
    folder = Path(tempfile.mkdtemp(prefix="publish"))
    try:
        for k, s in enumerate(session_list):
            (folder / f"session-{k}.json").write_text(json.dumps(s), encoding="utf-8")
        out = folder / "scanned.json"
        prior = [a for a in args if isinstance(a, dict)]
        if prior:
            out.write_text(json.dumps(prior[0]), encoding="utf-8")
        text = io.StringIO()
        with contextlib.redirect_stdout(text):
            code = pub.main([str(folder), "--out", str(out)] + [a for a in args if not isinstance(a, dict)])
        return code, text.getvalue(), (json.loads(out.read_text(encoding="utf-8")) if out.exists() else None)
    finally:
        shutil.rmtree(folder, ignore_errors=True)


# A scanner that counts correctly passes.
code, text, written = run([faithful_session()], "--write")
check("accurate data passes", code == 0, text)
check("...and is written", written and written["monsters"]["Slime"]["kills"] == 1000, written)
check("...with its mesos", written and written["monsters"]["Slime"].get("mesos", {}).get("times", 0) > 0, written)

# Showing what's ready changes nothing.
code, text, written = run([faithful_session()])
check("without --write nothing is written", code == 0 and written is None, written)

# A scanner missing most of the drops is caught by the comparison.
code, text, written = run([faithful_session(factor=0.4)], "--write")
check("missing most drops: refused", code == 1 and written is None, text)
check("...and says why", "agree with the database" in text, text)

# ...and so is one seeing too many.
code, text, written = run([faithful_session(factor=2.0)], "--write")
check("crediting too many drops: refused", code == 1 and written is None, text)

# More drops than kills is impossible, however it got there. It would also stop the site's data update.
impossible = faithful_session()
impossible["rate_drops"]["Slime"]["Leather"] = 5000
code, text, written = run([impossible], "--write", "--accept")
check("more drops than kills: refused", code == 1 and written is None and "can't be right" in text, text)

# With nothing to compare against, it won't go up on trust alone.
other = {"version": SCANNER_VERSION, "counted": 500, "skipped": {}, "untied_pickups": 0, "tied_pickups": 50,
         "drop_list": {"Wild Boar": {"Leather": 50}}, "new_drops": {}, "kills": {"Wild Boar": 500},
         "rate_drops": {"Wild Boar": {"Leather": 50}}, "rate_mesos": {}}
code, text, written = run([other], "--write")
check("nothing to compare with: refused", code == 1 and written is None and "could be compared" in text, text)
code, text, written = run([other], "--write", "--accept")
check("...unless the owner says so", code == 0 and written is not None, text)

# Too many pickups with no monster to go to: refused, even with --accept.
leaky = faithful_session()
leaky["untied_pickups"] = leaky["tied_pickups"]
code, text, written = run([leaky], "--write", "--accept")
check("too many untied pickups: refused", code == 1 and written is None and "no monster to go to" in text, text)

# Sessions from before a fix don't count.
code, text, written = run([faithful_session(version=SCANNER_VERSION - 1)], "--write")
check("older scanner versions are ignored", code == 1 and written is None and "1 older sessions ignored" in text, text)
code, text, written = run([faithful_session(factor=0.4, version=SCANNER_VERSION - 1), faithful_session()], "--write")
check("...and don't spoil newer ones", code == 0 and written["monsters"]["Slime"]["kills"] == 1000, text)

# Sessions add up.
half = faithful_session(kills=500)
code, text, written = run([half, faithful_session(kills=500)], "--write")
check("sessions add up", code == 0 and written["monsters"]["Slime"]["kills"] == 1000, text)

# Too few kills: not on the website yet, and it says how many more.
few = faithful_session()
few["kills"]["Wild Boar"] = 150
few["rate_drops"]["Wild Boar"] = {"Leather": 30}
code, text, written = run([few], "--write")
check("too few kills: left off", code == 0 and "Wild Boar" not in written["monsters"], (code, text))
check("...and says how many more", "needs 50 more kills: Wild Boar" in text, text)

# An item seen too few times gets no percent.
rare = faithful_session()
rare["rate_drops"]["Slime"]["Leather"] = 2
code, text, written = run([rare], "--write")
check("too few drops: no percent", "Leather" not in written["monsters"]["Slime"]["drops"], written["monsters"]["Slime"])

# A new drop needs two sightings, and has to be a real item.
new = faithful_session()
new["drop_list"]["Slime"].update({"Metal Wand": 1, "Dark Nightshift": 2, "Made Up Thing": 5})
new["new_drops"] = {"Slime": ["Metal Wand", "Dark Nightshift", "Made Up Thing"]}
code, text, written = run([new], "--write")
check("new drop seen twice goes up", "Dark Nightshift" in written["seen"].get("Slime", []), written.get("seen"))
check("new drop seen once waits", "Metal Wand" not in written["seen"].get("Slime", []), written.get("seen"))
check("something that isn't an item doesn't", "Made Up Thing" not in json.dumps(written) and "Made Up Thing" in text, text)

# What's published is never lost if the session files are gone.
old = {"monsters": {"Pig": {"kills": 900, "drops": {"Leather": 90}}}, "seen": {"Pig": ["Dark Nightshift"]}}
code, text, written = run([faithful_session()], "--write", old)
check("published data is kept", written["monsters"]["Pig"]["kills"] == 900 and "Dark Nightshift" in written["seen"]["Pig"], written)

# Once published, a monster can still be compared with the rate its scanner rate replaced, but never with itself.
total = {"kills": {"Pig": 500}, "mesos": {}, "drops": {"Pig": {"Leather": 50}}}
leather = next(k for k, v in ITEMS.items() if v == "Leather")
replaced = [{"name": "Pig", "drops": [{"item": leather, "rate": 10.0, "kills": 500, "source": "scanned", "was": {"rate": 40.0, "kills": 200}}]}]
got = pub.compare(total, replaced)
check("a replaced rate is still compared", len(got) == 1 and got[0][3] == 40.0 and not got[0][4], got)
own = [{"name": "Pig", "drops": [{"item": leather, "rate": 10.0, "kills": 500, "source": "scanned"}]}]
check("a scanner rate isn't compared with itself", pub.compare(total, own) == [], pub.compare(total, own))

# ---------- the merge into the site's tables ----------


def slug(name):
    return name.lower().replace("'", "").replace(" ", "_")


def merge(by_mob, data):
    folder = Path(tempfile.mkdtemp(prefix="merge"))
    try:
        path = folder / "scanned.json"
        path.write_text(json.dumps(data), encoding="utf-8")
        used = {}
        mesos = sd.merge(by_mob, used, slug, lambda m: m != "Nobody", lambda i: i != "Nothing", lambda i: 123, path)
        return mesos, used
    finally:
        shutil.rmtree(folder, ignore_errors=True)


counts = {"monsters": {"Pig": {"kills": 400, "drops": {"Leather": 40, "Pigs Ribbon": 100}, "mesos": {"times": 200, "total": 3000}}}}
rows = {"Pig": [{"item": "leather", "rate": None, "kills": None}, {"item": "pigs_ribbon", "rate": 20.0, "kills": 100},
                {"item": "old_item", "rate": 3.0, "kills": 100}]}
mesos, used = merge(rows, counts)
by = {d["item"]: d for d in rows["Pig"]}
check("a drop with no rate gets the scanner's", by["leather"]["rate"] == 10.0 and by["leather"]["source"] == "scanned", by["leather"])
check("more kills than the old count: scanner's rate", by["pigs_ribbon"]["rate"] == 25.0 and by["pigs_ribbon"]["kills"] == 400, by["pigs_ribbon"])
check("...keeping the old rate for later comparisons", by["pigs_ribbon"]["was"] == {"rate": 20.0, "kills": 100}, by["pigs_ribbon"])
check("a counted drop the scanner didn't see keeps its rate", by["old_item"]["rate"] == 3.0 and "source" not in by["old_item"], by["old_item"])
check("mesos: chance and average", by["meso"]["rate"] == 50.0 and mesos["Pig"] == 15, (by.get("meso"), mesos))
check("each rate has its range", by["leather"]["range"][0] < 10.0 < by["leather"]["range"][1], by["leather"])

rows = {"Pig": [{"item": "leather", "rate": 12.0, "kills": 900}]}
merge(rows, counts)
check("fewer kills than the old count: old rate stays", rows["Pig"][0]["rate"] == 12.0 and rows["Pig"][0]["kills"] == 900, rows)

rows = {}
merge(rows, {"seen": {"Pig": ["Dark Nightshift"]}})
check("a list-only drop has no rate", rows["Pig"] == [{"item": "dark_nightshift", "rate": None, "kills": None}], rows)

for label, bad in (("an unknown monster", {"monsters": {"Nobody": {"kills": 300}}}),
                   ("an unknown item", {"monsters": {"Pig": {"kills": 300, "drops": {"Nothing": 3}}}}),
                   ("more drops than kills", {"monsters": {"Pig": {"kills": 300, "drops": {"Leather": 301}}}}),
                   ("no kills", {"monsters": {"Pig": {"kills": 0}}})):
    try:
        merge({}, bad)
        check(f"{label} stops the build", False)
    except SystemExit:
        check(f"{label} stops the build", True)

low, high = sd.rate_range(10, 100)
check("the range is sensible: 10 in 100", 5 < low < 6.5 and 17 < high < 18.5, (low, high))
check("the range narrows with more kills", sd.rate_range(100, 1000)[1] - sd.rate_range(100, 1000)[0] < high - low)

print(f"\n{failures} failed" if failures else "\nAll passed")
sys.exit(1 if failures else 0)
