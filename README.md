# MapleStory Classic DB

A fan-made database for **MapleStory Classic World**: the 2026 release, not the 2006-era original. Many numbers changed in Classic (for example, Snail has 45 HP instead of 8), so this site only uses data confirmed for Classic.

It's a plain static website with no build step for the site itself. Open it locally or host it on GitHub Pages.

## Features

- **Interactive world map**: Maple Island and Victoria Island, with every area colored by its typical training level. Click an area to list all its maps and their monsters.
- **Map pages** show:
  - the exact spawn count of each monster (for example 10 Shroom, 6 Red Snail, 5 Slime…)
  - the real in-game minimap, with spawn points and portals on top, so you can click a portal to jump there
  - **How to get here**: the neighbouring maps' minimaps, zoomed in, with the portal that leads here circled. This is especially handy for hidden streets.
  - connected maps, **hidden portals**, one-way entrances, and how you get in when no portal leads there (job tests, party quests)
  - NPCs, plus boss respawn timers
- **Monster pages**: the animated in-game sprite, full stats, the Classic drop table with drop rates, and every map the monster spawns on. Hover a monster anywhere to preview its drops.
- **Item pages**: stats, requirements, and every monster that drops it, sorted by rate.
- **Quests**: all 325 current quests as step-by-step guides. Each one covers who to talk to (circled on the minimap), what to kill or collect and who drops it, where to turn it in, rewards, and what it unlocks next. Tick off finished quests to track your progress; it's saved in your browser. Ended events and Forgotten Hollow quests are left out.
- **NPCs**: all 187 NPCs with every location circled on the in-game minimap, plus the quests they give and accept. NPCs also show as ◆ markers on every map.
- **Market**: typical Free Market prices for about 1,500 items, with a 7-day trend, prices by stat roll (for example clean versus +8 ATT Work Gloves), and the character names of shops selling near that price. Each item links to [Cozy Market](https://cozy.markets/market) for live shops and channels. Monster drop tables show roughly what each drop is worth.
- **Skills**: a skill-point planner for every Classic job (1st and 2nd), with every skill's numbers at every level straight from the game files. Spend points with + / − and see what each level does and what the next one adds. SP is counted at 3 per level from level 11. The plan saves to your character, and the calculator uses it: your skill level, mastery, Rage, Precise Strikes and Focus are all picked up automatically. Skills changed in the Oct 29 patch are marked.
- **Saved characters**: keep several characters (main, alts) in your browser. Each one remembers its stats, gear and skill settings for the calculator, and its own quest progress. Tap the 👤 chip at the top to switch. The Quests tab can show only the quests your character can do right now.
- **Share builds**: the calculator's **Share build** button makes a link with your setup. Whoever opens it sees your build and can save it as their own character.
- **Patches**: Classic World patch notes, maintenance, events and Cash Shop posts from Nexon, linked to the full post.
- **Log**: a daily list of anything new, such as new drops players find, new monsters, stat changes, and new or ended quests and events.
- **Calculator**: pick your class, weapon and skill (attack skills preset at max level, with values from NiaDB's skill pages) and enter your stats. You get:
  - your damage range, average and max crit
  - your accuracy
  - a **"Fight a monster"** matchup: damage, hits to kill, hit chance, the accuracy you need for 100%, and a verdict (One-shot / Easy / Good / Slow / Too tough / Hard to hit)
  - a table of every monster near your level

  It uses Classic World's own formulas, including the level-gap and defense penalties, and includes Rage and Precise Strikes. Your inputs are remembered in your browser.
- **Jobs**: the Classic job tree (no Pirates, 2nd job at 30, Magician 1st job at level 10).
- Searchable, sortable tables for monsters, items, maps and jobs. Links are shareable (for example `#map/henesys_hunting_ground_i`).

## Data rules

1. **Classic only.** Nothing from old GMS, MSEA or v83 tables.
2. **Monster stats** (level, HP, EXP and so on) come from the Classic World game files, cross-checked against a second Classic source. When a patch changes a monster, the game files win and the old value is noted. For example, the v1.1.0 patch (Oct 29, 2026) lowered the HP of Clang, Copper Drake, Drake and Tortie, and some sites still show the old HP.
3. **Drops** are player-counted from Classic World kills (MapleClassic Wiki, game version 0.9.0). A rate is shown with the number of kills it's based on. Drops reported by Classic players but not yet counted are marked "reported".
4. **Level ranges:** when the game data has none for a map, the range is worked out from the monsters on it and labeled that way.
5. **Not included yet:** Forgotten Hollow (Glowshroom, Raffle, Golden Stirge, Aqumander, Echopus, Rafflesia, Duskmander, Myewood, Rotten Mushroom, Sporewood, Rotten Mushmom). It isn't open in Classic yet and its stats have only one source. Orbis, El Nath and 3rd job aren't in Classic yet either.

## Data sources

| What | Source |
|---|---|
| Monster stats, map layouts, spawn points | Classic World game files, via [Club FM](https://maplefm.gg) / maplestory.io |
| Stat cross-check | [NiaDB](https://meowdb.com/msclassic), [MapleStoryClassic.org](https://maplestoryclassic.org/monsters/) |
| Maps, portals, spawns, drops | [MapleClassic Wiki](https://mapleclassic.wiki) (CC BY-NC-SA 4.0) |
| Minimaps and monster sprites | Classic World game files, via [Club FM](https://maplefm.gg) |
| Quests and NPC positions | Classic World game data (maplestory.io) + MapleClassic Wiki, via [Club FM](https://maplefm.gg) |
| Skills (every level) | Classic World game files via maplestory.io (launch v1.0.0), with Oct 29 patch changes applied or flagged |
| Free Market prices | [Club FM](https://maplefm.gg) public price summary, loaded live in the browser and refreshed daily by Club FM |
| Job levels and instructors | Game quest data plus [Henesys.gg](https://henesys.gg/guides/beginner), [Metaroad](https://metaroad.gg/maplestory-classic/meta/beginners-guide-maplestory-classic-world), [MapleStory-Classic.com](https://maplestory-classic.com/guides/first-job-advancement-guide) |

## Daily auto-update

`.github/workflows/daily-update.yml` runs on GitHub every 6 hours. It:

1. pulls the latest Classic data (game files + player-counted drops) and rebuilds `data/*.json`
2. compares it with yesterday's data and adds anything new to `data/log.json` (the Log tab)
3. fetches Nexon's Classic World posts into `data/patches.json` (the Patches tab)
4. commits the changes, so the site updates itself

You can also run it any time from the repo's **Actions** tab → *Daily data update* → **Run workflow**.

## Updating the data by hand

`data/monsters.json`, `items.json` and `maps.json` are generated by `tools/build_data.py`. To refresh them with the latest Classic data:

```
git clone --depth 1 --filter=blob:none --sparse --branch live https://github.com/maplefm/maplefm.github.io fm
cd fm && git sparse-checkout set --no-cone '/data/*' '!/data/sprite/' && cd ..
python3 tools/build_data.py fm/data
```

Stat disagreements between sources are listed at the top of the script, so they stay visible and reviewable. `data/jobs.json` is edited by hand.

## Running locally

```
python3 -m http.server 8000
```

Then open http://localhost:8000. Opening `index.html` directly won't work, because browsers block loading the data files that way.

## Publishing with GitHub Pages

GitHub Pages needs a public repo, or a paid plan for a private one. Turn it on under **Settings → Pages → Deploy from a branch → `main` / root**.

## Roadmap

- The real in-game Victoria Island world map in place of the schematic
- Forgotten Hollow, Orbis and El Nath once they open in Classic

## License and disclaimer

The map, spawn and drop data is adapted from the MapleClassic Wiki under **CC BY-NC-SA 4.0**, so this project's data is shared under the same license, for non-commercial use with attribution.

Game images (minimaps and monster sprites) are © NEXON, from MapleStory Classic World. They're used non-commercially under [Nexon's guide for fan content](https://m.nexon.com/terms/1037), so this site must stay free, with no paid access or selling.

This is an unofficial fan project, not affiliated with or endorsed by Nexon. MapleStory is a trademark of Nexon.
