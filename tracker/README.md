# Maple Classic Tracker with Drop Scanner

A desktop tracker for MapleStory Classic World: EXP per hour, mesos, loot and potions, plus a scanner that works out
**which monster each drop came from**.

Status: **not tested on the real game yet.** See [What's been checked](#whats-been-checked).

## Your run

The **Items and reading** button (or Shift+F7) opens a window with two tabs. **Items** lists everything you've picked up this
run, the latest first, with how many and which inventory tab, potions included, and can show just Equip, Use, Etc, Set-up or Other. **Reading** has the rest of this section,
how much it's reading, and what's been learned so far. Reset clears the list, and so does closing the tracker.

The Reading tab keeps a running account from when the tracker opens until it closes. Each time it opens, this account and
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

## Chat

The **Chat** button (or Shift+F8) opens a window that stays on top of the game, with what the chat box says, one tab for each kind:

- **Buddy:** buddy chat, the bright orange lines with "()" after the name ("Remoneide() : LOL"), and whispers, if the game
  shows them in green
- **Party:** the pink lines with no block behind them, and the party's news like "'jine' has joined the party."
- **General:** the white lines from people on your map and channel, and the game's yellow notices ("[Notice] ...", both lines
  of a long one)
- **Speakers:** the lines on yellow, pink and light blue blocks when the chat box is open, and the dark ones on the grey bar
  when it's closed. Each shows its channel ("CH01", from the little badge after the name) on its block's colour, and the
  name in that colour too. A digit that couldn't be made out shows as "?".
- **Other:** someone opening something special from a box (light letters on a red block, marked "box"), and any other
  colour, like light blue letters (maybe group chat)

Each line has the time it was first seen, and the same line is never added twice. A tab with new lines says how many. A new
buddy message rings a bell and lights the Buddy tab up; the switch at the bottom turns that off. Move it and size it as you
like: it opens there next time. The text starts big; A- and A+ make it smaller or bigger.

The reading isn't perfect, so a name can come out a few ways ("xeyna", "meyna"). Every way a name's read is kept together, and
it's shown the way most readings say, on all of that person's lines. A line's tab goes by what it looked like on most looks.
Something seen for just one look and never again isn't kept, as real lines stay up for a while.

It looks at the chat box 10 times a second while the game's in front, so a line that's only up for a quarter of a second is
still caught. The chat box closed shows one line at a time; opened (its + button), it shows ten, and fast speakers are much
less likely to push a buddy message past before it's seen. Buddy, party and other lines are read all the time; general chat
and speakers only while the window's open, as they're most of the chat. What it reads stays in memory and is gone when the
tracker closes: it's never saved or sent anywhere.

Checked on real pictures of the chat box open and closed, and on your screenshots of each kind of chat, but not yet live in the
game. A long line that wraps onto a second line in the open box shows as two lines (a second line with no name is only kept
for notices and boxes). The messages at the bottom right (pickups, crafting) aren't chat: they're not in this window.

The channels are read by the shapes of the badge's digits, made from your pictures by `tools/make_chat_badge.py`.

## What the scanner does

1. Follows the monsters on screen by their sprites, using only the ones that live on the current map, in their hit and
   death poses too.
2. Sees one vanish, and pairs it with your "You received EXP" line. No EXP line means someone else's kill.
3. Looks around where it died for the pictures of coins and of what that monster is known to drop.
4. Sees that thing leave the ground and pairs it with your pickup line, which gives the item's exact name. They have to
   agree: a coin can't become an item, or one item another.

A drop the database doesn't list has no picture to look for, so it isn't seen landing. On a map with one kind of monster it
still goes on the drop list from the pickup line, but not in the rate.

## Counting from the lines

The message lines come first now, and the pictures above are the backup (`linecount.py`). Hunting alone, each kind of
monster gives its own amount of EXP, so the line alone names it: on a map with Wild Boars (46) and Dark Axe Stumps (43),
46 means a Wild Boar. Two ways of being sure which kind a drop came from:

