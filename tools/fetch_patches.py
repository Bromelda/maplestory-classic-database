#!/usr/bin/env python3
"""Pull MapleStory Classic World posts (patch notes, maintenance, events, cash shop)
from Nexon's public news feed into data/patches.json.

    python3 tools/fetch_patches.py data/patches.json

Only posts Nexon marks as Classic World (isMSCW) are kept. We store the title, date,
category and Nexon's short summary, and link to the full post on nexon.com.
"""
import json
import re
import sys
import urllib.request
from pathlib import Path

FEED = "https://g.nexonstatic.com/maplestory/cms/v1/news"
CLASSIC_WORDS = re.compile(r"classic world|mscw", re.I)


def slug(name):
    name = re.sub(r"^\[[^\]]*\]\s*", "", name)          # drop "[Completed]" etc.
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def main(out_path):
    req = urllib.request.Request(FEED, headers={"User-Agent": "maplestory-classic-db-updater"})
    with urllib.request.urlopen(req, timeout=30) as r:
        feed = json.load(r)
    out = Path(out_path)
    existing = {p["id"]: p for p in json.loads(out.read_text())} if out.exists() else {}
    added = 0
    for post in feed:
        if not (post.get("isMSCW") or CLASSIC_WORDS.search(post.get("name", ""))):
            continue
        pid = post["id"]
        cat = post.get("category") or "general"
        if pid not in existing:
            added += 1
        existing[pid] = {
            "id": pid,
            "name": post.get("name", ""),
            "category": cat,
            "date": (post.get("liveDate") or "")[:10],
            "summary": post.get("summary") or "",
            "url": f"https://www.nexon.com/maplestory/news/{cat}/{pid}/{slug(post.get('name', ''))}",
        }
    posts = sorted(existing.values(), key=lambda p: (p["date"], str(p["id"])), reverse=True)
    out.write_text(json.dumps(posts, ensure_ascii=False, indent=1))
    print(f"{added} new Classic posts, {len(posts)} total")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "data/patches.json")
