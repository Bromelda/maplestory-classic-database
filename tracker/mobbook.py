"""A page of which monster drops what, kept in the owner's Documents to open whenever they like. It only stays on this PC,
and nothing on it goes to the website: it's every session file (dropscan.py) added up, written again as they're saved.

A session counts the same pickup in more than one way (seen landing, in a stretch of one kind, or an item only one kind
on the map drops). Those overlap, so for each monster and item a session gives the largest of them, never the sum.

A hunt from before the current scanner version goes in a part of its own: what was read then may be wrong.
"""
import html
import json
import time
from collections import Counter
from pathlib import Path

from scandata import SCANNER_VERSION

FOLDER_NAME = "Maple Mob Drops"
FILE_NAME = "Mob drops.html"
RATE_KILLS = 30             # kills before a rough rate's worth showing


def _raise(have, key, n):
    have[key] = max(have.get(key, 0), n)


def _one_session(s):
    """What one session says about each monster: {mob: {"kills", "items", "mesos"}}. The largest of its counts: see above."""
    line = s.get("line") or {}
    kills, items, mesos = {}, {}, {}
    for counts in (s.get("kills"), line.get("kills"), line.get("solo_kills")):
        for mob, n in (counts or {}).items():
            _raise(kills, mob, n)
    for found in (s.get("drop_list"), line.get("drops")):
        for mob, got in (found or {}).items():
            for item, n in got.items():
                _raise(items.setdefault(mob, {}), item, n)
    for mob, got in (line.get("listed") or {}).items():
        for item, m in got.items():
            if m[0]:
                _raise(items.setdefault(mob, {}), item, m[0])
    for found in (s.get("rate_mesos"), line.get("mesos")):
        for mob, m in (found or {}).items():
            if m[0] > mesos.get(mob, (0, 0))[0]:
                mesos[mob] = (m[0], m[1])
    return {mob: {"kills": kills.get(mob, 0), "items": items.get(mob, {}), "mesos": mesos.get(mob, (0, 0))}
            for mob in set(kills) | set(items) | set(mesos)}


def add_up(sessions):
    """{"hunts", "mobs": {mob: {"kills", "items": Counter, "mesos": [times, total]}}, "maps": {map: Counter of item}}"""
    out = {"hunts": 0, "mobs": {}, "maps": {}}
    for s in sessions:
        out["hunts"] += 1
        for mob, got in _one_session(s).items():
            have = out["mobs"].setdefault(mob, {"kills": 0, "items": Counter(), "mesos": [0, 0]})
            have["kills"] += got["kills"]
            have["items"].update(got["items"])
            have["mesos"][0] += got["mesos"][0]
            have["mesos"][1] += got["mesos"][1]
        for name, items in ((s.get("line") or {}).get("on_maps") or {}).items():
            out["maps"].setdefault(name, Counter()).update(items)
    return out


def load_sessions(folder):
    """Every saved session: (from the current scanner version, from before it)."""
    new, old = [], []
    for path in sorted(Path(folder).glob("session-*.json")):
        try:
            s = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if isinstance(s, dict):
            (new if s.get("version") == SCANNER_VERSION else old).append(s)
    return new, old


def _mob_card(mob, m, data, ids):
    e = html.escape
    rows = []
    for item, n in sorted(m["items"].items(), key=lambda kv: (-kv[1], kv[0])):
        rate = f"{n / m['kills']:.0%}" if m["kills"] >= RATE_KILLS and n <= m["kills"] else ""
        new = ' <span class="new">not on the site</span>' if data and mob in ids and not data.known_drop(ids[mob], item) else ""
        rows.append(f"<tr><td>{e(item)}{new}</td><td class=n>{n:,}</td><td class=n>{rate}</td></tr>")
    times, total = m["mesos"]
    if times:
        rate = f"{times / m['kills']:.0%}" if m["kills"] >= RATE_KILLS and times <= m["kills"] else ""
        rows.append(f"<tr><td>Mesos <small>about {total / times:,.0f} each</small></td><td class=n>{times:,}</td><td class=n>{rate}</td></tr>")
    table = ("<table><tr><th>Drop</th><th class=n>Picked up</th><th class=n>Rough rate</th></tr>" + "".join(rows) + "</table>") if rows \
        else "<p class=none>Nothing it could say was from this monster yet.</p>"
    return f'<section class=card data-find="{e(mob.lower())} {e(" ".join(m["items"]).lower())}"><h3>{e(mob)} <small>{m["kills"]:,} kills named</small></h3>{table}</section>'


def _map_card(name, items, data, ids):
    """Everything picked up on a map, and who there is known to drop it."""
    e = html.escape
    species = data.species_on(name) if data else []
    rows = []
    for item, n in sorted(items.items(), key=lambda kv: (-kv[1], kv[0])):
        who = [data.name_of(s) for s in species if data.known_drop(s, item)] if data else []
        text = " or ".join(who) if who else '<span class="new">none of them, as far as the site knows</span>'
        rows.append(f"<tr><td>{e(item)}</td><td class=n>{n:,}</td><td>{text if not who else e(text)}</td></tr>")
    return (f'<section class=card data-find="{e(name.lower())} {e(" ".join(items).lower())}"><h3>{e(name)}</h3>'
            f"<table><tr><th>Item</th><th class=n>Picked up</th><th>Dropped by</th></tr>{''.join(rows)}</table></section>")