- **Stretches.** A span of time when only one kind was killed. Everything picked up in it came from that kind, mesos too.
  It ends at another kind's kill, an EXP amount that fits nothing here, a party line, a new map, the game going out of front,
  or the pictures seeing another kind die with no EXP line. Its first 20 seconds aren't counted, as what's picked up then may
  be left over from before. Nothing after its last kill is counted either.
- **Listed items.** Real hunting mixes kinds. But if only one kind on this map is known to drop an item, it can only have
  come from that kind, however mixed the kills: Fire Boar's Tooth against Fire Boar kills. Mesos and anything several
  kinds drop can't count this way.

Whether any of it counts is decided from the kills and how well they were read, never from what dropped. These numbers are
kept apart from the ones from the pictures, show on the Reading tab and in `report.html`, and **don't go on the website**:
that waits until they've been checked on a monster with counted rates.

Party kills aren't counted, for now. A party's EXP lines don't name the monster.

### Your inventory, the real check

Whenever your inventory's open and solid, it reads the tab showing: what each slot's picture is, and the number on it. An item's
first count is where it starts, and the **Inventory** tab of the Items window sets what it's gained since against the pickup
lines read for it, so it says plainly how many it really caught. Selling and buying count, as shops are watched. Handing items in
for a quest doesn't, yet, and reads as lines too many. So open each tab you care about before you hunt, and again after.
Only tabs you open are read, and only the rows showing. An item whose picture the tracker doesn't have can't be named, so it's left out.

### Quests

When you hand in a quest, the chat window shows a red OBTAINED! and what you got: items, EXP and mesos. It reads that, so a quest's
potions don't look bought, its mesos don't look sold, and its EXP isn't blamed on lines missed. It's in the run's account on the
Reading tab. EXP that jumps by a lot at once with no reward seen is left out of the reading too, as most likely a quest. What you
hand in for a quest isn't read yet, so it shows as a fall on the Inventory tab.

### Shops

While a shop's open, its window shows your mesos and keeps the row you clicked highlighted. So when your mesos fall, it knows
what you bought, and the fall over the row's price is how many: 100 Lemons at 150 is 15,000. The same goes for the other side
when you sell. It uses the price on screen, so a discount where you're a citizen counts. It's all in the run's account on the
Reading tab, and works for any item, not just what's on your quick bar.

### The map

It needs the minimap's name, as read off the screen (open or collapsed to its bar), to know what can be here. From that it looks up the database: which
monsters live here, how much EXP each gives, what each is known to drop, and which items only one of them drops. That's what
names a kill from its EXP, narrows down a name that's hard to read, and picks which sprites and drop pictures to look for. The
Reading tab shows what it knows about the map you're on. If the name's out of sight for 45 seconds, it can't be sure you're
on the same map, so kills stop counting until it can be read again. Run `tools/make_scan_data.py` after the database updates.

### How much it's reading

The Reading tab says how much of the last 5 minutes it caught, and of the whole run. The game's own numbers are the check: the EXP
lines against what the EXP number next to your MP bar went up by, whether tracking was paused or not (over 100% means lines counted
twice), and item lines read against those that couldn't be. Mesos are checked whenever your inventory is
open: the mesos lines counted since it was last open, however long ago, against how much the count went up. Mesos going down,
or a town in between, means a shop may have been involved, so it starts again from there. A span of play where the EXP lines add up to under 90% of the bar is left
out, in pieces of 5 minutes, so a bad minute only costs its own piece.

## What counts

For the pictures, there are two records, kept apart.

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

It starts by itself once it can read your EXP bar, and when you go to the game, the window tucks itself away on the
taskbar. The numbers stay on the card over the game. Both are switches in Settings, which also has a Drop scanner section
with a switch and a button that opens the drops folder.

| Keys | What they do |
| --- | --- |
| Shift+F1 | Tuck the window away, or bring it back |
| Shift+F2 | Hide or show the card, until the tracker next opens |
| Shift+F3 | Pause or carry on |
| Shift+F4 | Repot bell |
| Shift+F5 | Move the card |
| Shift+F6 | Reset |
| Shift+F7 | Items window |
| Shift+F8 | Chat window |

