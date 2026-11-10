"""Reading the game's chat box (chatwatch.py) and the Chat window (ui_chat.py).

The pictures are from the owner's real game (2560x1440), cut from the tracker's own clips: the chat box open (many lines), and
two runs of the closed box (one line at a time) frame by frame. They show other players' chat, so they're kept on this
computer only (tests/frames/chat_lines is left out of git): without them, those checks are skipped.

Buddy chat is checked on the owner's screenshot of the open box with real buddy lines in it (buddy_screenshot.png: a crop of
the game, so it's lined up as it was in the game window, at buddy_open.png), and on a real general-chat line coloured orange.

Run it:  python tests/test_chat.py"""
import shutil
import sys
import time
import tkinter as tk
from pathlib import Path
from tkinter import font as tkfont
from types import SimpleNamespace as NS

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import chatwatch as cw  # noqa: E402
import ocr  # noqa: E402
from ui_chat import ChatWindow  # noqa: E402

failures = 0


def check(name, ok, detail=""):
    global failures
    print(("PASS " if ok else "FAIL ") + name + (f"   {detail}" if detail and not ok else ""))
    failures += not ok


RECT = (0, 0, 2560, 1440)
X0 = cw.text_x(RECT)
FRAMES = ROOT / "tests" / "frames" / "chat_lines"

# ---- what kind a line is, from its letters' colour (b, g, r), as measured on the real clips
check("white is general chat", cw.kind_of((226, 226, 226)) == "general")
check("pink is party chat", cw.kind_of((190, 160, 226)) == "party")
check("the pale orange of \"has joined the party\" is party too", cw.kind_of((146, 159, 206)) == "party")
check("yellow is a notice", cw.kind_of((89, 209, 206)) == "notice")
check("bright orange is buddy chat", cw.kind_of((40, 150, 255)) == "buddy" and cw.kind_of((0, 128, 255)) == "buddy")
check("green is a whisper", cw.kind_of((60, 230, 60)) == "whisper")

def letters_colour(img):
    """The colour of the lightest of a crop's letters (b, g, r)."""
    on, v = cw.ink(img, 0.7), img.max(axis=2)
    top = on & (v >= np.percentile(v[on], 75))
    return tuple(int(c) for c in np.median(img[top], axis=0))


# The owner's own screenshots of each kind of chat (cut from the game, about 0.7 of its size), with the rows of their lines:
# (what's above and below them in the crop is another kind of line, or scenery)
for name, ys, want in (("general_crop_1.png", (12, 30), "general"), ("general_crop_2.png", (0, 50), "general"),
                       ("buddy_crop_1.png", (0, 46), "buddy"), ("buddy_crop_2.png", (0, 12), "buddy"),
                       ("buddy_crop_3.png", (4, 24), "buddy"), ("party_crop_1.png", (4, 33), "party"),
                       ("party_crop_2.png", (8, 34), "party"), ("party_crop_3.png", (0, 22), "party"),
                       ("notice_crop.png", (0, 38), "notice")):
    if (FRAMES / name).exists():
        colour = letters_colour(cv2.imread(str(FRAMES / name))[ys[0]:ys[1]])
        check(f"the owner's {want} chat is {want} ({name})", cw.kind_of(colour) == want, f"{colour} {cw.kind_of(colour)}")
check("light blue is other", cw.kind_of((240, 200, 120)) == "other")

# ---- speakers' blocks and channels
check("a speaker's block colours, by name", [cw.block_colour(c) for c in ((14, 184, 234), (192, 170, 225), (202, 219, 94), (94, 99, 185),
      (115, 115, 115))] == ["yellow", "pink", "blue", "red", "grey"])
for name, want in (("speakers_crop_1.png", ["01", "13", "01", "01", "14", "07"]), ("speakers_crop_2.png", ["27", "27", "01"])):
    if (FRAMES / name).exists():                    # (the owner's screenshots of speakers: about 0.7 of the game's size)
        img = cv2.imread(str(FRAMES / name))
        got = [cw.channel(img, int(k * 30.25 * 0.7), int((k + 1) * 30.25 * 0.7), 3, 0.7) for k in range(len(want))]
        check(f"speakers' channels, from their badges ({name})", got == want, got)
