"""The Items window: what's picked up in a run, shown in a real window. Run it:  python tests/test_items_window.py"""
import sys
import tkinter as tk
from pathlib import Path
from tkinter import font as tkfont
from types import SimpleNamespace as NS

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from ui_items import ItemsWindow, RunItems  # noqa: E402

failures = 0


def check(name, ok, detail=""):
    global failures
    print(("PASS " if ok else "FAIL ") + name + (f"   {detail}" if detail and not ok else ""))
    failures += not ok


run = RunItems()
check("nothing yet", run.rows() == [])
run.picked([("item", "Firewood", 1, "Etc"), ("mesos", 40), ("item", "Orange Potion", 2, "Use")])
check("items are listed, the latest first", run.rows() == [("Orange Potion", 2, "Use"), ("Firewood", 1, "Etc")], run.rows())
run.picked([("item", "Firewood", 3, "Etc"), ("exp", 46), ("unread",)])
check("the same item adds up, and comes back to the top", run.rows()[0] == ("Firewood", 4, "Etc"), run.rows())
check("EXP lines aren't items", len(run.rows()) == 2)
text = run.summary()
check("the totals", "6 items" in text and "2 kinds" in text and "40 mesos" in text, text)
check("lines it couldn't read are said", "1 lines" in text or "1 line" in text, text)
run2 = RunItems()
run2.picked([("item", "firewood", 1, "Etc"), ("item", "Firewood", 1, "Etc")])
check("a name's case doesn't make it another item", len(run2.rows()) == 1 and run2.rows()[0][1] == 2, run2.rows())
run2.clear()
check("Reset clears it", not run2.rows() and not run2.mesos and not run2.unread)

root = tk.Tk()
root.withdraw()
theme = NS(px=lambda n: n, font=lambda weight, size: tkfont.Font(root=root, family="Segoe UI", size=-size))
colours = dict(bg="#101317", fg="#e8eaed", dim="#8a919b", list_bg="#181c21", select="#2a3038", accent="#6ad0ff")
reading = ["Reading, last 5 minutes: EXP 96%"]
w = ItemsWindow(root, theme, colours, lambda: run, lambda: reading[0], at=(-4000, -4000))     # (off the screen: nothing to get in the way)
root.update()
check("it shows with the main window minimized", w.win.winfo_ismapped())
shown = [w.tree.item(i, "values") for i in w.tree.get_children()]
check("the window lists them", [s[0] for s in shown] == ["Firewood", "Orange Potion"] and shown[0][1] == "4", shown)
check("it opens on Items", w.page == "Items")
w.show("Reading")
root.update()
check("the Reading tab says how it's going", "EXP 96%" in w.reading.get("1.0", "end"), w.reading.get("1.0", "end"))
check("only one tab shows", w.pages["Reading"].winfo_manager() and not w.pages["Items"].winfo_manager())
w.show("Items")
run.picked([("item", "Leather", 1, "Etc")])
w.refresh()
root.update()
check("new pickups show as they come", w.tree.item(w.tree.get_children()[0], "values")[0] == "Leather")
run.picked([("item", "Green Pants", 1, "Equip"), ("item", "Odd Thing", 2, "Cash")])
w.refresh()
root.update()
check("All shows everything", len(w.tree.get_children()) == 5, w.tree.get_children())
for kind, want in (("Etc", {"Firewood", "Leather"}), ("Use", {"Orange Potion"}), ("Equip", {"Green Pants"}), ("Other", {"Odd Thing"}), ("Setup", set())):
    w.show_kind(kind)
    root.update()
    check(f"the {kind} group", {w.tree.item(i, "values")[0] for i in w.tree.get_children()} == want, [w.tree.item(i, "values") for i in w.tree.get_children()])
check("each says how many", w.kind_buttons["Etc"][0].cget("text") == "Etc 2", w.kind_buttons["Etc"][0].cget("text"))
w.show_kind("Etc")
run.picked([("item", "Leaf", 3, "Etc"), ("item", "Blue Potion", 1, "Use")])
w.refresh()
root.update()
check("a group stays chosen as new things come in", len(w.tree.get_children()) == 3 and w.kind == "Etc", w.tree.get_children())
w.show_kind("All")
w.win.destroy()
root.update()
check("closing it is fine", not w.exists())
w.refresh()                     # (a refresh that was waiting when it closed)
check("and nothing's lost by closing", len(run.rows()) == 7, run.rows())
root.destroy()

print(f"\n{failures} failed" if failures else "\nAll passed")
sys.exit(1 if failures else 0)
