#!/usr/bin/env python3
"""Generate a small data-quality audit for the Classic-only database.

This intentionally reports unknown values instead of filling them from historical
GMS/MSEA/v83 tables. It is safe to run after every data rebuild.
"""
import datetime
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

monsters = json.loads((DATA / "monsters.json").read_text(encoding="utf-8"))
items = json.loads((DATA / "items.json").read_text(encoding="utf-8"))

live_nonvariant = [
    m for m in monsters
    if not m.get("variant") and (m.get("level") or 0) < 200
]
missing_meso = [
    {"id": m["id"], "name": m["name"], "level": m.get("level")}
    for m in live_nonvariant
    if not m.get("meso")
    or m["meso"].get("min") is None
    or m["meso"].get("max") is None
]

equips = [i for i in items if i.get("type") == "Equip"]
equips_with_clean_rolls = [i for i in equips if i.get("clean_rolls")]

audit = {
    "generated": datetime.date.today().isoformat(),
    "summary": {
        "monsters_total": len(monsters),
        "live_nonvariant_monsters": len(live_nonvariant),
        "live_nonvariant_monsters_missing_meso_range": len(missing_meso),
        "items_total": len(items),
        "equipment_items": len(equips),
        "equipment_items_with_clean_roll_ranges": len(equips_with_clean_rolls),
    },
    "missing_meso_ranges": missing_meso,
    "notes": [
        "Unknown values stay unknown; do not backfill from old GMS/MSEA/v83 tables.",
        "Unreleased Forgotten Hollow and special/test monster variants are excluded from the live meso-gap count.",
        "NiaDB remains manual cross-check only until explicit permission is granted for automated reuse.",
    ],
}

(DATA / "audit_gaps.json").write_text(
    json.dumps(audit, indent=2, ensure_ascii=False) + "\n",
    encoding="utf-8",
)
print(json.dumps(audit["summary"], indent=2))
