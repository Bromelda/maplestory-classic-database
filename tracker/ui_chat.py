"""The Chat window: what the game's chat box said this run, a tab for each kind, so a buddy's message isn't lost in general chat.

Buddy, Party and General each keep their own list, oldest at the top, each line with the time it was first seen (speakers,
notices and the rest aren't read: the owner doesn't want them). It stays on top of the game, and you can move it and change its
size: it opens where you left it. A- and A+ make the lines' text smaller or bigger. A new buddy message can ring a bell and
light the Buddy tab up (a switch at the bottom turns that off). Right-click a tab to open it in a window of its own, beside
this one: as many as you like (buddy chat in one, party in another...), each just like this one.

It's only a window on what the tracker already read (chatwatch.py): closing it loses nothing.
"""
import time
import tkinter as tk

from chatwatch import TABS

REFRESH_MS = 250
TEXT_SIZES = (12, 36)           # how small and big the lines can be made (A- and A+)
TEXT_SIZE = 18                  # ...and to start with
FLASHES = 6                     # the Buddy tab lights up this many times for a new message
COLOURS = {"buddy": "#ffa040", "whisper": "#7be37b", "party": "#f5a3d8", "general": "#f1efe9", "notice": "#f0e070",
           "speaker": "#9fd3f0", "box": "#ff9a9a", "guild": "#c4a6ff", "other": "#9fe0e0"}
LABELS = {"whisper": "whisper", "notice": "notice", "box": "box", "guild": "group?"}   # (a word after the time, for kinds sharing a tab)
BLOCKS = {"yellow": "#f2c94c", "blue": "#6fd6e0", "pink": "#f0a6d6", "red": "#ff8a8a", "grey": "#b8b8b8"}   # a speaker's block


def clock_text(when):
    return time.strftime("%H:%M:%S", time.localtime(when))


def tab_of(kind):
    for name, kinds in TABS:
        if kind in kinds:
            return name
    return "Other"