def _part(t, data):
    ids = {m["name"]: i for i, m in data.monsters.items()} if data else {}
    return "".join(_mob_card(mob, t["mobs"][mob], data, ids) for mob in sorted(t["mobs"])), ids


def page(new, old, data=None, now=None):
    """The page, from the sessions' results. data: scandata.GameData, for what the site already lists."""
    e = html.escape
    fresh, stale = add_up(new), add_up(old)
    cards, ids = _part(fresh, data)
    if not cards:
        cards = "<p class=none>No hunts on the fixed reader yet. Restart the tracker and hunt: they'll show up here.</p>"
    species_maps = {n: c for n, c in fresh["maps"].items() if not data or data.species_on(n)}
    maps = "".join(_map_card(n, species_maps[n], data, ids) for n in sorted(species_maps))
    maps = f"<h2>Everything picked up, by map</h2><p class=note>Includes items it can't pin on one monster, like a potion when two kinds there drop it.</p><div class=cards>{maps}</div>" if maps else ""
    older = ""
    if stale["mobs"]:
        old_cards = _part(stale, data)[0]
        older = (f'<details{"" if fresh["mobs"] else " open"}><summary>Older hunts: {stale["hunts"]} <b>(names or counts may be off)</b></summary>'
                 "<p class=note>From before the reader's fixes. Silver Ore could read as Iron Ore, and some lines were counted twice or missed. Kept so nothing's lost, but don't trust these numbers.</p>"
                 f"<div class=cards>{old_cards}</div></details>")
    when = e(now or time.strftime("%Y-%m-%d %H:%M"))
    return f"""<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mob drops</title>
<style>
:root{{color-scheme:light dark;--bg:#f6f6f4;--card:#fff;--text:#1f2023;--dim:#62656c;--line:#dfe0dc;--mark:#9a5b00}}
@media (prefers-color-scheme:dark){{:root{{--bg:#17181b;--card:#212226;--text:#ecedef;--dim:#a1a4ab;--line:#35373d;--mark:#f0b45a}}}}
body{{background:var(--bg);color:var(--text);font:15px/1.45 system-ui,sans-serif;margin:0 auto;max-width:1040px;padding:24px 16px}}
h1{{margin:0;font-size:26px}}h2{{margin:32px 0 4px;font-size:19px}}h3{{margin:0 0 8px;font-size:16px}}
small,.note,.none{{color:var(--dim);font-weight:400}}.note{{margin:4px 0 12px}}.none{{margin:0}}
input{{box-sizing:border-box;width:100%;max-width:360px;margin:14px 0 2px;padding:9px 11px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:inherit;font:inherit}}
.cards{{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;align-items:start;margin-top:12px}}
.card{{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}}
table{{border-collapse:collapse;width:100%}}th{{color:var(--dim);font-size:12px;font-weight:500;text-align:left}}
td,th{{border-bottom:1px solid var(--line);padding:4px 6px 4px 0;vertical-align:top}}tr:last-child td{{border-bottom:0}}
.n{{text-align:right;padding-right:0;padding-left:8px;white-space:nowrap;font-variant-numeric:tabular-nums}}
.new{{color:var(--mark);font-size:12px}}details{{margin-top:32px}}summary{{cursor:pointer;font-size:17px}}summary b{{color:var(--mark);font-weight:500}}
</style>
<h1>Mob drops</h1>
<p class=note>Updated {when}. Refresh to see the latest: it's rewritten about every 30 seconds while the tracker runs. Stays on this PC.</p>
<input id=find type=search placeholder="Find a monster or item" aria-label="Find a monster or item">
<h2>By monster</h2>
<p class=note>Only drops it's sure came from that kind. Kills in a party, or with EXP that didn't fit, aren't named, so kill counts run low and rough rates run high.</p>
<div class=cards>{cards}</div>
{maps}
{older}
<script>
document.getElementById('find').addEventListener('input',function(){{var q=this.value.trim().toLowerCase();
document.querySelectorAll('.card').forEach(function(c){{c.hidden=q&&c.dataset.find.indexOf(q)<0}});
if(q)document.querySelectorAll('details').forEach(function(d){{d.open=true}})}});
</script></html>"""


def write_page(folder, out_path, data=None):
    """Writes the page from the session files in this folder. Returns where, or None if it couldn't. Never stops the tracker."""
    try:
        out_path = Path(out_path)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = out_path.with_suffix(".tmp")
        tmp.write_text(page(*load_sessions(folder), data), encoding="utf-8")
        tmp.replace(out_path)
        return out_path
    except (OSError, ValueError, TypeError, KeyError, IndexError, AttributeError):
        return None
