# MapleStory Classic DB

A fan-made, searchable database for **classic (pre–Big Bang) MapleStory**: monsters, items, maps and jobs.

It's a plain static website, so there's no build step and no server. Open `index.html` locally, or turn on GitHub Pages and it's live.

## Features

- Tabs for **Monsters, Items, Maps, Jobs**
- Instant search and level-range filter
- Sortable columns
- Detail panel with cross-links: a monster shows its drops and where it spawns; an item shows who drops it; a map lists its monsters

## Project layout

```
index.html        page shell
style.css         styling (light + dark mode)
app.js            loads the JSON, renders tables and details
data/
  monsters.json
  items.json
  maps.json
  jobs.json
```

## Adding data

Everything lives in `data/*.json`. Each entry has an `id` (lowercase, underscores), and other files refer to entries by that id.

```json
{
  "id": "orange_mushroom",
  "name": "Orange Mushroom",
  "level": 8,
  "hp": 80,
  "exp": 15,
  "drops": ["orange_mushroom_cap", "red_potion"],
  "maps": ["henesys_hunting_ground_1"],
  "verified": false
}
```

`verified: false` marks numbers that are from memory and still need checking against a reliable source. Flip it to `true` once confirmed. Unverified rows show a small marker in the table.

## Running locally

Browsers block `fetch()` from `file://`, so serve the folder:

```
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Publishing with GitHub Pages

Repo **Settings → Pages → Deploy from a branch → `main` / root**.

## Disclaimer

Unofficial fan project, not affiliated with or endorsed by Nexon. MapleStory is a trademark of Nexon. No game assets (sprites, music, logos) are included.
