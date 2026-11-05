# Project notes: MapleStory Classic DB

Handoff notes from the first build session (Nov 3, 2026, on claude.ai) for continuing in Claude Code.
Read this together with README.md.

## What it is

A free, fan-made database site for **MapleStory Classic World** (the 2026 release), built only from Classic data.
Never use old 2006-era, GMS v83 or MSEA tables.

- Repo: https://github.com/Bromelda/maplestory-classic-database (public)
- Live site: https://bromelda.github.io/maplestory-classic-database/ (GitHub Pages, `main` / root)
- Plain static site: `index.html`, `style.css`, `app.js` (core), `skills.js` (skill planner), `calc.js` (calculator).
  No build step. Run locally with `python3 -m http.server 8000`.

## Tabs

Home, World Map, Monsters, Items, Maps, Routes, Quests, NPCs, Calculator, Skills, Planner (`planner.js`), News.

- **World Map**: the game's own world maps and nodes (`tools/fetch_worldmap.py` → `data/worldmap.json`, `assets/worldmap`), with a switcher per island. Each map's `node` is worked out in `buildWorldNodes` in `app.js`, and nodes are colored by training level. On phones there are tappable area buttons.
- **Maps**: full map art from the game files (`tools/fetch_map_art.py` → `assets/map-art`), with sharpened minimaps (`tools/upscale_minimaps.py` → `assets/minimap-hd`) as the fallback. The auto-update does new maps. Monster sprites stand at their spawn points, with portals, NPC markers, and "How to get here" (neighbouring maps zoomed in on the portal, circled).
  Maps with no walking way in explain how you get there (job tests, Kerning PQ).
- **Monsters / Items**: stats, Classic drop tables with rates and kill counts, sprites.
- **Quests**: 325 quests as step-by-step guides, a tracker per character, and an "Only quests for my character" filter.
- **NPCs**: 187 NPCs, each location circled on the minimap.
- **Calculator**: Classic damage and accuracy formulas, equipment tiles with a search list (`data/gear.json`, every non-cash weapon and armor item with stats; stats and per-item bonus stats (`calc.gearBonus`, for scrolls and rolls) are added to the typed numbers), item icons and requirements (`tools/fetch_gear_info.py` → `assets/item`, `data/gear_info.json`), buffs that switch on and off, passive skill levels and potions (`tools/fetch_potions.py` → `data/potions.json`), AP auto-assign, a character sheet, a what-to-fight guide (kills, EXP, mesos and drop value per hour; `hourly` in `calc.js`), a skill and skill-level picker, a "Fight a monster" verdict, and a hits-to-kill table.
- **Skills**: an SP planner for every 1st and 2nd job skill at every level. It saves to the character, and the calculator uses it.
- **Saved characters**: multiple characters in localStorage, each with its own calc setup, skill plan and quest progress.
  Share build creates a `?build=` link.
- **Routes**: `findRoute` in `app.js` runs over the map portals plus `meta.boats`. Some maps have no route because the data has no portal in (NPC trips, subway tickets).
- **Search** in the header covers everything (`buildSearch` in `app.js`). Items now include shop, crafting and gear items, with `shops` and `crafts`.
- **Home**: `renderHome` in `app.js`. Jobs has no tab of its own now but still opens from Home and search. Patches and Log share the News tab.
- **Patches**: Nexon's Classic World posts. **Log**: daily changes (new drops, stat changes, quests).

## Data sources and rules

- Monster stats, maps, spawns, portals, NPCs, quests and drops come from **Club FM's public data repo**
  (github.com/maplefm/maplefm.github.io, branch `live`, `/data`). That repo carries the Classic game files via maplestory.io,
  plus MapleClassic Wiki data (CC BY-NC-SA 4.0).
- Drops are **player-counted Classic kills only** (MapleClassic Wiki via Club FM). Drop tables are server-side, so they can't be datamined.
- Skills (every level) come from the maplestory.io API, MCW v1 (launch v1.0.0). The Oct 29 patch (v1.1.0) changes are handled in `skills.js`:
  Poison Breath +10 is applied; Thunder Bolt and Focus are flagged because their new values aren't published yet.
- Oct 29 patch: Clang, Copper Drake, Drake and Tortie HP was **lowered**. The game files hold the current values, and the old ones show as a note.
- Damage formulas follow the majority (NiaDB, FullBoosts, MS-Classic): mastery ×0.7 and Attack Power counted ×2.
  There's a toggle for the MapleClassic Wiki variant (×0.8, ×1).
- **NiaDB (meowdb.com)**: their reuse policy forbids scraping or bulk copying without permission. Individual facts with credit are OK.
  Do NOT scrape it. An email asking permission went to contact@meowdb.com (subject "Permission request: MapleStory Classic DB").