class ChatWindow:
    """get_log: the ChatLog. get_status: a line saying how the reading's going. alert: (get, set) for the bell switch.
    colours: bg, fg, dim, list_bg, select, accent. on_geometry(text): where the window is now, to open it there next time.
    text_size: (get, set) for how big the lines' text is. page: the tab it opens on. new_window(tab, this window): open
    another window on that tab (a tab's right-click menu)."""

    def __init__(self, root, theme, colours, get_log, get_status, alert, geometry=None, on_geometry=None, style_window=None,
                 text_size=None, page="Buddy", new_window=None):
        self.get_log, self.get_status, self.alert, self.on_geometry = get_log, get_status, alert, on_geometry
        self.new_window = new_window
        self.theme, self.text_size = theme, text_size
        self.colours = c = colours
        px = theme.px
        w = self.win = tk.Toplevel(root)
        w.title("Chat")
        w.configure(bg=c["bg"])
        w.attributes("-topmost", True)                 # (over the game, always: that's what it's for)
        w.geometry(geometry or f"{px(520)}x{px(360)}")
        w.minsize(px(260), px(160))
        w.bind("<Escape>", lambda e: w.destroy())
        w.bind("<Configure>", self._moved)
        if style_window:
            for delay in (0, 150, 800):
                w.after(delay, lambda: style_window(w) if w.winfo_exists() else None)
        text, small = theme.font("semibold", 13), theme.font("regular", 11)

        tabs = tk.Frame(w, bg=c["bg"])
        tabs.pack(fill="x", padx=px(10), pady=(px(10), px(6)))
        self.tab_buttons, self.seen = {}, {}
        for name, _ in TABS + (("All", None),):
            b = tk.Label(tabs, text=name, bg=c["bg"], fg=c["dim"], font=text, padx=px(8), pady=px(4), cursor="hand2")
            b.pack(side="left", padx=(0, px(2)))
            b.bind("<Button-1>", lambda e, n=name: self.show(n))
            if new_window:
                b.bind("<Button-3>", lambda e, n=name: self._tab_menu(e, n))
            self.tab_buttons[name] = b
            self.seen[name] = 0

        bottom = tk.Frame(w, bg=c["bg"])
        bottom.pack(side="bottom", fill="x", padx=px(10), pady=(px(4), px(8)))
        self.ring = tk.BooleanVar(value=bool(alert[0]()))
        tk.Checkbutton(bottom, text="Bell and flash for buddy messages", variable=self.ring, command=lambda: alert[1](bool(self.ring.get())),
                       bg=c["bg"], fg=c["dim"], selectcolor=c["list_bg"], activebackground=c["bg"], activeforeground=c["fg"],
                       font=small, bd=0, highlightthickness=0).pack(side="left")
        for label, step in (("A+", 2), ("A-", -2)):
            b = tk.Label(bottom, text=label, bg=c["bg"], fg=c["dim"], font=text, padx=px(8), cursor="hand2")
            b.pack(side="right")
            b.bind("<Button-1>", lambda e, d=step: self.resize_text(d))
        self.status = tk.StringVar()
        self.status_label = tk.Label(w, textvariable=self.status, bg=c["bg"], fg=c["dim"], font=small, justify="left", anchor="w")
        self.status_label.pack(side="bottom", fill="x", padx=px(12))
        w.bind("<Configure>", lambda e: e.widget is w and self.status_label.configure(wraplength=max(120, e.width - px(24))), add="+")

        box = tk.Frame(w, bg=c["list_bg"])
        box.pack(fill="both", expand=True, padx=px(10))
        self.text = tk.Text(box, wrap="word", bg=c["list_bg"], fg=c["fg"], font=small, relief="flat", highlightthickness=0,
                            padx=px(8), pady=px(6), cursor="arrow", spacing1=px(2))
        bar = tk.Scrollbar(box, orient="vertical", command=self.text.yview)
        self.text.configure(yscrollcommand=bar.set, state="disabled")
        bar.pack(side="right", fill="y")
        self.text.pack(side="left", fill="both", expand=True)
        self.text.tag_configure("time", foreground=c["dim"])
        for kind, colour in COLOURS.items():
            self.text.tag_configure(kind, foreground=colour)
        self.size = None
        self._set_size(text_size[0]() if text_size else TEXT_SIZE)
        self.text.tag_configure("said", foreground=c["fg"])
        self.text.tag_configure("empty", foreground=c["dim"])

        self.page, self.shown, self.shown_changed = None, [], -1
        self.flash_left = 0
        self.show(page if page in self.tab_buttons else "Buddy")
        self.refresh()

    def _tab_menu(self, e, name):
        """A tab's right-click menu: open it in a new window."""
        c = self.colours
        menu = tk.Menu(self.win, tearoff=0, bg=c["list_bg"], fg=c["fg"], activebackground=c["accent"], activeforeground=c["bg"])
        menu.add_command(label=f"Open {name} in a new window", command=lambda: self.new_window(name, self))
        try:
            menu.tk_popup(e.x_root, e.y_root)
        finally:
            menu.grab_release()

    def _set_size(self, size):
        self.size = max(TEXT_SIZES[0], min(TEXT_SIZES[1], int(size or TEXT_SIZE)))
        self.text.configure(font=self.theme.font("regular", self.size))
        for kind in COLOURS:
            self.text.tag_configure(kind, font=self.theme.font("bold", self.size))
        for name, colour in BLOCKS.items():
            # (a speaker's channel, like its badge in the game: on its block's colour; and its name in that colour)
            self.text.tag_configure("badge_" + name, background=colour, foreground="#1c1c1c", font=self.theme.font("bold", max(9, self.size - 3)))
            self.text.tag_configure("block_" + name, foreground=colour, font=self.theme.font("bold", self.size))

    def resize_text(self, step):
        """A- / A+: the lines' text smaller or bigger (the window stays the size it is)."""
        self._set_size(self.size + step)
        if self.text_size:
            self.text_size[1](self.size)

    def exists(self):
        return bool(self.win.winfo_exists())

    def _moved(self, e):
        if e.widget is self.win and self.on_geometry:
            self.on_geometry(self.win.geometry())

    def show(self, name):
        self.page = name
        self.win.title(f"Chat - {name}")
        self.shown, self.shown_changed = None, -1
        if name == "Buddy":
            self.flash_left = 0
        self.draw()

    def _kinds(self, name):
        return dict(TABS).get(name) or tuple(k for _, ks in TABS for k in ks)

    def draw(self):
        log = self.get_log()
        lines = log.of(self._kinds(self.page))
        self.seen[self.page] = len(lines)
        for name, b in self.tab_buttons.items():
            n = len(log.of(self._kinds(name)))
            new = n - self.seen[name] if name != self.page else 0
            on = name == self.page
            lit = name == "Buddy" and self.flash_left % 2 == 1
            b.configure(text=f"{name} +{new}" if new > 0 and name != "All" else name,
                        fg=self.colours["bg"] if lit else self.colours["accent"] if on or (new > 0 and name == "Buddy") else self.colours["dim"],
                        bg=self.colours["accent"] if lit else self.colours["list_bg"] if on else self.colours["bg"])
        if self.shown is not None and log.changed == self.shown_changed:
            return
        numbers = [x.number for x in lines]
        at_end = self.text.yview()[1] >= 0.999
        self.text.configure(state="normal")
        if self.shown and numbers[:len(self.shown)] == self.shown and log.changed - self.shown_changed == len(numbers) - len(self.shown):
            for said in lines[len(self.shown):]:        # (only new lines, at the end: nothing to redo)
                self._line(said)
        else:
            self.text.delete("1.0", "end")
            if not lines:
                self.text.insert("end", self._empty(), "empty")
            for said in lines:
                self._line(said)
        self.text.configure(state="disabled")
        if at_end:
            self.text.see("end")
        self.shown, self.shown_changed = numbers, log.changed

    def _empty(self):
        return {"Buddy": "No buddy messages yet. They show here as they come, with the time they came."}.get(self.page, "Nothing yet.")

    def _line(self, said):
        if self.text.index("end-1c") != "1.0":
            self.text.insert("end", "\n")
        self.text.insert("end", clock_text(said.when) + "  ", "time")
        word = LABELS.get(said.kind)
        if word or self.page == "All":
            self.text.insert("end", f"{word or said.kind}  ", "time")
        block = said.block if said.block in BLOCKS else "grey"
        if said.kind == "speaker":
            self.text.insert("end", f" CH{said.channel or '??'} ", "badge_" + block)
            self.text.insert("end", "  ", "time")
        if said.who:
            self.text.insert("end", said.who, "block_" + block if said.kind == "speaker" else said.kind)
            self.text.insert("end", " : ", "time")
        self.text.insert("end", said.text, "said" if said.who else said.kind)

    def flash(self):
        """A new buddy message: the Buddy tab lights up a few times."""
        self.flash_left = FLASHES

    def refresh(self):
        if not self.win.winfo_exists():
            return
        if self.flash_left:
            self.flash_left -= 1
        self.status.set(self.get_status())
        self.draw()
        self.win.after(REFRESH_MS, self.refresh)
