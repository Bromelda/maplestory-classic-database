"""Adds up everything the drop scanner found into one page you can read, and one file for the database.

    python tools/drop_report.py [the drops folder]

The folder is normally %APPDATA%\\MapleEXP\\drops. It writes, in that folder:

    report.html              what was seen, how many kills counted, and why others were left out
    new_for_database.json    drops the database doesn't list yet, in the same shape as tools/player_drops.json.
                             Check them against the pictures before copying any across.
"""
import html
import json
import os
import sys
from collections import Counter
from pathlib import Path

WHY = {"mixed": "a different monster died on top of it", "unlocated": "another kill nearby couldn't be placed",
       "others": "another player's kill was mixed in", "party": "in a party", "left": "left something on the ground",
       "taken": "its drop vanished with no pickup line", "untied": "a pickup near it couldn't be tied to a spot",
       "camera": "the view jumped", "exp": "the EXP didn't fit this monster", "away": "left the map first"}


MIN_KILLS = 200             # kills of a monster before its rates go on the website (tools/publish_drops.py)


def add_up(folder, version=None):
    """Everything in the session files added up. With version, only the sessions from that scanner version."""
    total = {"counted": 0, "skipped": Counter(), "untied": 0, "tied": 0, "seen": {}, "kills": Counter(), "drops": {}, "mesos": {},
             "new": {}, "sessions": 0, "ignored": 0,
             "line": {"solo_kills": Counter(), "kills": Counter(), "drops": {}, "mesos": {}, "listed": {}, "skipped": Counter(), "read": Counter()}}
    for path in sorted(Path(folder).glob("session-*.json")):
        try:
            s = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if version is not None and s.get("version") != version:
            total["ignored"] += 1
            continue
        total["sessions"] += 1
        total["tied"] += s.get("tied_pickups", 0)
        total["counted"] += s.get("counted", 0)
        total["skipped"].update(s.get("skipped", {}))
        total["untied"] += s.get("untied_pickups", 0)
        total["kills"].update(s.get("kills", {}))
        for mob, items in s.get("drop_list", {}).items():
            total["seen"].setdefault(mob, Counter()).update(items)
        for mob, items in s.get("rate_drops", {}).items():
            total["drops"].setdefault(mob, Counter()).update(items)
        for mob, m in s.get("rate_mesos", {}).items():
            have = total["mesos"].setdefault(mob, [0, 0])
            have[0] += m[0]
            have[1] += m[1]
        for mob, items in s.get("new_drops", {}).items():
            have = total["new"].setdefault(mob, [])
            have.extend(i for i in items if i not in have)
        _add_lines(total["line"], s.get("line") or {})
    return total


def _add_lines(t, s):
    """What the message lines counted (linecount.py), added up. These stay apart from the rest: nothing here goes on the
    website until it's been checked against the monsters with counted rates."""
    t["solo_kills"].update(s.get("solo_kills") or {})
    t["kills"].update(s.get("kills") or {})
    t["skipped"].update(s.get("skipped") or {})
    t["read"].update(s.get("read") or {})
    for mob, items in (s.get("drops") or {}).items():
        t["drops"].setdefault(mob, Counter()).update(items)
    for mob, m in (s.get("mesos") or {}).items():
        have = t["mesos"].setdefault(mob, [0, 0])
        have[0] += m[0]
        have[1] += m[1]
    for mob, items in (s.get("listed") or {}).items():
        for item, m in items.items():
            have = t["listed"].setdefault(mob, {}).setdefault(item, [0, 0])
            have[0] += m[0]
            have[1] += m[1]


