# Maple Classic Tracker with Drop Scanner

A desktop tracker for MapleStory Classic World: EXP per hour, mesos, loot and potions, plus a scanner that works out
**which monster each drop came from**.

Status: **not tested on the real game yet.** See [What's been checked](#whats-been-checked).

## Your run

The Log page keeps a running account from when the tracker opens until it closes. Each time it opens, this account and
the repot numbers on the tracker card start fresh, even after a crash. Settings, the log of past sessions, clips and
drop results are kept. While it's open, the account is saved in `daybook.json` in the tracker's data folder.

- **Mesos:** the first time you open your inventory each run sets your starting mesos. Each time after, it shows what
  you've made. What you spend at shops comes off that, and is shown as spent. What you get from selling is shown as
  sold, as one total, since the game doesn't say what was sold. A quest reward or a trade counts as sold too. Selling
  and buying in one trip are told apart by what the potions you bought cost at shop prices.
- **Potions:** potions and food you pick up, from the message lines, and what you use, from jumps in your HP and MP. A jump
  of exactly a potion's amount counts as that potion. MP potions can heal more than listed, so a jump up to 30% over
  is marked with `?` as probably that one. Any other jump, like a Heal from a party member, is listed by its size.
- **Potion counts:** when an item's count is on screen, the count is the truth: had, plus picked up, less what's left, is
  what you used, and a rise beyond your pickups is bought. While the count's in view, jumps don't add to that item. While
  it isn't, they keep the tally going, and the next count corrects them. Counts come from the quick bar (the Short Cut
  button) while it's open, and the controller's popup. Items on the bar are recognised from real pictures of it, made
  by `tools/make_quick_digits.py`. It's only been checked at 2560x1440.

## What the scanner does

1. Follows the monsters on screen by their sprites, using only the ones that live on the current map, in their hit and
   death poses too.
2. Sees one vanish, and pairs it with your "You received EXP" line. No EXP line means someone else's kill.
3. Looks around where it died for the pictures of coins and of what that monster is known to drop.
4. Sees that thing leave the ground and pairs it with your pickup line, which gives the item's exact name. They have to
   agree: a coin can't become an item, or one item another.

A drop the database doesn't list has no picture to look for, so it isn't seen landing. On a map with one kind of monster it
still goes on the drop list from the pickup line, but not in the rate.

## What counts

There are two records, kept apart.

| | Drop list ("this monster drops this") | Drop rate ("how often") |
| --- | --- | --- |
| My clean kill | Yes | Yes |
| Two of the same monster dying together | Yes | Yes |
| Another player's kill of the same monster, nearby | Yes | No |
| A different monster dying on top of it | No | No |
| In a party | Yes | No |
| Left something on the ground | Yes, for anything picked up | That kill is left out |
| Map with one kind of monster, drop not seen landing | Yes | No |

Whether a kill counts is decided from what was around when it died, never from what it dropped. Anything unclear is left
out and counted, so you get a line like "412 kills counted, 58 skipped", with the reasons.

## Run it

Needs Python 3.10 or newer, and [Tesseract](https://github.com/UB-Mannheim/tesseract/wiki). The scanner can't work without
Tesseract, because it reads the map's name to know which monsters to look for. Keep the minimap open too.

```bash
py -3 -m pip install -r requirements.txt
```

```bash
py -3 maple_exp.py
```

Press Start and play. Settings has a Drop scanner section with a switch and a button that opens the drops folder.

## What it leaves behind

Everything stays in `%APPDATA%\MapleEXP\drops`:

- `report.html`: everything added up
- `new_for_database.json`: drops the database doesn't list yet, shaped like `tools/player_drops.json`
- `pictures/`: what each drop looked like on the ground, for checking by eye
- `log.jsonl` and `session-*.json`: the raw results
- `clips/`: short videos around kills and pickups, for finding out why it got something wrong. They show the whole game
  window, chat included. They use up to 5 GB, the oldest are deleted first, and Settings has a switch to turn them off.

Check new drops against their pictures before copying them to the database.

## Getting rates onto the website

Numbers only go up after they've proved accurate.

1. **Prove it first.** Hunt monsters the database already has counted rates for, such as Slime, Green Mushroom or Pig, until
   each has 100+ kills counted. The tool compares your rates with those.
2. **See where things stand.** This changes nothing. It shows what agrees, what's ready, and how many more kills each monster needs.

```bash
py -3 tools/publish_drops.py
```

3. **Publish.** It refuses if the rates disagree with the database or too many pickups have no monster to go to.

```bash
py -3 tools/publish_drops.py --write
```

4. **Commit and push** `tools/scanned_drops.json`. The site's data update then rebuilds with the new rates.

| Rule | Needed |
| --- | --- |
| Rates agreeing with the database | 80%, comparing at least 5 |
| Pickups with no monster to go to | 20% at most |
| Kills of a monster before its rates go up | 200 |
| Times an item dropped before it gets a percent | 3 (rarer items stay listed with no percent) |
| Sightings of a drop new to the database | 2, and check its picture first |

On the site, a rate shows its likely range, like "10.0% 7.5%–13.1%". For each drop, the rate with more kills behind it is
the one shown. After a fix that changes what gets counted, raise `SCANNER_VERSION` in `scandata.py`, so sessions from before
the fix stop counting.

## Test it on a recording

This is the way to find out how well it works, and to tune it, without risking anything in a live session.

The tracker saves its own clips, with the message lines it read beside them. This runs the scanner over all of them:

```bash
py -3 tools/replay.py
```

This runs one and makes a video with boxes drawn on what it saw:

```bash
py -3 tools/replay.py "%APPDATA%\MapleEXP\drops\clips\clip-name.avi" --out seen.mp4
```

For a video from something else, name the map. `--gh` is the height of the game's digits, about 10 at 1080p:

```bash
py -3 tools/replay.py other.mp4 --map "The Land of Wild Boar II" --gh 10 --out seen.mp4
```

## What's been checked

| Check | Result |
| --- | --- |
| The rules, one situation at a time (`tests/test_lootwatch.py`) | Passing |
| The scanner on made-up footage: real map art and sprites, stand-in player, scrolling view (`tests/test_fieldwatch.py`) | Passing |
| Saving, map names, the report (`tests/test_dropscan.py`) | Passing |
| Saving clips and replaying them, on made-up footage (`tests/test_clips.py`) | Passing |
| Finding a real Wild Boar in one real 1920x1080 screenshot, among all 83 monsters | Correct: 0.74 against 0.68 for the next best |
| The tracker window with the scanner connected | **Not run yet** |
| A real kill, drop and pickup in the real game | **Not done yet** |

The first time it sees a given window size, it takes a few seconds to learn how big sprites show, and it can miss the
drops of kills made around then. It remembers the size afterwards.

Tried on real clips of a busy party map: it read HP and MP in all 832 frames, it found coins and items by their pictures
with few false fits, and it no longer loses its place. But party members' pets took most drops as they landed, so it saw few
settle. That's why these clips don't show how well it counts, which needs a solo session.

## Safety

It only takes pictures of the game window. It doesn't read the game's memory or files, send it keys or clicks, or go
online; network connections are blocked while it runs. To find the game's window it asks Windows which program owns a
window, using a query-only handle. Even so, I couldn't find a clear rule from Nexon on screen-reading tools, so using it
is your call.

`tools/check_screen_only.py .` scans the code for anything that could touch the game client. Expect it to flag that one
query-only `OpenProcess` call in `platforms/windows.py`, and treat anything else it flags as a problem.

Credits and licenses are in [NOTICE.md](NOTICE.md).
