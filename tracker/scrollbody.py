"""A window's contents in a part that scrolls when they're taller than the screen has room for."""
import tkinter as tk
from tkinter import ttk


def scrolling_body(win, bg, most, padx=0, pady=0, style=None):
    """A frame to fill, inside win. win's height stops at `most` pixels; past that, the frame scrolls."""
    canvas = tk.Canvas(win, bg=bg, highlightthickness=0, bd=0)
    bar = ttk.Scrollbar(win, orient="vertical", command=canvas.yview, **({"style": style} if style else {}))
    canvas.configure(yscrollcommand=bar.set)
    canvas.pack(side="left", fill="both", expand=True)
    holder = tk.Frame(canvas, bg=bg)
    canvas.create_window((0, 0), window=holder, anchor="nw")
    body = tk.Frame(holder, bg=bg)
    body.pack(padx=padx, pady=pady)

    def fit(_=None):
        w, h = holder.winfo_reqwidth(), holder.winfo_reqheight()
        canvas.configure(width=w, height=min(h, most), scrollregion=(0, 0, w, h))
        if h > most:
            if not bar.winfo_ismapped():
                bar.pack(side="right", fill="y", before=canvas)
        else:
            bar.pack_forget()

    holder.bind("<Configure>", fit)
    win.bind("<MouseWheel>", lambda e: canvas.yview_scroll(-1 if e.delta > 0 else 1, "units"), add="+")
    canvas.configure(yscrollincrement=max(1, most // 20))
    return body
