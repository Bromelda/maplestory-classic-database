#!/usr/bin/env python3
"""Download full map art from the Classic World game files (maplestory.io) into assets/map-art/<id>.webp

Each image is cropped to the map's own bounds, so markers line up the same way they do on the minimap.
The render comes with its own unknown origin, so it's found by matching the render against the minimap,
then fine-tuned with the platform lines from the game data. A map that doesn't match well is skipped,
and the site keeps showing its sharpened minimap instead. Skipped maps are noted in assets/map-art/skipped.txt
so they aren't downloaded again on every run.

Only maps without an image are processed. Pass map ids to do just those, even if skipped before.

Usage: python3 tools/fetch_map_art.py [map_id ...]    (needs: pip install pillow numpy)
"""
import io
import json
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
API = "https://maplestory.io/api/MCW/1/map/{id}"
OUT = ROOT / "assets" / "map-art"
SKIP_FILE = OUT / "skipped.txt"
MIN_SIDE, MAX_SIDE = 1400, 2000   # px on the longest side: 60% of full size, within these limits
QUALITY = 80
MIN_MATCH = 0.6   # how closely the render has to match the minimap (1 = perfectly)
PAUSE = 0.5       # seconds between maps, to go easy on the API


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "maplestory-classic-database-fan-site"})
    with urllib.request.urlopen(req, timeout=120) as res:
        return res.read()


def luma(im):
    """Brightness on a black background, as floats."""
    bg = Image.new("RGBA", im.size, (0, 0, 0, 255))
    bg.alpha_composite(im.convert("RGBA"))
    return np.asarray(bg.convert("L"), dtype=np.float32)


def best_shift(a, b):
    """Where b sits inside a: (dx, dy) with the best normalized match, and that match."""
    h, w = a.shape[0] + b.shape[0], a.shape[1] + b.shape[1]
    na, nb = (a - a.mean()) / (a.std() + 1e-6), (b - b.mean()) / (b.std() + 1e-6)
    corr = np.fft.irfft2(np.fft.rfft2(na, (h, w)) * np.conj(np.fft.rfft2(nb, (h, w))), (h, w))
    y, x = np.unravel_index(np.argmax(corr), corr.shape)
    dy, dx = int(y) - h if y >= a.shape[0] else int(y), int(x) - w if x >= a.shape[1] else int(x)
    return dx, dy


def overlap_match(a, b, dx, dy):
    """How well b matches a once placed at (dx, dy), over the part they share."""
    x0, y0 = max(dx, 0), max(dy, 0)
    x1, y1 = min(dx + b.shape[1], a.shape[1]), min(dy + b.shape[0], a.shape[0])
    if x1 - x0 < 8 or y1 - y0 < 8:
        return 0.0
    pa, pb = a[y0:y1, x0:x1], b[y0 - dy:y1 - dy, x0 - dx:x1 - dx]
    if pa.std() < 1e-3 or pb.std() < 1e-3:
        return 0.0
    return float(np.corrcoef(pa.ravel(), pb.ravel())[0, 1])


def refine_with_footholds(render, footholds, rx, ry, reach=10):
    """Nudge the origin so the flat platform lines sit on the top edge of the ground in the art."""
    alpha = np.asarray(render.convert("RGBA").getchannel("A"), dtype=np.float32) > 128
    pts = []
    for f in footholds.values():
        if f["y1"] == f["y2"] and f["x2"] != f["x1"]:
            lo, hi = sorted((f["x1"], f["x2"]))
            pts += [(x, f["y1"]) for x in range(lo, hi, 6)]
    if len(pts) < 10 or alpha.all():
        return rx, ry
    pts = np.array(pts)
    h, w = alpha.shape
    best, best_d = -1.0, (0, 0)
    for dy in range(-reach, reach + 1):
        for dx in range(-reach, reach + 1):
            x, y = pts[:, 0] + rx + dx, pts[:, 1] + ry + dy
            below, above = y + 8, y - 14
            ok = (x >= 0) & (x < w) & (below >= 0) & (below < h) & (above >= 0) & (above < h)
            if ok.sum() < len(pts) * 0.5:
                continue
            score = alpha[below[ok], x[ok]].mean() - 0.5 * alpha[above[ok], x[ok]].mean()
            if score > best:
                best, best_d = score, (dx, dy)
    return rx + best_d[0], ry + best_d[1]


def build(m):
    """The map's art on a canvas of exactly its bounds, plus how well it matched."""
    ox, oy = m["origin"]
    w, h = m["size"]
    info = json.loads(get(API.format(id=m["gid"])))
    render = Image.open(io.BytesIO(get(API.format(id=m["gid"]) + "/render"))).convert("RGBA")
    mini = Image.open(ROOT / "assets" / "minimap" / f"{m['gid']}.png").convert("RGBA")

    # match at 1/4 size: the minimap is blown up to the same scale as the shrunken render
    small = render.resize((max(render.width // 4, 1), max(render.height // 4, 1)), Image.BOX)
    big_mini = mini.resize((max(w // 4, 1), max(h // 4, 1)), Image.BILINEAR)
    a, b = luma(small), luma(big_mini)
    dx, dy = best_shift(a, b)
    match = overlap_match(a, b, dx, dy)
    # canvas (0, 0) sits at (dx * 4, dy * 4) in the render, and game x + ox = canvas x
    rx, ry = dx * 4 + ox, dy * 4 + oy
    rx, ry = refine_with_footholds(render, info.get("footholds") or {}, rx, ry)

    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    canvas.paste(render, (ox - rx, oy - ry))
    scale = min(1, max(MIN_SIDE, min(MAX_SIDE, max(w, h) * 0.6)) / max(w, h))
    if scale < 1:
        canvas = canvas.resize((max(round(w * scale), 1), max(round(h * scale), 1)), Image.LANCZOS)
    return canvas, match


def main():
    only = set(sys.argv[1:])
    data = json.loads((ROOT / "data" / "maps.json").read_text(encoding="utf-8"))
    maps = [m for m in (data if isinstance(data, list) else data.values()) if m.get("minimap")]
    OUT.mkdir(parents=True, exist_ok=True)
    made, skipped, failed = 0, [], []
    skip = set(SKIP_FILE.read_text().split()) if SKIP_FILE.exists() else set()
    for m in maps:
        dst = OUT / f"{m['gid']}.webp"
        if only and m["id"] not in only and str(m["gid"]) not in only:
            continue
        if not only and (dst.exists() or str(m["gid"]) in skip):
            continue
        try:
            art, match = build(m)
            if match < MIN_MATCH:
                skipped.append(f"{m['id']} ({match:.2f})")
                skip.add(str(m["gid"]))
                continue
            art.save(dst, quality=QUALITY, method=4)
            skip.discard(str(m["gid"]))
            made += 1
            print(f"{m['id']}: match {match:.2f}, {art.size[0]}x{art.size[1]}, {dst.stat().st_size // 1024} KB", flush=True)
        except Exception as err:  # one bad map shouldn't stop the rest
            failed.append(f"{m['id']} ({err})")
        time.sleep(PAUSE)
    if skip:
        SKIP_FILE.write_text("\n".join(sorted(skip)) + "\n")
    else:
        SKIP_FILE.unlink(missing_ok=True)
    print(f"{made} maps saved, {len(list(OUT.glob('*.webp')))} in total")
    if skipped:
        print("poor match, skipped:", ", ".join(skipped))
    if failed:
        print("failed:", ", ".join(failed))
        sys.exit(1)  # the images that worked are kept, and the failed ones are tried again next run


if __name__ == "__main__":
    main()