if (FRAMES / "open_0023_86.png").exists():
    img = cv2.imread(str(FRAMES / "open_0023_86.png"))
    got = [(r.block, r.channel) for r in cw.rows(img, 1.0, X0) if r.kind == "speaker"]
    check("speakers in the open box: each block's colour and channel", got == [("yellow", "01"), ("yellow", "26"), ("pink", "38"),
          ("blue", "40"), ("blue", "40"), ("pink", "38"), ("pink", "11")], got)
check("the badge's shapes are all there: CH and every digit", set(cw._badge_shapes()) == set("0123456789") | {"CH"}, sorted(cw._badge_shapes()))

# ---- something special opened from a box: light letters on a red block (the owner's screenshot, put in a real open box)
if (FRAMES / "crate_crop.png").exists() and (FRAMES / "buddy_open.png").exists():
    boxed = cv2.imread(str(FRAMES / "buddy_open.png"))
    crate = cv2.resize(cv2.imread(str(FRAMES / "crate_crop.png")), None, fx=1 / 0.7, fy=1 / 0.7, interpolation=cv2.INTER_CUBIC)
    w = min(crate.shape[1], boxed.shape[1] - 50)
    boxed[336:336 + crate.shape[0], 50:50 + w] = crate[:, :w]
    got = [(r.kind, r.block) for r in cw.rows(boxed, 1.0, 54)]
    check("a box's red line is a box line", got[:1] == [("box", "red")] and ("party", "") in got, got)
check("a box line is a line", cw.is_line("box", "Painted obtained [Chocolate Ribbon! from the Aurora Mysterv Fashion Crate! Cona"))

# ---- where the chat box is, for any window size
x, y, w, h = cw.area(RECT)
check("the area's above the status bar, left of the middle", (x, y, w, h) == (500, 750, 1080, 620), (x, y, w, h))
check("it scales with the game", cw.area((100, 50, 1280, 720)) == (350, 50 + 375, 540, 310), cw.area((100, 50, 1280, 720)))

# ---- names and what they said, as Tesseract reads them
for text, want in (("OpZeno : try it", ("OpZeno", "try it")), ("sababaa > yvessillir", ("sababaa", "yvessillir")),
                   ("StorGnu 5 9 : S> 50k NX", ("StorGnu", "S> 50k NX")), ("Bob>> hi there", ("Bob", "hi there")),
                   ("[Notice] Beware of fraudulent messages", ("", "[Notice] Beware of fraudulent messages"))):
    check(f"split: {text}", cw.split(text) == want, cw.split(text))
# (buddies' names have "()" after them, on the owner's screenshots of buddy chat)
for text, want in (("Remoneide() : LOL", ("Remoneide", "LOL")), ("andra() : night dear <3 <3", ("andra", "night dear <3 <3")),
                   ("Boeuff( ) : xD", ("Boeuff", "xD")), ("Gabbaroo(] : wb", ("Gabbaroo", "wb"))):
    check(f"split, a buddy: {text}", cw.split(text) == want, cw.split(text))
    check(f"a buddy's line is a line: {text}", cw.is_line("buddy", text))
check("a long notice's second line is kept",
      cw.is_line("notice", "yers. Please beware of scams and anyone impersonating an Administrator."))
check("a notice's first line is kept", cw.is_line("notice", "[Notice] An Administrator will never ask for personal information, items, etc from pla"))
check("marks from a block's edge are let go", cw.tidy("| Smiz - Blood Fitted Mail S |") == "Smiz - Blood Fitted Mail S", cw.tidy("| Smiz - Blood Fitted Mail S |"))
check("scenery read as marks isn't words", not cw.words("i SE wi CY =_ ¥ 2 Ga") or not cw.split("i SE wi CY =_ ¥ 2 Ga")[0])

# ---- the log: the same line never twice
log = cw.ChatLog()
a, new = log.add("buddy", "Jine : are you on?", 1.0, 1000.0)
check("a line is added", new and a.who == "Jine" and a.text == "are you on?")
check("read again a little differently, it isn't added again", log.add("buddy", "Jine : are y0u on", 2.0, 1001.0) == (a, False))
check("read better, it's kept as the better one", log.add("buddy", "Jine : are you on? I need help with the boss", 3.0, 1002.0) == (a, False)
      and log.lines[0].text == "are you on? I need help with the boss", log.lines[0].text)
