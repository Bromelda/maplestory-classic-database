"""What the overlay needs from the operating system, as one interface (Platform) that each
OS implements: finding the game window, where windows are, screen scaling, hotkeys, and a
few odds and ends. The rest of the overlay is the same everywhere: it takes screenshots with
mss (which works on every OS) and reads them.

Rectangles are (left, top, width, height) in the units mss screenshots use: physical pixels
on Windows, points on macOS. A window handle is whatever the OS uses to name a window."""
from abc import ABC, abstractmethod


# --------------------------------------------------------------------------- hotkey names
#
# A hotkey is written like "Shift+1" in the settings file and the Settings window, and kept
# as (modifiers, key) in Windows' codes: what RegisterHotKey takes, and what tkinter's
# keycode is on Windows.

HOTKEY_MODS = {"Ctrl": 0x2, "Alt": 0x1, "Shift": 0x4}           # MOD_CONTROL, MOD_ALT, MOD_SHIFT


_OTHER_KEYS = {0x21: "PageUp", 0x22: "PageDown", 0x23: "End", 0x24: "Home", 0x2D: "Insert", 0xBA: ";", 0xBB: "=", 0xBC: ",",
               0xBD: "-", 0xBE: ".", 0xBF: "/", 0xC0: "`", 0xDB: "[", 0xDC: "\\", 0xDD: "]", 0xDE: "'"}
_ALL_VKS = [*range(0x21, 0x25), 0x2D, *range(0x30, 0x3A), *range(0x41, 0x5B), *range(0x60, 0x6A), *range(0x70, 0x7C),
            *range(0xBA, 0xC1), *range(0xDB, 0xDF)]


def _key_name(vk):
    if 0x30 <= vk <= 0x39 or 0x41 <= vk <= 0x5A:
        return chr(vk)
    if 0x60 <= vk <= 0x69:
        return f"Num{vk - 0x60}"
    if 0x70 <= vk <= 0x7B:
        return f"F{vk - 0x6F}"
    return _OTHER_KEYS.get(vk)


def parse_hotkey(text):
    """'Shift+1' or '0' -> (modifiers, virtual key), or None if it isn't a hotkey the overlay takes: a number, letter, F key,
    number pad key, punctuation, or Insert, Home, End, PageUp or PageDown, with or without Ctrl, Alt or Shift. The game doesn't
    get a hotkey while it's on, so a plain key can't be typed in chat: that's for whoever chooses it to weigh up."""
    if not isinstance(text, str) or not text:
        return None
    *mods, key = text.split("+")
    if len(set(mods)) != len(mods) or any(m not in HOTKEY_MODS for m in mods):
        return None
    vk = next((v for v in _ALL_VKS if _key_name(v) == key), None)
    if vk is None:
        return None
    return sum(HOTKEY_MODS[m] for m in mods), vk


def typing_key(vk):
    """Would this key, with no Ctrl, Alt or Shift, be typed into a box in the game (a number, letter or punctuation)?"""
    return 0x30 <= vk <= 0x39 or 0x41 <= vk <= 0x5A or 0x60 <= vk <= 0x69 or 0xBA <= vk <= 0xC0 or 0xDB <= vk <= 0xDE


def to_register(wanted, held=False):
    """What to ask the OS for, from {action: (modifiers, key)}: [(action, modifiers, key, must have)]. A plain key is also
    asked for with Shift, or it wouldn't fire while Shift's held down to attack. held: a box in the game is waiting for typing,
    so plain typing keys are left alone."""
    keys = {a: k for a, k in wanted.items() if not (held and not k[0] and typing_key(k[1]))}
    out = [(a, m, vk, True) for a, (m, vk) in keys.items()]
    taken = set(wanted.values())
    out += [(a, HOTKEY_MODS["Shift"], vk, False) for a, (m, vk) in keys.items() if not m and (HOTKEY_MODS["Shift"], vk) not in taken]
    return out


def hotkey_text(ctrl, alt, shift, vk):
    """The name of a key pressed with these modifiers (e.g. 'Shift+1'), or None if it can't be one."""
    key = _key_name(vk)
    text = "+".join([m for m, on in (("Ctrl", ctrl), ("Alt", alt), ("Shift", shift)) if on] + [key or "?"])
    return text if key and parse_hotkey(text) else None


# --------------------------------------------------------------------------- interfaces

