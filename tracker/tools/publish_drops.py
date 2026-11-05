"""Decides what the drop scanner has collected is good enough for the website, and writes it there.

    python tools/publish_drops.py                 shows what's ready and what isn't, and changes nothing
    python tools/publish_drops.py --write         also writes ../tools/scanned_drops.json

It won't write anything until the data passes these checks:

  Accuracy   Where the database already has counted rates (Slime, Green Mushroom, Pig and others), the
             scanner's rates must agree with them. If it were missing drops or crediting the wrong
             monster, this is where that would show. It needs at least MIN_COMPARED rates to compare.
  Pickups    Not too many pickups may be left with no monster to go to.
  Version    Only sessions from the current scanner version count. Change SCANNER_VERSION in scandata.py
             after any fix that affects counting, so results from before the fix can't mix in.

Then, for each monster:

  Rates      A monster's rates go up once it has --min-kills kills counted, and each item's rate once it's
             dropped --min-drops times. Rarer items go on the list without a percent.
  New drops  A drop the database doesn't have needs --min-seen sightings. Check its picture first.

Writing the file doesn't change the site. Committing and pushing it does: the data update then rebuilds.
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(SITE / "tools"))
from drop_report import add_up  # noqa: E402
from scandata import SCANNER_VERSION  # noqa: E402
from scanned_drops import rate_range  # noqa: E402

MIN_KILLS = 200             # kills of a monster before its rates go up
MIN_DROPS = 3               # times an item must drop before it gets a percent
MIN_SEEN = 2                # sightings before a drop that's new to the database goes up
COMPARE_KILLS = 100         # kills of a monster, on both sides, before its rates are compared
MIN_COMPARED = 5            # rates that must be compared before the accuracy check means anything
MIN_AGREE = 0.8             # share of them that must agree
MAX_UNTIED = 0.2            # share of pickups that may have no monster to go to


def compare(total, monsters):
    """The scanner's rates against the counted rates already in the database: [(monster, item, ours,
    theirs, agree)]. They agree if the ranges each could really be in overlap."""
    out = []
    names = {i["id"]: i["name"] for i in json.loads((SITE / "data" / "items.json").read_text(encoding="utf-8"))}
    for m in monsters:
        kills = total["kills"].get(m["name"], 0)
        if kills < COMPARE_KILLS:
            continue
        for row in m["drops"]:
            # (A rate the scanner has replaced is still there to compare against, under "was".)
            d = dict(row, **row["was"]) if row.get("was") else row
            if d.get("rate") is None or not d.get("kills") or d["kills"] < COMPARE_KILLS or (d.get("source") == "scanned" and not row.get("was")):
                continue
            if d["item"] == "meso":
                hits = total["mesos"].get(m["name"], [0, 0])[0]
            else:
                hits = total["drops"].get(m["name"], {}).get(names.get(d["item"], d["item"]), 0)
            mine = rate_range(hits, kills)
            theirs = rate_range(round(d["rate"] / 100 * d["kills"]), d["kills"])
            out.append((m["name"], names.get(d["item"], d["item"]), round(100 * hits / kills, 2), d["rate"],
                        mine[0] <= theirs[1] and theirs[0] <= mine[1]))
    return out


def problems_with(total, compared, accept):
    """What stops the data going on the website: [text]. Empty means it can go."""
    out = []
    for mob, kills in total["kills"].items():
        counts = dict(total["drops"].get(mob, {}), Mesos=total["mesos"].get(mob, [0])[0])
        out += [f"{mob} dropped {item} {hits} times in {kills} kills, which can't be right." for item, hits in counts.items() if hits > kills]
    picks = total["tied"] + total["untied"]
    if picks and total["untied"] / picks > MAX_UNTIED:
        out.append(f"{total['untied']} of {picks} pickups have no monster to go to (the most allowed is {MAX_UNTIED:.0%}). "
                   "The scanner is missing drops, so run a recording through tools/replay.py to see why.")
    if accept:
        return out
    agree = sum(1 for c in compared if c[4])
    if len(compared) < MIN_COMPARED:
        out.append(f"Only {len(compared)} rates could be compared with the database, and it needs {MIN_COMPARED}. Get {COMPARE_KILLS}+ "
                   "kills of a monster that already has counted rates (Slime, Green Mushroom, Pig).")
    elif agree / len(compared) < MIN_AGREE:
        out.append(f"Only {agree} of {len(compared)} rates agree with the database (it needs {MIN_AGREE:.0%}), so these numbers can't be trusted yet.")
    return out


def build(total, items_by_key, known_old, min_kills, min_drops, min_seen):
    """The file's contents, and what was left out and why. known_old: what's in the file now."""
    monsters, seen, waiting, unknown = {}, {}, {}, []

    def canon(name):
        got = items_by_key.get(name.lower())
        if got is None and name not in unknown:
            unknown.append(name)
        return got

    for mob, kills in total["kills"].items():
        if kills < min_kills:
            waiting[mob] = min_kills - kills
            continue
        drops = {}
        for name, hits in total["drops"].get(mob, {}).items():
            real = canon(name)
            if real and hits >= min_drops:
                drops[real] = hits
        entry = {"kills": kills, "drops": drops}
        m = total["mesos"].get(mob)
        if m and m[0]:
            entry["mesos"] = {"times": m[0], "total": m[1]}
        monsters[mob] = entry
    # A list entry needs the sightings, whether or not there are kills enough for a rate.
    for mob, items in total["new"].items():
        for name in items:
            real = canon(name)
            if real and total["seen"].get(mob, {}).get(name, 0) >= min_seen:
                seen.setdefault(mob, []).append(real)
    # Never lose what's already published (say, after the session files were cleared).
    kept = []
    for mob, entry in known_old.get("monsters", {}).items():
        if entry["kills"] > monsters.get(mob, {}).get("kills", 0):
            monsters[mob] = entry
            kept.append(mob)
    for mob, items in known_old.get("seen", {}).items():
        have = seen.setdefault(mob, [])
        have.extend(i for i in items if i not in have)
    return {"scanner_version": SCANNER_VERSION, "monsters": monsters, "seen": seen}, waiting, unknown, kept


def main(argv=None):
    ap = argparse.ArgumentParser(description="Check the scanner's data and publish what's ready.")
    ap.add_argument("folder", nargs="?", default=str(Path(os.environ.get("APPDATA", ".")) / "MapleEXP" / "drops"))
    ap.add_argument("--write", action="store_true", help="write the file for the website")
    ap.add_argument("--accept", action="store_true", help="publish without the comparison with the database")
    ap.add_argument("--min-kills", type=int, default=MIN_KILLS)
    ap.add_argument("--min-drops", type=int, default=MIN_DROPS)
    ap.add_argument("--min-seen", type=int, default=MIN_SEEN)
    ap.add_argument("--out", default=str(SITE / "tools" / "scanned_drops.json"))
    args = ap.parse_args(argv)

    total = add_up(args.folder, version=SCANNER_VERSION)
    print(f"Scanner version {SCANNER_VERSION}: {total['sessions']} sessions, {total['counted']} kills counted, "
          f"{sum(total['skipped'].values())} skipped, {total['ignored']} older sessions ignored.")
    monsters = json.loads((SITE / "data" / "monsters.json").read_text(encoding="utf-8"))
    compared = compare(total, monsters)
    if compared:
        print(f"\nAccuracy: {sum(1 for c in compared if c[4])} of {len(compared)} rates agree with the database")
        for mob, item, ours, theirs, agree in compared:
            print(f"  {'ok ' if agree else 'OFF'} {mob}: {item}  scanner {ours}%, database {theirs}%")
    problems = problems_with(total, compared, args.accept)

    items = {i["name"].lower(): i["name"] for i in json.loads((SITE / "data" / "items.json").read_text(encoding="utf-8"))}
    out = Path(args.out)
    old = json.loads(out.read_text(encoding="utf-8")) if out.exists() else {}
    data, waiting, unknown, kept = build(total, items, old, args.min_kills, args.min_drops, args.min_seen)
    print("\nReady for the website:" if data["monsters"] else "\nNo monster has enough kills for the website yet.")
    for mob, e in sorted(data["monsters"].items()):
        print(f"  {mob}: {e['kills']} kills, {len(e['drops'])} item rates" + (" (already published, kept)" if mob in kept else ""))
    for mob, need in sorted(waiting.items(), key=lambda kv: kv[1]):
        print(f"  needs {need} more kills: {mob}")
    for mob, names in sorted(data["seen"].items()):
        print(f"  new drops for {mob}: {', '.join(names)}")
    if unknown:
        print("Left out, not an item the database knows:", ", ".join(unknown))
    if problems:
        print("\nNot publishing yet:")
        for p in problems:
            print(f"  - {p}")
        return 1
    if not args.write:
        print("\nPasses the checks. Nothing was written. Run again with --write to write the file.")
        return 0
    data["updated"] = time.strftime("%Y-%m-%d")
    out.write_text(json.dumps(data, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"\nWrote {out}. Commit and push it to update the website.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
