"""A window whose contents don't fit scrolls, and one whose contents do fit doesn't.

Run it:  python tests/test_scrollbody.py"""
import sys
import tkinter as tk
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scrollbody import scrolling_body  # noqa: E402

failures = 0


def check(name, ok, detail=""):
    global failures
    print(("PASS " if ok else "FAIL ") + name + (f"   {detail}" if detail and not ok else ""))
    failures += not ok


root = tk.Tk()
root.withdraw()


def window(rows, most=300):
    w = tk.Toplevel(root)
    w.withdraw()
    foot = tk.Frame(w, height=40)
    foot.pack(side="bottom", fill="x")
    body = scrolling_body(w, "black", most, padx=10, pady=10)
    for k in range(rows):
        tk.Label(body, text=f"Row {k}", height=2).pack(anchor="w")
    w.update()
    w.update()
    return w, body


tall, body = window(60)
canvas = next(c for c in tall.winfo_children() if isinstance(c, tk.Canvas))
check("contents taller than the room: the window stops there", tall.winfo_reqheight() <= 300 + 40, tall.winfo_reqheight())
check("all of it can be scrolled to", int(canvas.cget("scrollregion").split()[3]) > 300, canvas.cget("scrollregion"))
check("there's a scrollbar", any(c.winfo_manager() == "pack" and c.winfo_class() == "TScrollbar" for c in tall.winfo_children()))
canvas.yview_moveto(1.0)
check("it scrolls", canvas.yview()[0] > 0, canvas.yview())

small, body = window(3)
canvas = next(c for c in small.winfo_children() if isinstance(c, tk.Canvas))
check("contents that fit: the window's their size", int(canvas.cget("height")) < 300, canvas.cget("height"))
check("and no scrollbar", not any(c.winfo_manager() == "pack" and c.winfo_class() == "TScrollbar" for c in small.winfo_children()))
root.destroy()

print(f"\n{failures} failed" if failures else "\nAll passed")
sys.exit(1 if failures else 0)