check("general chat with no name is scenery, not chat", log.add("general", "ri ee Sa die Dun oo bebe", 5.0, 1004.0) == (None, False))
check("nor are nameless words that aren't the game's news", log.add("party", "TOS We a Eee Ol od OUD", 5.0, 1004.0)[0] is None)
check("the party's news has no name, and is a line", log.add("party", "'jine' has joined the party.", 5.0, 1004.0)[1])
check("a line read late goes where it was seen", log.add("buddy", "Mo : hi", 6.0, 999.0)[1] and log.lines[0].who == "Mo")
check("tabs", [x.who for x in log.of(("buddy", "whisper"))] == ["Mo", "Jine"])
later = cw.REMEMBER_S + 10
check("long after, the same words are a new line", log.add("buddy", "Jine : are you on?", later, 1000.0 + later)[1])

# Names: Tesseract reads the same name several ways. One person, shown the way most readings say.
log = cw.ChatLog()
for i, text in enumerate(["xeyna : hi there", "Xeyna : how are you", "meyna : im good", "xeyna : lol", "Xeyha . ok then", "xeyna | bye"]):
    log.add("party", text, float(i), 1000.0 + i)
check("names: one person, however it's read", {x.person for x in log.lines} == {0} and len(log.names.people) == 1, log.names.people)
check("names: shown the one way, on every line, capitalised", {x.who for x in log.lines} == {"Xeyna"}, {x.who for x in log.lines})
check("names: and ':' read as '.', '|' or '>'", [x.text for x in log.lines][-2:] == ["ok then", "bye"], [x.text for x in log.lines])
log.add("party", "Gzrk : and they took my mom's jewelry", 10.0, 1010.0)
log.add("party", "(szrk : and they took my mom's jewelry", 10.5, 1010.5)
check("names: the same words just now, with the name read badly, are the same line", len([x for x in log.lines if "jewelry" in x.text]) == 1)
log.add("speaker", "Steaciynancl : fie S> Earring, 10% STR 18k", 20.0, 1020.0)
log.add("speaker", "steadyhand : o> Earring, 10% STR 18k", 21.0, 1021.0)
check("a speaker's badge read as marks before the words doesn't make it another line", len([x for x in log.lines if "STR 18k" in x.text]) == 1)
log.add("party", "Boeuff : idk lol", 30.0, 1030.0)
said, new = log.add("general", "Boeuff : idk lol", 30.1, 1030.1)
log.add("party", "Boeuff : idk lol", 30.2, 1030.2)
check("kind: read as general once over pale scenery, party every other look: it's party", not new and said.kind == "party", dict(said.kinds))

# ---- reading, kept apart from looking: buddy lines are read first, and a line's picture isn't read twice
calls = []
WORDS = ["apple pie", "big red boat", "cold winter night", "dancing in the rain", "every single day", "four green fields",
         "golden hour light", "happy little trees", "icy mountain pass", "jumping jack flash", "kites on the beach", "lemon tree",
         "morning coffee run", "never give up", "open the window", "purple rain falls", "quiet library", "running late again",
         "sunny side up", "tall pine forest", "under the bridge", "very fast car"]


def fake_read(images, chars=None):
    calls.append(len(images))
    start = sum(calls) - len(images)
    return [f"P{start + i}person : {WORDS[(start + i) % len(WORDS)]}" for i in range(len(images))]


def shape(seed):
    return np.random.default_rng(seed).random((8, 40)).astype(np.float32)


watch = cw.ChatWatch(fake_read)
with watch.lock:
    for k in range(cw.BATCH + 4):
        watch.waiting.append(("speaker", shape(k), np.ones((20, 160), np.float32), 1.0, float(k), 100.0 + k, 30 * k, "", ""))
    watch.waiting.append(("buddy", shape(99), np.ones((20, 160), np.float32), 1.0, 50.0, 150.0, 0, "", ""))
watch.read()
check("lines waiting are read many at once", calls == [cw.BATCH], calls)
check("a buddy line seen last is read first", any(x.kind == "buddy" for x in watch.log.lines))
watch.read()
check("the rest at the next go", not watch.waiting and len(watch.log.lines) == cw.BATCH + 5, len(watch.log.lines))
check("they're in the log by when they were seen", [x.when for x in watch.log.lines] == sorted(x.when for x in watch.log.lines))
check("a line seen once isn't told of straight away", watch.take_new(0.5) == [])
for said in watch.log.lines[:3]:
    watch.log.seen_again(said, said.kind, 1.0)
    watch.log.seen_again(said, said.kind, 1.1)
