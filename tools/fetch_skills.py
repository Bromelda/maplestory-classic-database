#!/usr/bin/env python3
"""Download Classic World skill data (every level) from the maplestory.io game-data API
into data/skills.json. The values come straight from the Classic World game files.

    python3 tools/fetch_skills.py data/skills.json

Only names, max levels, weapon requirements and the per-level numbers are kept
(no icons or tooltip text). If the API can't be reached, the existing file is left as is.
"""
import json
import sys
import time
import urllib.request
from pathlib import Path

API = "https://maplestory.io/api/MCW/1/job/{job}/skillbook"
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


def main(out_path):
    out = Path(out_path)
    jobs = []
    for job, (cls, name) in JOBS.items():
        try:
            book = fetch(job)
        except Exception as e:  # keep going; a missing job just isn't updated
            print(f"job {job}: {e}")
            continue
        skills = []
        for s in book.get("skills") or []:
            levels = []
            for lp in s.get("levelProperties") or []:
                levels.append({k: number(v) for k, v in lp.items() if k != "hs" and not isinstance(v, (dict, list))})
            desc = s.get("description") or {}
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
