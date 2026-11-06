"""The main window tucking away and coming back, on a real window, and the game keeping the keyboard throughout. Windows
only. Run on its own: it opens a small window for a moment."""
import ctypes
import sys
import tkinter as tk
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from platforms.windows import WindowsPlatform  # noqa: E402

fails = 0


def check(name, ok, detail=""):
    global fails
    print(("ok  " if ok else "FAIL"), name, detail if not ok else "")
    fails += not ok


def settle(root, ms=250):
    done = tk.BooleanVar(value=False)
    root.after(ms, lambda: done.set(True))
    root.wait_variable(done)


def main():
    plat = WindowsPlatform()
    foreground = ctypes.windll.user32.GetForegroundWindow
    root = tk.Tk()
    root.title("tuck test")
    root.geometry("200x80+200+200")
    root.attributes("-topmost", True)
    # (Tk would take the keyboard as it first shows: the test's "other program" is whatever's in front after that.)
    settle(root, 500)
    place = root.winfo_x(), root.winfo_y()

    plat.tuck_window(root)
    settle(root)
    check("it tucks away", plat.window_tucked(root))
    check("tk knows", root.state() == "iconic", root.state())
    other = foreground()
    ours = plat.own_window_in_front()
    check("the keyboard went to another window", not ours)
    ticks = []
    root.after(50, lambda: ticks.append(1))         # the tracker's timers keep running while it's away
    settle(root)
    check("it keeps running", bool(ticks))

    plat.bring_window_back(root)
    settle(root)
    check("it comes back", not plat.window_tucked(root))
    check("tk knows that too", root.state() == "normal", root.state())
    check("in the same place", (root.winfo_x(), root.winfo_y()) == place, (root.winfo_x(), root.winfo_y(), place))
    check("and the keyboard stayed put", foreground() == other, (foreground(), other))

    plat.tuck_window(root)                          # now not in front: stays that way
    settle(root)
    check("tucks away from behind", plat.window_tucked(root))
    check("still leaves the keyboard alone", foreground() == other, (foreground(), other))
    plat.bring_window_back(root)
    settle(root)
    root.deiconify()
    root.destroy()
    print("FAILED" if fails else "All good")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