- MapleClassic Wiki blocks bots and its reported-drops API, so its data is used through Club FM.
- Game images are © NEXON and used non-commercially, so the site must stay free, with no ads or paid features.

## Automation

- `.github/workflows/daily-update.yml` runs every 6 hours. It pulls Club FM data, adds sharpened minimaps and art for new maps,
  refreshes the world maps (`tools/fetch_worldmap.py`), rebuilds `data/*.json` (`tools/build_data.py`),
  logs changes (`tools/update_log.py` → `data/log.json`), fetches skills (`tools/fetch_skills.py`)
  and Nexon Classic posts (`tools/fetch_patches.py`), then commits.
- A personal scheduled task, "NiaDB daily updates", runs at 7:40 AM Pacific. It reads NiaDB's changelog and news pages and sends a digest
  to the user's phone. It does not touch the site.

## To do / ideas

Decided against: a bosses tab and party quest guides (not useful without people tracking them), market tools, accounts, minigames, separate pages for search engines, and a public drop report form.

1. **World map art**: the game's world map images are only about 636 px wide, so they're soft on big screens. Any redraw has to keep the layout exactly, because the nodes sit on the roads.
2. **Drop tracker desktop app** (Windows): like Minerva (github.com/itechify/minerva, MIT), it would read the Pickup Log by screen capture,
   but credit drops to monsters. Match "You received EXP (+N)" against the current map's spawn list
   (from the minimap title), then attribute the pickups that follow. Watch out for monsters with the same EXP, mixed looting and EXP events.
   Keep a permanent per-character drop log and feed results back to the site. Never touch game memory or files.
   Minerva's license requires our own name and art.
3. Thunder Bolt and Focus post-patch values, once published.
4. NiaDB reply: if they approve, add community-submitted drops (credited and linked).
5. Ideas: a training-spot guide (EXP per hour from spawns plus the calculator), equipment pages, and a site-wide search.
6. Watch for Forgotten Hollow, Orbis, El Nath and 3rd job. The auto-update pulls them in when the game data has them.

## Gotchas learned

- GitHub Pages lets browsers reuse files for 10 minutes, so a mix of old and new files can break a page right after a push. When `style.css`, `app.js`, `skills.js` or `calc.js` change, raise the `?v=` number on all four in `index.html`.
- The calculator's sheet (avoid, DEF, HP/MP, AP) and EXP to level use individual facts from NiaDB's formula pages, each linked under the results. Their reuse policy allows that with a link to the exact page, but not crawling or copying whole pages, so read them by hand and never fetch their data files.
- `data/items.json` only has items that drop or are used in quests. Shop-only gear is in `data/gear.json`, so it's in the calculator but has no item page. Club FM's item list has no attack for throwing stars and arrows, so `tools/fetch_ammo.py` gets it from maplestory.io (`incWAT`) into `data/ammo.json`.
- There's no Free Market button on the world map. Town pages with a door to it (Henesys, Perion) link to Free Market Entrance from their own panel.
- The what-to-fight guide loads Club FM's price summary only to value drops. There's no Market tab on purpose. Most monsters above level 25 have no counted drop rates yet, so their drop value shows as unknown and is never guessed.
- `tools/check_data.py` stops the auto-update from saving broken data. If it fails, nothing is committed, so look at that run's log.
- `sw.js` serves pages network-first and images cache-first. Raise its cache name if the caching rules change.
- `tools/player_drops.json` holds drops the owner saw in game, added by the build with no rate. Only first-hand reports go there, not lists from other sites. NiaDB's drop list still needs their permission.
- The Free Market's 20 numbered rooms are left out on purpose (`FREE_MARKET_ROOM` in `tools/build_data.py`, and their minimaps are removed in the workflow). Only Free Market Entrance stays, because it has four NPCs and two quests start there. The site has no market prices either.
- Map art is only fetched once per map and comes from MCW v1 (launch v1.0.0), so a patch that changes a map's look won't show until its `assets/map-art` file is deleted and fetched again.
- Test map clicks with a real mouse, not a simulated click event: moving a world map node during hover once swallowed every real click, and simulated clicks didn't show it.
- Don't redraw maps with AI: markers use exact coordinates on the image, so the art has to keep the same layout. maplestory.io's `/map/<id>/render` has its own unknown origin, so `fetch_map_art.py` finds it by matching the render to the minimap and fine-tunes it with footholds, then crops to the map's bounds.
- iPhone Safari wouldn't scroll a `position: fixed` full-screen sheet, so on phones detail pages render in the normal page flow (`body.sheet-open`).
- iOS zooms into inputs under 16px, so keep inputs at 16px on mobile.
- maplestory.io's MCW skill data keeps Poison Breath's and Arrow Bomb's real numbers in unnamed entries (ids 2101005 and 3101005). `skills.js` merges them.
