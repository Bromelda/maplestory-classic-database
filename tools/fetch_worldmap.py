#!/usr/bin/env python3
"""Download the game's own world maps (maplestory.io, Classic World game files).

Writes data/worldmap.json (each world map's nodes: where they are and which maps they cover)
and assets/worldmap/<name>.webp (the map art, doubled in size so it stays sharp on big screens).
New world maps, like Orbis or El Nath once they open, are picked up automatically.

Usage: python3 tools/fetch_worldmap.py    (needs: pip install pillow numpy)
"""
import base64
import io
import json
import re
import sys
import urllib.request
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

from upscale_minimaps import scale2x

ROOT = Path(__file__).resolve().parent.parent
API = "https://maplestory.io/api/MCW/1/map/worldmap"
ART = ROOT / "assets" / "worldmap"
QUALITY = 88


def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "maplestory-classic-database-fan-site"})
    with urllib.request.urlopen(req, timeout=120) as res:
        return json.loads(res.read())


def region_of(spots, maps):
    """The world map's name: the region most of its maps are in."""
    regions = Counter(maps[g]["region"] for s in spots for g in s["mapNumbers"] if g in maps and maps[g]["region"] != "Hidden Street")
    return regions.most_common(1)[0][0] if regions else None


def main():
    data = json.loads((ROOT / "data" / "maps.json").read_text(encoding="utf-8"))
    maps = {m["gid"]: m for m in (data if isinstance(data, list) else data.values())}
    ART.mkdir(parents=True, exist_ok=True)
    out = []
    for name in get_json(API):
        if not re.fullmatch(r"WorldMap\d+", name):
            continue  # the API also lists search settings
        wm = get_json(f"{API}/{name}")
        base = wm["baseImage"][0]
        ox, oy = base["origin"]["x"], base["origin"]["y"]
        art = Image.open(io.BytesIO(base64.b64decode(base["image"]))).convert("RGBA")
        dst = ART / f"{name}.webp"
        if not dst.exists():
            big = Image.fromarray(scale2x(np.array(art))).filter(ImageFilter.GaussianBlur(0.6))
            big.save(dst, quality=QUALITY, method=6)
        out.append({
            "id": name,
            "name": region_of(wm["maps"], maps) or name,
            "image": f"assets/worldmap/{name}.webp",
            "width": art.width,
            "height": art.height,
            "spots": [{"x": s["spot"]["x"] + ox, "y": s["spot"]["y"] + oy, "type": s["type"], "maps": s["mapNumbers"]} for s in wm["maps"]],
        })
        print(f"{name}: {out[-1]['name']}, {len(out[-1]['spots'])} nodes, {dst.stat().st_size // 1024} KB")
    if not out:
        sys.exit("No world maps found, so the existing file was left alone")
    (ROOT / "data" / "worldmap.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main()
