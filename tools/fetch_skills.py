#!/usr/bin/env python3
"""Download Classic World skill data (every level) from the maplestory.io game-data API
into data/skills.json. The values come straight from the Classic World game files.

    python3 tools/fetch_skills.py data/skills.json

Names, max levels, weapon requirements and the per-level numbers are kept (no tooltip text),
and each skill's icon is saved to assets/skill/<id>.png. If the API can't be reached, the
existing files are left as they are.
"""
import base64
import binascii
import json
import sys
import time
import urllib.request
from pathlib import Path

API = "https://maplestory.io/api/MCW/1/job/{job}/skillbook"
ICONS = Path(__file__).resolve().parent.parent / "assets" / "skill"
# Beginner, 1st jobs and 2nd jobs available in Classic World.
JOBS = {
    0: ("Beginner", "Beginner"),
    100: ("Warrior", "Warrior"), 110: ("Warrior", "Fighter"), 120: ("Warrior", "Page"), 130: ("Warrior", "Spearman"),
    200: ("Magician", "Magician"), 210: ("Magician", "Wizard (Fire/Poison)"), 220: ("Magician", "Wizard (Ice/Lightning)"), 230: ("Magician", "Cleric"),
    300: ("Bowman", "Bowman"), 310: ("Bowman", "Hunter"), 320: ("Bowman", "Crossbowman"),
    400: ("Thief", "Thief"), 410: ("Thief", "Assassin"), 420: ("Thief", "Bandit"),
}


def number(v):
    try:
        f = float(v)
        return int(f) if f.is_integer() else f
    except (TypeError, ValueError):
        return v


def fetch(job):
    req = urllib.request.Request(API.format(job=job), headers={"User-Agent": "maplestory-classic-db-updater (github.com/Bromelda/maplestory-classic-database)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def save_icon(skill_id, data):
    """Saves one skill's icon if it's really a PNG, and only rewrites the file if it changed."""
    try:
        png = base64.b64decode(data or "", validate=True)
    except (binascii.Error, ValueError):
        return
    if not png.startswith(b"\x89PNG\r\n\x1a\n"):
        return
    path = ICONS / f"{int(skill_id)}.png"
    if not path.exists() or path.read_bytes() != png:
        path.write_bytes(png)


def main(out_path):
    out = Path(out_path)
    ICONS.mkdir(parents=True, exist_ok=True)
    try:
        had = {j["job"]: j for j in json.loads(out.read_text(encoding="utf-8"))["jobs"]}
    except (OSError, ValueError, KeyError):
        had = {}
    jobs = []
    for job, (cls, name) in JOBS.items():
        try:
            book = fetch(job)
        except Exception as e:  # keep going; a job that fails keeps what it already had
            print(f"job {job}: {e}")
            if job in had:
                jobs.append(had[job])
            continue
        skills = []
        for s in book.get("skills") or []:
            levels = []
            for lp in s.get("levelProperties") or []:
                levels.append({k: number(v) for k, v in lp.items() if k != "hs" and not isinstance(v, (dict, list))})
            desc = s.get("description") or {}
            save_icon(s.get("id"), s.get("icon"))
            skills.append({
                "id": s.get("id"),
                "name": desc.get("name") or (desc.get("names") or {}).get("en"),
                "max": s.get("masterLevel") or len(levels),
                "weapons": s.get("weapons") or [],
                "levels": levels,
            })
        jobs.append({"job": job, "class": cls, "name": name, "skills": skills})
        time.sleep(1)  # be gentle with the API
    if not jobs or sum(len(j["skills"]) for j in jobs) == 0:
        print("No skill data fetched; leaving the existing file unchanged.")
        return
    out.write_text(json.dumps({"source": "Classic World game files via maplestory.io (MCW v1)", "jobs": jobs}, ensure_ascii=False, separators=(",", ":")))
    print(f"{len(jobs)} jobs, {sum(len(j['skills']) for j in jobs)} skills")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "data/skills.json")
