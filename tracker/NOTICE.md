# Where this came from

This tracker is built on other people's open source work. Their licenses allow that as long as the notices stay.

## The base

The EXP, mesos and pickup reading, the window and the overlay card are from **Maple Classic Exp Overlay** by beanguri,
through the local-only edition by Javipen. The MIT license text is in [LICENSE](LICENSE).

- https://github.com/beanguri/Maple-Classic-Exp-Overlay
- https://github.com/Javipen/maple-exp-overlay

## Borrowed code

`tools/check_screen_only.py` is from **MapleLens** by or-keren, under the MIT license:

> Copyright (c) 2026 or-keren. Permission is hereby granted, free of charge, to any person obtaining a copy of this
> software and associated documentation files, to deal in the Software without restriction, subject to including this
> notice. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.

## Ideas, no code copied

The "best match must beat the runner-up by a margin, or it's nobody" check in `fieldwatch.py` follows the same idea as
the potion reader in **MS-overlay** by gincreations (MIT, a fork of beanguri's project).

## Reviewed and left out

| Project | Why |
| --- | --- |
| jcsoutherland/maple-exp-tracker, lucaslcn/maple-classic-exp-tracker | No license, so nothing may be reused |
| xmeset/MapleHUD | All rights reserved |
| Looty/maple-exp-overlay | MIT, but written in Rust, and its update check replaces its own program |
| CabbageCanFly/msxp | MIT, but it reads Twitch streams, and its sprites aren't covered by that license |

None of them can see monsters or ground loot, so `fieldwatch.py`, `lootwatch.py`, `dropscan.py`, `scandata.py` and
their tests are new work for this project.

## Data

- `assets/scan_data.json` and `assets/mob/` are made from the fan database in this repository.
- `assets/items.txt` and `assets/maps.txt` came with the base, which built them from meowdb.com's lists of names.
- Monster sprites and item art belong to Nexon. MapleStory is Nexon's trademark, and this project isn't connected to Nexon.
