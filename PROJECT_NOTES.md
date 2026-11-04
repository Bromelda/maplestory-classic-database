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

World Map, Monsters, Items, Maps, Quests, NPCs, Calculator, Skills, Market, Jobs, Patches, Log.

- **World Map**: AI-illustrated fan art (`assets/world-map.webp`, made in ChatGPT from a text prompt) with areas placed by `ZONES` in `app.js`, colored by training level. On phones there are tappable area buttons.
- **Maps**: real in-game minimaps, sharpened 4x by `tools/upscale_minimaps.py` into `assets/minimap-hd` (the auto-update does new ones), with spawn points, portals, NPC markers, and "How to get here" (neighbouring maps zoomed in on the portal, circled).
  Maps with no walking way in explain how you get there (job tests, Kerning PQ).
- **Monsters / Items**: stats, Classic drop tables with rates and kill counts, sprites, approximate Free Market values.
- **Quests**: 325 quests as step-by-step guides, a tracker per character, and an "Only quests for my character" filter.
- **NPCs**: 187 NPCs, each location circled on the minimap.
- **Calculator**: Classic damage and accuracy formulas, a skill and skill-level picker, a "Fight a monster" verdict, and a hits-to-kill table.
- **Skills**: an SP planner for every 1st and 2nd job skill at every level. It saves to the character, and the calculator uses it.
- **Saved characters**: multiple characters in localStorage, each with its own calc setup, skill plan and quest progress.
  Share build creates a `?build=` link.
- **Market**: Club FM's public price summary, loaded live in the browser, with seller names, plus links to Cozy Market for live shops.
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

- `.github/workflows/daily-update.yml` runs every 6 hours. It pulls Club FM data, rebuilds `data/*.json` (`tools/build_data.py`),
  logs changes (`tools/update_log.py` → `data/log.json`), fetches skills (`tools/fetch_skills.py`)
  and Nexon Classic posts (`tools/fetch_patches.py`), then commits.
- A personal scheduled task, "NiaDB daily updates", runs at 7:40 AM Pacific. It reads NiaDB's changelog and news pages and sends a digest
  to the user's phone. It does not touch the site.

## To do / ideas

1. **World map layout check**: the art is not based on the in-game map (W key). A screenshot could be used to make the geography more accurate.
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

- Don't redraw minimaps with AI: markers use exact coordinates on the image, so the art has to keep the same layout. Any upscale must be an exact multiple of the original size.
- iPhone Safari wouldn't scroll a `position: fixed` full-screen sheet, so on phones detail pages render in the normal page flow (`body.sheet-open`).
- iOS zooms into inputs under 16px, so keep inputs at 16px on mobile.
- maplestory.io's MCW skill data keeps Poison Breath's and Arrow Bomb's real numbers in unnamed entries (ids 2101005 and 3101005). `skills.js` merges them.
