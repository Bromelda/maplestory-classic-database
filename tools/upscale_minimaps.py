#!/usr/bin/env python3
"""Make sharper copies of the minimaps: assets/minimap/<id>.png -> assets/minimap-hd/<id>.webp

Each copy is exactly 4x the original, so the portal, spawn and NPC markers still line up.
Scale2x twice keeps the edges hard, then a light blur and sharpen removes the stair-steps.
No AI on purpose: it would move the platforms and the markers would land in the wrong place.

Only maps without a copy are processed. Delete the output folder to redo them all.

Usage: python3 tools/upscale_minimaps.py    (needs: pip install pillow numpy)
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "minimap"
OUT = ROOT / "assets" / "minimap-hd"
QUALITY = 88


def scale2x(a):
    h, w = a.shape[:2]
    p = np.pad(a, ((1, 1), (1, 1), (0, 0)), mode="edge")
    up, left, mid, right, down = p[:-2, 1:-1], p[1:-1, :-2], p[1:-1, 1:-1], p[1:-1, 2:], p[2:, 1:-1]
    same = lambda x, y: (x == y).all(axis=2)
    flat = same(up, down) | same(left, right)
    pick = lambda cond, other: np.where((cond & ~flat)[..., None], other, mid)
    r = np.zeros((h * 2, w * 2, a.shape[2]), a.dtype)
    r[0::2, 0::2] = pick(same(left, up), left)
    r[0::2, 1::2] = pick(same(up, right), right)
    r[1::2, 0::2] = pick(same(left, down), left)
    r[1::2, 1::2] = pick(same(down, right), right)
    return r


def upscale(im):
    big = Image.fromarray(scale2x(scale2x(np.array(im.convert("RGBA")))))
    return big.filter(ImageFilter.GaussianBlur(0.8)).filter(ImageFilter.UnsharpMask(2, 120, 2))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    made = 0
    for src in sorted(SRC.glob("*.png")):
        dst = OUT / f"{src.stem}.webp"
        if dst.exists():
            continue
        upscale(Image.open(src)).save(dst, quality=QUALITY, method=6)
        made += 1
    print(f"{made} new minimaps upscaled, {len(list(OUT.glob('*.webp')))} in total")


if __name__ == "__main__":
    main()