def _lines_section(t):
    """The report's part for what the message lines counted."""
    e = html.escape
    r = t["read"]
    parts = []
    if r.get("exp_bar"):
        parts.append(f"EXP {min(1, r.get('exp_lines', 0) / r['exp_bar']):.0%}")
    if r.get("mesos_box"):
        parts.append(f"mesos {min(1, r.get('mesos_checked', 0) / r['mesos_box']):.0%}")
    seen = r.get("items_read", 0) + r.get("items_unread", 0)
    if seen:
        parts.append(f"item names {r.get('items_read', 0)} of {seen}")
    if not t["solo_kills"] and not parts:
        return ""
    out = ["<h2>Counted from the message lines</h2>",
           "<p>Not on the website: these need checking against monsters with counted rates first.</p>"]
    if parts:
        out.append(f"<p>How much was read, against the EXP bar and mesos count: {e(', '.join(parts))}.</p>")
    if t["solo_kills"]:
        out.append("<p>Kills named by their line, alone: " + e(", ".join(f"{m} {n}" for m, n in t["solo_kills"].most_common())) + ".</p>")
    rows = [(mob, item, *m) for mob, items in t["listed"].items() for item, m in items.items() if m[0]]
    if rows:
        out.append("<h3>Items only one kind on the map drops</h3><ul>")
        out += [f"<li>{e(mob)}: {e(item)}, {got} in {n} kills ({got / n:.1%})</li>" for mob, item, got, n in sorted(rows, key=lambda x: (x[0], -x[2]))]
        out.append("</ul>")
    if t["kills"]:
        out.append("<h3>Stretches of one kind</h3><ul>")
        for mob, n in t["kills"].most_common():
            items = ", ".join(f"{i} {c} ({c / n:.1%})" for i, c in t["drops"].get(mob, Counter()).most_common())
            m = t["mesos"].get(mob)
            coins = f"; mesos {m[0]} times ({m[0] / n:.0%}), {m[1] / m[0]:.0f} on average" if m and m[0] else ""
            out.append(f"<li>{e(mob)}, {n} kills: {e(items) or 'no items'}{e(coins)}</li>")
        out.append("</ul>")
    return "\n".join(out)


def page(t):
    e = html.escape
    rows = []
    for mob in sorted(set(t["seen"]) | set(t["kills"])):
        kills = t["kills"].get(mob, 0)
        lines = []
        for item, times in sorted(t["seen"].get(mob, {}).items(), key=lambda kv: -kv[1]):
            counted = t["drops"].get(mob, {}).get(item, 0)
            rate = f"{counted} in {kills} kills ({100 * counted / kills:.1f}%)" if kills and counted else "seen, not enough for a rate"
            new = " <b>new</b>" if item in t["new"].get(mob, []) else ""
            lines.append(f"<tr><td>{e(item)}{new}</td><td>{times}</td><td>{rate}</td></tr>")
        m = t["mesos"].get(mob)
        if m and m[0] and kills:
            lines.append(f"<tr><td>Mesos</td><td>{m[0]}</td><td>{100 * m[0] / kills:.1f}% of kills, about {m[1] / m[0]:.0f} each</td></tr>")
        ready = "enough for the website" if kills >= MIN_KILLS else f"{MIN_KILLS - kills} more for the website"
        rows.append(f"<h2>{e(mob)} <small>{kills} kills counted, {ready}</small></h2><table><tr><th>Drop</th><th>Times seen</th><th>Rate</th></tr>{''.join(lines)}</table>")
    why = "".join(f"<li>{n}: {e(WHY.get(k, k))}</li>" for k, n in t["skipped"].most_common())
    return f"""<!doctype html><meta charset="utf-8"><title>Drop scanner report</title>
<style>body{{font:15px system-ui;margin:24px auto;max-width:760px;padding:0 16px}}table{{border-collapse:collapse;width:100%}}
td,th{{border-bottom:1px solid #8884;padding:4px 8px;text-align:left}}small{{font-weight:normal;opacity:.7}}</style>
<h1>Drop scanner report</h1>
<p>{t['sessions']} sessions. <b>{t['counted']} kills counted, {sum(t['skipped'].values())} skipped.</b>
{t['untied']} pickups couldn't be tied to a monster, so they aren't in here.</p>
<ul>{why}</ul>{''.join(rows)}{_lines_section(t["line"])}"""


def main():
    default = Path(os.environ.get("APPDATA", ".")) / "MapleEXP" / "drops"
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else default
    t = add_up(folder)
    (folder / "report.html").write_text(page(t), encoding="utf-8")
    (folder / "new_for_database.json").write_text(json.dumps(t["new"], ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{t['counted']} kills counted, {sum(t['skipped'].values())} skipped. Written to {folder}")


if __name__ == "__main__":
    main()