class Hotkeys(ABC):
    """Keys that work while MapleStory or the overlay is in front. on_press(action) is called
    (from any thread) for each press."""

    supported = True                        # False: Settings says so instead of offering them

    def __init__(self, on_press):
        self.on_press = on_press
        self.problems = {}                  # action -> why it couldn't be used (e.g. taken)

    @abstractmethod
    def set(self, keys, on=True):
        """keys: action -> 'Shift+1' (or '' for off)."""

    @abstractmethod
    def pause(self, paused):
        """Off for a moment (e.g. while a new hotkey is being chosen), then back on."""

    def hold(self, held):
        """While a box in the game is waiting for typing (a shop's "how many"), plain typing keys go to the game."""


class Platform(ABC):
    """One OS. create_platform() picks the one the overlay is running on."""

    name = "?"

    def setup_process(self):
        """Called once at start, before any window or screenshot."""

    @abstractmethod
    def version(self):
        """The OS and its version, for bug reports (e.g. 'Windows 10.0.22631')."""

    @abstractmethod
    def data_root(self):
        """The folder the settings folder goes in, as a Path."""

    @abstractmethod
    def tesseract_candidates(self, home_dir, app_dir):
        """Where to look for Tesseract, best first. Never the current folder."""

    @abstractmethod
    def claim_single_instance(self, key, title, old_titles=()):
        """Makes this the only copy running for `key` (one per data folder). If another copy
        already is, shows it (or says so) and returns False."""

    def ask_permissions(self):
        """Asks for anything the OS makes the user allow before the screen can be read."""

    def missing_permission(self):
        """Why other programs' windows can't be seen right now, or None if they can."""
        return None

    @abstractmethod
    def find_game_window(self):
        """Handle of the MapleStory game window (the biggest, if there are several), or None."""

    @abstractmethod
    def window_exists(self, handle):
        """Is that window still there (even if minimized)?"""

    @abstractmethod
    def client_rect(self, handle):
        """The game area of the window on screen, or None (also when it's minimized)."""

    @abstractmethod
    def own_window_rect(self, root):
        """The overlay's own window on screen, frame included, from its tkinter root; or None."""

    @abstractmethod
    def screen_dpi(self, x, y):
        """The DPI to size text for on the screen at (x, y), or None if unknown."""

    @abstractmethod
    def create_hotkeys(self, on_press):
        """A Hotkeys for this OS."""

    @abstractmethod
    def open_folder(self, path):
        """Shows the folder in the OS's file browser."""

    @abstractmethod
    def show_file(self, path):
        """Opens the file's folder in the OS's file browser, with the file selected."""

    def dpi_awareness(self):
        """How this program handles screen scaling, in words, for bug reports (None if n/a)."""
        return None

    def font(self, family, weight):
        """(family, weight) to use for one of the overlay's fonts, named by its Windows font."""
        return family, weight

    def register_fonts(self, paths):
        """Makes the font files available to this program only (not installed). True if all worked."""
        return False

    def style_window(self, root, background, text):
        """Makes the window's frame match the overlay's colours where the OS allows it
        (the title bar), given as '#rrggbb'. Does nothing where it can't."""

    def make_overlay(self, window):
        """Makes a borderless tkinter window drawn over the game click-through, kept off the taskbar, and
        left out of screenshots (so the screen reader sees the game under it). Does nothing where it can't."""

    def set_click_through(self, window, on):
        """Lets clicks on a make_overlay window go through to the game (on), or reach the window (off)."""

    def paint_overlay(self, window, image, x, y):
        """Puts a picture with see-through parts (Pillow RGBA) in a make_overlay window at (x, y), pixel by
        pixel. False where the OS can't: the picture is then shown flat (and the window faded as a whole)."""
        return False

    def show_overlay(self, window, visible, rect=None):
        """Shows (on top, at rect (x, y, w, h) if given) or hides a window made with make_overlay, without
        taking focus from the game."""
        if visible:
            if rect:
                window.geometry("{2}x{3}+{0}+{1}".format(*rect))
            window.deiconify()
            window.lift()
        else:
            window.withdraw()

    def tuck_window(self, root):
        """Minimizes the main window to the taskbar, without leaving the game's keys going nowhere."""
        root.iconify()

    def bring_window_back(self, root):
        """Shows the main window again where it was, without taking the keyboard away from the game."""
        root.deiconify()

    def window_tucked(self, root):
        return root.state() == "iconic"

    def own_window_in_front(self):
        """Is one of this program's own windows the one in front? False where that can't be told."""
        return False

    def game_in_front(self):
        """Is MapleStory (or this overlay) the window in front? True where that can't be told."""
        return True
