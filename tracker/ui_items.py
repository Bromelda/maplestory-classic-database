"""The Items window: what you've picked up this run, and how the reading's going.

Two tabs. Items lists every item whose pickup line was read since the tracker opened (or Reset), with how many and which
inventory tab, newest pickups first. Reading says how much of the lines it's catching, and what's been learned so far.
It's only a window on what the tracker already knows: closing it changes nothing.
"""
import tkinter as tk
from tkinter import ttk

REFRESH_MS = 1000


class RunItems:
    """What's been picked up this run."""

    def __init__(self):
        self.clear()

    def clear(self):
        self.items = {}             # lower-case name -> [name, how many, tab, which pickup it was last]
        self.mesos = 0
        self.unread = 0             # white lines that couldn't be read
        self.turn = 0

    def picked(self, found):
        """New lines read: ("mesos", amount), ("item", name, how many, tab), ("unread",). Anything else is left alone."""
        for p in found:
            if p[0] == "mesos":
                self.mesos += p[1]
            elif p[0] == "unread":
                self.unread += 1
            elif p[0] == "item":
                self.turn += 1
                got = self.items.setdefault(p[1].lower(), [p[1], 0, p[3], 0])
                got[1] += p[2]
                got[3] = self.turn

    def rows(self):
        """[(name, how many, tab)], the latest picked up first."""
        return [(n, q, t) for n, q, t, _ in sorted(self.items.values(), key=lambda it: -it[3])]

    def summary(self):
        kinds, total = len(self.items), sum(it[1] for it in self.items.values())
        text = f"{total:,} items, {kinds:,} kinds, {self.mesos:,} mesos picked up"
        if self.unread:
            text += f". {self.unread:,} {'line' if self.unread == 1 else 'lines'} couldn't be read, so {'it isn' if self.unread == 1 else 'they aren'}'t in here"
        return text


class ItemsWindow:
    """get_items: a RunItems. get_reading: the Reading tab's text. colours: bg, fg, dim, list_bg, select, accent."""

    def __init__(self, root, theme, colours, get_items, get_reading, topmost=False, at=None, style_window=None):
        self.get_items, self.get_reading = get_items, get_reading
        self.colours = c = colours
        px = theme.px
        w = self.win = tk.Toplevel(root)
        w.title("Items")
        w.configure(bg=c["bg"])
        # (Not tied to the main window: that's often minimized, and this would go with it.)
        w.attributes("-topmost", bool(topmost))
        w.geometry(f"{px(420)}x{px(460)}" + (f"+{at[0]}+{at[1]}" if at else ""))
        w.minsize(px(300), px(240))
        w.bind("<Escape>", lambda e: w.destroy())
        if style_window:
            for delay in (0, 150, 800):
                w.after(delay, lambda: style_window(w) if w.winfo_exists() else None)
        text, small = theme.font("semibold", 12), theme.font("regular", 11)

        tabs = tk.Frame(w, bg=c["bg"])
        tabs.pack(fill="x", padx=px(14), pady=(px(12), px(8)))
        self.tab_buttons, self.pages = {}, {}
        for name in ("Items", "Reading"):
            b = tk.Label(tabs, text=name, bg=c["bg"], fg=c["dim"], font=text, padx=px(10), pady=px(5), cursor="hand2")
            b.pack(side="left", padx=(0, px(4)))
            b.bind("<Button-1>", lambda e, n=name: self.show(n))
            self.tab_buttons[name] = b

        page = self.pages["Items"] = tk.Frame(w, bg=c["bg"])
        self.summary = tk.StringVar()
        self.summary_label = tk.Label(page, textvariable=self.summary, bg=c["bg"], fg=c["dim"], font=small, justify="left", anchor="w")
        self.summary_label.pack(fill="x", pady=(0, px(6)))
        page.bind("<Configure>", lambda e: self.summary_label.configure(wraplength=max(120, e.width - 8)))
        style = ttk.Style(w)
        style.theme_use("clam")         # (the only one that takes these colours everywhere: the log's table uses it too)
        style.layout("Items.Treeview", [("Treeview.treearea", {"sticky": "nswe"})])
        style.configure("Items.Treeview", background=c["list_bg"], fieldbackground=c["list_bg"], foreground=c["fg"], font=small,
                        rowheight=int(small.metrics("linespace") * 1.7), borderwidth=0)
        style.configure("Items.Treeview.Heading", background=c["bg"], foreground=c["dim"], relief="flat", borderwidth=0, font=small)
        style.map("Items.Treeview", background=[("selected", c["select"])], foreground=[("selected", c["accent"])])
        style.map("Items.Treeview.Heading", background=[("active", c["bg"])])
        box = tk.Frame(page, bg=c["bg"])
        box.pack(fill="both", expand=True)
        self.tree = ttk.Treeview(box, columns=("item", "qty", "tab"), show="headings", style="Items.Treeview", selectmode="none")
        for key, title, width, anchor, stretch in (("item", "Item", px(250), "w", True), ("qty", "How many", px(70), "e", False),
                                                   ("tab", "Tab", px(60), "center", False)):
            self.tree.heading(key, text=title, anchor=anchor)
            self.tree.column(key, width=width, anchor=anchor, stretch=stretch)
        bar = ttk.Scrollbar(box, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=bar.set)
        self.tree.pack(side="left", fill="both", expand=True)
        bar.pack(side="right", fill="y")

        page = self.pages["Reading"] = tk.Frame(w, bg=c["bg"])
        self.reading = tk.Text(page, wrap="word", bg=c["bg"], fg=c["fg"], font=small, relief="flat", highlightthickness=0,
                               padx=px(2), pady=px(2), cursor="arrow")
        self.reading.pack(fill="both", expand=True)
        self.reading.configure(state="disabled")

        self.pad = px(14)
        self.shown_rows = None
        self.shown_text = None
        self.page = None
        self.show("Items")
        self.refresh()

    def exists(self):
        return bool(self.win.winfo_exists())

    def lift(self):
        self.win.deiconify()
        self.win.lift()

    def show(self, name):
        if self.page:
            self.pages[self.page].pack_forget()
        self.page = name
        self.pages[name].pack(fill="both", expand=True, padx=self.pad, pady=(0, self.pad))
        for n, b in self.tab_buttons.items():
            on = n == name
            b.configure(fg=self.colours["accent"] if on else self.colours["dim"], bg=self.colours["list_bg"] if on else self.colours["bg"])

    def refresh(self):
        if not self.win.winfo_exists():
            return
        items = self.get_items()
        rows = items.rows()
        self.summary.set(items.summary() if rows or items.mesos or items.unread else "Nothing yet. What you pick up shows here as you play.")
        if rows != self.shown_rows:
            self.shown_rows = rows
            self.tree.delete(*self.tree.get_children())
            for name, qty, tab in rows:
                self.tree.insert("", "end", values=(name, f"{qty:,}", tab))
        text = self.get_reading()
        if text != self.shown_text:
            self.shown_text = text
            self.reading.configure(state="normal")
            self.reading.delete("1.0", "end")
            self.reading.insert("1.0", text)
            self.reading.configure(state="disabled")
        self.win.after(REFRESH_MS, self.refresh)