check("seen three times, it's told of, once", len(watch.take_new(1.2)) == 3 and watch.take_new(1.3) == [])
watch.take_new(1e9)
check("seen once and never again, it was nothing: it's let go", len(watch.log.lines) == 3, len(watch.log.lines))

if not FRAMES.exists():
    print("SKIP the real pictures: tests/frames/chat_lines isn't on this computer")
else:
    opened = sorted(FRAMES.glob("open_*.png"))
    seqs = {p.stem[-4:]: cv2.imread(str(p)) for p in FRAMES.glob("closed_seq_*.png")}
    covered = cv2.imread(str(FRAMES / "covered_0011_60.png"))

    # -- the box open, or closed, or not there
    check("open box: the bar you type in is seen", all(cw.box_state(cv2.imread(str(p)), 1.0, X0) == "open" for p in opened))
    strips = [s[i * 60:(i + 1) * 60] for s in seqs.values() for i in range(s.shape[0] // 60)]
    states = [cw.box_state(s, 1.0, X0) for s in strips]
    check("closed box: the grey bar is seen", states.count("closed") >= 0.95 * len(states), f"{states.count('closed')} of {len(states)}")
    check("the tracker's card over the chat box: nothing to read", cw.box_state(covered, 1.0, X0) is None and cw.rows(covered, 1.0, X0) == [])

    # -- what kind each line is, in the open box (checked by eye on the picture)
    img = cv2.imread(str(FRAMES / "open_0020_201.png"))
    kinds = [r.kind for r in cw.rows(img, 1.0, X0)]
    want = ["general", "general", "speaker", "general", "general", "notice", "general", "speaker", "party"]
    check("open box: every line, and its kind", kinds[-len(want):] == want, kinds)
    img = cv2.imread(str(FRAMES / "open_0018_22.png"))
    kinds = [r.kind for r in cw.rows(img, 1.0, X0)]
    want = ["speaker"] * 5 + ["general", "speaker", "general", "general"]
    check("open box: speakers on every colour of block, general chat between", kinds[-len(want):] == want, kinds)

    # -- the owner's screenshot: two buddy lines among party chat and speakers. Where the crop sits in the game window is only
    # known to a few pixels, and the open box's lines are found wherever they are within that.
    shot = cv2.imread(str(FRAMES / "buddy_screenshot.png"))
    want = ["speaker", "party", "speaker", "party", "buddy", "buddy", "party"]
    for bottom in (596, 602, 608):
        kinds = [r.kind for r in cw.rows(np.pad(shot[:bottom], ((0, 0), (7, 0), (0, 0)), mode="edge"), 1.0, 54)]
        check(f"buddy screenshot ({bottom - 602:+d} px): buddy lines, and party and speakers around them", kinds == want, kinds)
    check("a pink line with orange rock behind it is still party", cw.rows(cv2.imread(str(FRAMES / "buddy_open.png")), 1.0, 54)[1].kind == "party")

    # -- no false alarms: lines of every kind seen in the closed box, and no buddy line (there was none)
    seen = [r.kind for s in strips for r in cw.rows(s, 1.0, X0)]
    check("no buddy line in the closed box where there was none", not {"buddy", "whisper"} & set(seen), sorted(set(seen)))
    check("party lines in the closed box are seen", "party" in seen and "notice" in seen and "general" in seen)

    # -- buddy chat: a real line, coloured bright orange
    def recolour(strip, bgr):
        out = strip.copy().astype(np.float32)
        v = out.max(axis=2)
        letters = (v >= 150) & ((out.max(axis=2) - out.min(axis=2)) < 40)
        letters[:, : X0 - 20] = False
        out[letters] = (v[letters, None] / 255.0) * np.array(bgr, np.float32)
        return out.clip(0, 255).astype(np.uint8)
    general = next(s for s in strips if [r.kind for r in cw.rows(s, 1.0, X0)] == ["general"])
    check("a general line coloured bright orange is buddy chat", [r.kind for r in cw.rows(recolour(general, (30, 150, 255)), 1.0, X0)] == ["buddy"])
    check("...and green, a whisper", [r.kind for r in cw.rows(recolour(general, (60, 230, 60)), 1.0, X0)] == ["whisper"])

    # -- quick enough to look 10 times a second
    t = time.perf_counter()
    for p in opened:
        cw.rows(cv2.imread(str(p)), 1.0, X0)
    each = (time.perf_counter() - t) / len(opened)
    check("a look at the open box takes well under a tenth of a second", each < 0.06, f"{each * 1000:.0f} ms")

    exe = shutil.which("tesseract") or r"C:\Program Files\Tesseract-OCR\tesseract.exe"
    if not Path(exe).exists():
        print("SKIP reading the real pictures: no Tesseract here")
    else:
        tess = ocr.Tesseract(exe)
        watch = cw.ChatWatch(tess.read_lines)
        watch.look(cv2.imread(str(FRAMES / "open_0020_201.png")), 1440, X0, 0.0, 1000.0)
        while watch.waiting:
            watch.read()
        said = [(x.kind, x.who.lower(), x.text) for x in watch.log.lines]

        def has(kind, who, words):
            return any(k == kind and w == who.lower() and words.lower() in t.lower() for k, w, t in said)
        check("real: a speaker's line", has("speaker", "Tabarnuke", "old school blazer 50k"), said)
        check("real: general chat", has("general", "OpZeno", "try it"), said)
        check("real: a notice", any(k == "notice" and "Party Invitations" in t for k, _, t in said), said)
        check("real: party news", any(k == "party" and "the party" in t for k, _, t in said), said)
        n = len(watch.log.lines)
        watch.look(cv2.imread(str(FRAMES / "open_0020_201.png")), 1440, X0, 1.0, 1001.0)
        check("real: the same box again adds nothing, and isn't read again", len(watch.log.lines) == n and not watch.waiting)

        # Above the open box is scenery, and it can look like a line (orange rock: buddy). It reads as nonsense, so it's
        # never added, and once it has, that spot's left alone for a moment.
        watch = cw.ChatWatch(tess.read_lines)
        for k, p in enumerate(opened):
            watch.look(cv2.imread(str(p)), 1440, X0, float(k), 1000.0 + k)
            while watch.waiting:
                watch.read()
        check("real: no buddy line from the open box where there was none", not [x for x in watch.log.lines if x.kind in ("buddy", "whisper")],
              [(x.kind, x.who, x.text) for x in watch.log.lines if x.kind in ("buddy", "whisper")])
        img = cv2.imread(str(FRAMES / "open_0023_243.png"))
        check("real: scenery above the open box isn't taken for a line", min(r.top for r in cw.rows(img, 1.0, X0)) > 280,
              [(r.kind, r.top) for r in cw.rows(img, 1.0, X0)])
        # Something that does look like a line, and reads as nonsense: that spot's left alone for a moment.
        junk = cw.ChatWatch(lambda images, chars=None: ["TOS We a Eee Ol od OUD"] * len(images))
        img = cv2.imread(str(FRAMES / "open_0020_201.png"))
        junk.look(img, 1440, X0, 10.0)
        junk.read()
        moved = img.copy()                          # (the scenery changes as you move: another picture there)
        moved[:, X0:] = np.roll(moved[:, X0:], 37, axis=1)
        junk.look(moved, 1440, X0, 10.5)
        check("real: once a spot's read as nonsense, it isn't read again straight away", not junk.waiting and not junk.log.lines, len(junk.waiting))
        junk.look(moved, 1440, X0, 13.0)
        check("real: ...but it's looked at again after a while", junk.waiting, len(junk.waiting))
        # A real line read as nonsense once (busy scenery behind it) is read again, not remembered as nonsense for good.
        calls = []

        def spoilt_twice(images, chars=None):
            calls.append(len(images))
            return ["TOS We a Eee Ol od OUD" if len(calls) <= 2 else "Remoneide() : are you on?"] * len(images)
        retry = cw.ChatWatch(spoilt_twice, kinds={"buddy"})
        one = cv2.imread(str(FRAMES / "buddy_open.png"))
        for t in (0.0, 2.5, 5.0, 7.5):
            retry.look(one, 1440, 54, t, 1000.0 + t)
            while retry.waiting:
                retry.read()
        check("real: a buddy line read as nonsense at first is read again, and kept", any(x.kind == "buddy" for x in retry.log.lines),
              [(x.kind, x.text) for x in retry.log.lines])

        # A whisper: near-white letters on an even green bar (the owner's screenshot, put in a real open box, its bar carried
        # on to the line's end as it is in the game).
        if (FRAMES / "whisper_crop.png").exists():
            img = cv2.imread(str(FRAMES / "buddy_open.png"))
            w = cv2.imread(str(FRAMES / "whisper_crop.png"))
            img[422:452, 40:40 + w.shape[1]] = w[6:36]
            img[422:452, 40 + w.shape[1]:54 + 700] = w[6:36, 495:500].mean(axis=1, keepdims=True).astype(np.uint8)
            got = [(r.top, r.kind) for r in cw.rows(img, 1.0, 54)]
            check("real: a whisper's green bar is a whisper", (424, "whisper") in got, got)
            watch = cw.ChatWatch(tess.read_lines, kinds=cw.SHOWN)
            watch.look(img, 1440, 54, 0.0, 1000.0)
            while watch.waiting:
                watch.read()
            got = [(x.who, x.text) for x in watch.log.lines if x.kind == "whisper"]
            check("real: ...and read", len(got) == 1 and got[0][0] == "minickp" and "move" in got[0][1], got)
        whispers = [(p.name, r.top) for p in sorted(FRAMES.glob("open_*.png")) for r in cw.rows(cv2.imread(str(p)), 1.0, X0) if r.kind == "whisper"]
        check("real: no whispers where there are none", not whispers, whispers)

        # The owner's screenshot of buddy lines over a lit-up map, between speakers ("Remoneide() : 11m" was missed, and
        # "Remoneidef) :" / "Pernoneide(y:" weren't taken for names), put in a real open box where its lines go.
        if (FRAMES / "buddy_scenery.jpg").exists():
            img = cv2.imread(str(FRAMES / "buddy_open.png"))
            crop = cv2.imread(str(FRAMES / "buddy_scenery.jpg"))
            h = 540 - 116
            img[116:116 + h, 36:36 + crop.shape[1]] = crop[:h]
            got = [r.top for r in cw.rows(img, 1.0, 54) if r.kind == "buddy"]
            check("real: buddy lines over a lit-up map are all found", got == [328, 388, 448, 479], got)
            watch = cw.ChatWatch(tess.read_lines, kinds={"buddy"})
            watch.look(img, 1440, 54, 0.0, 1000.0)
            while watch.waiting:
                watch.read()
            texts = [x.text for x in watch.log.lines if x.kind == "buddy"]
            check("real: ...and all read", len(texts) == 4 and "11m" in texts[-1], texts)

        watch = cw.ChatWatch(tess.read_lines)
        watch.look(cv2.imread(str(FRAMES / "buddy_open.png")), 1440, 54, 0.0, 1000.0)
        while watch.waiting:
            watch.read()
        said = [(x.kind, x.who.lower(), x.text) for x in watch.log.lines]
        check("real: the owner's buddy lines, read", [t for k, _, t in said if k == "buddy"][:2] == ["this is just a test haha", "test"]
              or sum(k == "buddy" for k, _, _ in said) == 2, said)
        check("real: and only those are buddy", sum(k == "buddy" for k, _, _ in said) == 2, said)
        check("real: party chat beside them", sum(k == "party" for k, _, _ in said) >= 2, said)

        # The closed box, frame by frame (about 3 a second, from a clip), as it would be live.
        watch = cw.ChatWatch(tess.read_lines)
        t0 = time.perf_counter()
        for i, s in enumerate(strips):
            watch.look(s, 1440, X0, i * 0.3, 1000.0 + i * 0.3)
            if i % 3 == 2:
                while watch.waiting:
                    watch.read()
        while watch.waiting:
            watch.read()
        spent = time.perf_counter() - t0
        lines = watch.log.lines
        twice = [(a.text, b.text) for i, a in enumerate(lines) for b in lines[i + 1:]
                 if a.kind == b.kind and cw.same_line(f"{a.who} : {a.text}", f"{b.who} : {b.text}")]
        check("real: closed box, no line shown twice", not twice, twice[:3])
        check("real: closed box, lines of each kind", {"speaker", "general", "party", "notice"} <= {x.kind for x in lines},
              sorted({x.kind for x in lines}))
        check("real: a line on screen for many looks is read once", watch.reads < len(strips) / 3, f"{watch.reads} reads, {len(strips)} looks")
        check("real: reading keeps up", spent < len(strips) * 0.3, f"{spent:.1f} s for {len(strips) * 0.3:.0f} s of play")
        print(f"     ({len(lines)} lines from {len(strips)} looks, {watch.reads} runs of Tesseract, {spent:.1f} s)")
        buddy = cw.ChatWatch(tess.read_lines)
        buddy.look(recolour(general, (30, 150, 255)), 1440, X0, 0.0)
        buddy.read()
        buddy.look(recolour(general, (30, 150, 255)), 1440, X0, 0.1)
        check("real: the orange line is read, as buddy chat", len(buddy.log.lines) == 1 and buddy.log.lines[0].kind == "buddy"
              and buddy.log.lines[0].who, [(x.kind, x.who, x.text) for x in buddy.log.lines])

# ---- the window
root = tk.Tk()
root.withdraw()
theme = NS(px=lambda n: n, font=lambda weight, size: tkfont.Font(root=root, family="Segoe UI", size=-size))
colours = dict(bg="#101317", fg="#e8eaed", dim="#8a919b", list_bg="#181c21", select="#2a3038", accent="#6ad0ff")
log = cw.ChatLog()
alert, places = [True], []
win = ChatWindow(root, theme, colours, lambda: log, lambda: "Reading the chat box.", (lambda: alert[0], lambda on: alert.__setitem__(0, on)),
                 geometry="400x300+-4000+-4000", on_geometry=places.append)
root.update()
check("window: it opens on Buddy, over everything", win.page == "Buddy" and bool(win.win.attributes("-topmost")))
check("window: says when there's nothing yet", "No buddy messages yet" in win.text.get("1.0", "end"))
log.add("speaker", "Kati : S> Nine Dragons 83 Attack PMO", 1.0, 1000.0)
log.add("buddy", "Jine : are you on?", 2.0, 1001.0)
win.refresh()
root.update()
body = win.text.get("1.0", "end")
check("window: a buddy message, with its time", "Jine" in body and "are you on?" in body and time.strftime("%H:%M", time.localtime(1001.0)) in body, body)
check("window: speakers aren't on the Buddy tab", "Kati" not in body)
log.add("buddy", "Mo : hi", 3.0, 1002.0)
log.add("buddy", "Jine : are you on?", 3.5, 1002.5)          # (seen again: not a new line)
win.refresh()
root.update()
body = win.text.get("1.0", "end")
check("window: new lines are added at the end, none twice", body.count("are you on?") == 1 and body.index("Mo") > body.index("Jine"), body)
check("window: just Buddy, Party, General (and All) tabs", list(win.tab_buttons) == ["Buddy", "Party", "General", "All"], list(win.tab_buttons))
check("only buddy, party and general chat are read and shown", set(cw.SHOWN) == {"buddy", "whisper", "party", "general"}, cw.SHOWN)
log.add("general", "OpZeno : try it", 4.0, 1003.0)
win.show("General")
root.update()
body = win.text.get("1.0", "end")
check("window: General shows general chat, not speakers", "OpZeno" in body and "Kati" not in body, body)
check("window: once seen, the tab's count goes", win.tab_buttons["General"].cget("text") == "General")
win.show("All")
root.update()
body = win.text.get("1.0", "end")
check("window: All has buddy and general chat, not speakers", all(w in body for w in ("OpZeno", "Jine", "Mo")) and "Kati" not in body, body)
check("window: the text starts bigger", win.size == 18, win.size)
win.flash()
win.refresh()
check("window: a new buddy message lights the Buddy tab", win.tab_buttons["Buddy"].cget("bg") == colours["accent"] or win.flash_left > 0)
win.win.geometry("420x320+-4000+-4000")
root.update()
check("window: where it's moved to is kept", places and places[-1].startswith("420x320"), places[-1:] if places else None)
win.win.destroy()
root.destroy()

print("ALL PASS" if not failures else f"{failures} FAILED")
sys.exit(1 if failures else 0)