They work while the game or the tracker is in front, and bringing the window back leaves the keyboard with the game. With
another program in front, click the taskbar button or double-click the desktop shortcut.

You can change them in Settings to nearly any key, such as plain 0, 9, 8 and 7, with no Shift. A plain key also works while
Shift's held down to attack. The game gets those keys too, so typing a plain key in chat sets it off as well, which matters most
for Reset. It's ignored while a shop's "how many" box is up. `hotkeys.log` in the data folder says which presses came through.

**The tracker only runs as administrator.** However it's started, Windows asks first, and it stops if the answer's no. The game runs
as administrator, and Windows doesn't show a normal program any keys pressed while an administrator program is in front.

The tracker notices these by checking whether the keys you chose are down: only those keys, only while the game or the tracker is in
front. It sends nothing to the game.

The tracker runs at below-normal priority, so the game comes first.

## What it leaves behind

Everything stays in `%APPDATA%\MapleEXP\drops`:

- `report.html`: everything added up
- `new_for_database.json`: drops the database doesn't list yet, shaped like `tools/player_drops.json`
- `pictures/`: what each drop looked like on the ground, for checking by eye
- `log.jsonl` and `session-*.json`: the raw results
- `clips/`: short videos around kills and pickups, for finding out why it got something wrong. They show the whole game
  window, chat included. They use up to 5 GB, the oldest are deleted first, and Settings has a switch to turn them off.
  Nothing is recorded while you're in a party, since party kills don't count towards rates.

Check new drops against their pictures before copying them to the database.

The Reading tab shows what all your sessions add up to: kills counted, why others were skipped, and how far each monster
is from the 200 kills it needs.

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
| The page of which monster drops what (`tests/test_mobbook.py`) | Passing |
| Reading the chat box, on real pictures of it open and closed, and real buddy lines (`tests/test_chat.py`) | Passing |
| Saving clips and replaying them, on made-up footage (`tests/test_clips.py`) | Passing |
| Finding a real Wild Boar in one real 1920x1080 screenshot, among all 83 monsters | Correct: 0.74 against 0.68 for the next best |
| The tracker window with the scanner connected | **Not run yet** |
| A real kill, drop and pickup in the real game | **Not done yet** |

The first time it sees a given window size, it takes a few seconds to learn how big sprites show, and it can miss the
drops of kills made around then. It remembers the size afterwards.

On 18 real clips of Land of Wild Boar with the inventory open: the scanner lost its place 14 times in six clips, because
windows left open don't move with the world. It now follows the view through them, and a picture stitched from where it
says the view went comes out sharp. In four clips, the message readers went from 2 item lines read to 16, of at least 35
showing. That's on clips at about 3 looks a second, and the live tracker takes about 10, so it hasn't been measured live.

It looks at the field and the messages 10 times a second, and shows how often it really managed on the Reading tab. Following
what's known happens every look, and finding what's new about 3 times a second. Run together in real time on the real
clips (no game running, so not the real load): 9.5 looks a second each, at under one core (4% of a 24-thread PC). OpenCV
was spreading each job over every core: the same work took 5.8 cores before it was limited to one.

The first real check of the reading, with the real bar and mesos readers on nine party clips: the lines caught under 60% of what
the bar gained. Working out how the stack moved from the rows known to be lines (a sign behind the stack had been counted as
one), no longer throwing out looks when a line behind the new ones couldn't be read, and a second way of seeing letters over pale
rock took that to about 76% for EXP and 79% for mesos, with almost nothing counted twice. Those clips have gaps of up to a second
between frames, as the scanner used to be slow, and lines get lost in them. Known lines drawn over the real scenery at 10 looks a
second are caught with 1 to 3% counted twice, but that's easier than the real thing. So 90% hasn't been shown yet: a real
session is what will say. Item names went from 45 to 64 named on those clips, with one wrong name (Fire Boar's Tooth for a Wild
Boar Tooth), and many of the rest were never recognised as item lines. Real lines saved on 5 Nov named kills by kind on a map of
five kinds.

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
