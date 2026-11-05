"""Screen-only guard: fail if code could touch the game client.

MapleLens may only capture pixels and draw its own window. This script flags
imports and Win32 calls that read/write process memory, capture network
traffic, or send input. It is a speed bump against honest mistakes, not a
security boundary.

Usage: python scripts/check_screen_only.py [PATH ...]
With no PATH, scans src/ and scripts/ of this repo, and its uv.lock for banned
packages (a PATH named uv.lock is checked that way too). Exits 2 on violations
(2 so a Claude Code hook feeds the report back to the model).
"""

import ast
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SELF = Path(__file__).resolve()

BANNED_MODULES = {
    "pymem",  # reads/writes process memory
    "frida",  # injects into processes
    "scapy",  # packet capture
    "pydivert",  # intercepts network traffic (WinDivert)
    "pyshark",  # packet capture
    "win32process",  # process handles / memory access
    "pywinauto",  # drives other apps' UI (sends input)
    "pyautogui",  # sends keys/clicks
    "pynput",  # sends keys/clicks
    "keyboard",  # sends keys / global hooks
    "mouse",  # sends clicks / global hooks
    "pydirectinput",  # sends keys/clicks to DirectX games
    "ahk",  # AutoHotkey bindings, sends input
    "interception",  # driver-level input
    "vgamepad",  # virtual controller input
    "ReadWriteMemory",  # reads/writes process memory
}

# Banned by dotted prefix: a package that is fine except for one namespace.
BANNED_PREFIXES = [
    "winrt.windows.ui.input",  # WinRT input, incl. its preview injection API (sends keys/clicks)
]
# The same namespace as a locked package (uv.lock spells it winrt-windows-ui-input...).
BANNED_LOCK_RE = re.compile(r'name\s*=\s*"(winrt[-_.]windows[-_.]ui[-_.]input[^"]*)"', re.I)

BANNED_WIN32 = [
    "ReadProcessMemory",  # reads game memory
    "WriteProcessMemory",  # writes game memory
    "OpenProcess",  # gets a handle to the game process
    "VirtualAllocEx",  # allocates memory in another process
    "CreateRemoteThread",  # code injection
    "SendInput",  # sends keys/clicks
    "SetWindowsHookEx",  # global input hooks
    "keybd_event",  # sends keys
    "mouse_event",  # sends clicks
    "PostMessage",  # sends input messages to the game window
    "SendMessage",  # sends input messages to the game window
    "SendMessageTimeout",  # same, with a timeout
    "SendMessageCallback",  # same, async
    "SendNotifyMessage",  # same, no wait
    "PostThreadMessage",  # sends input messages to the game thread
    "NtReadVirtualMemory",  # reads game memory (native API)
    "NtWriteVirtualMemory",  # writes game memory (native API)
    "DebugActiveProcess",  # attaches a debugger to the game
]

WIN32_RE = re.compile(r"\b(" + "|".join(BANNED_WIN32) + r")[AW]?\b")


def dynamic_import(node: ast.AST) -> str | None:
    """ "x" of __import__("x") or import_module("x") / importlib.import_module(name="x")."""
    if not isinstance(node, ast.Call):
        return None
    f = node.func
    name = f.id if isinstance(f, ast.Name) else f.attr if isinstance(f, ast.Attribute) else ""
    args = node.args[:1] + [k.value for k in node.keywords if k.arg == "name"]
    if name not in ("__import__", "import_module") or not args:
        return None
    arg = args[0]
    return arg.value if isinstance(arg, ast.Constant) and isinstance(arg.value, str) else None


def find_violations(path: Path) -> list[str]:
    # utf-8-sig: a BOM (common from Windows editors) would otherwise break ast.parse
    text = path.read_text(encoding="utf-8-sig", errors="replace")
    found = set()
    if path.name == "uv.lock":
        for lineno, line in enumerate(text.splitlines(), 1):
            for m in BANNED_LOCK_RE.finditer(line):
                found.add((lineno, f"banned package '{m.group(1)}'"))
        return [f"{path}:{lineno}: {msg}" for lineno, msg in sorted(found)]
    try:
        for node in ast.walk(ast.parse(text)):
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                # `from a.b import c` may import the module a.b.c
                names = [node.module] + [f"{node.module}.{a.name}" for a in node.names]
            elif dynamic_import(node):
                names = [dynamic_import(node)]
            else:
                continue
            for name in names:
                top = name.split(".")[0]
                if top in BANNED_MODULES:
                    found.add((node.lineno, f"banned import '{top}'"))
                for prefix in BANNED_PREFIXES:
                    if name == prefix or name.startswith(prefix + "."):
                        found.add((node.lineno, f"banned import '{prefix}'"))
    except SyntaxError:
        pass  # half-written file; the name check below still runs
    for lineno, line in enumerate(text.splitlines(), 1):
        for m in WIN32_RE.finditer(line):
            found.add((lineno, f"banned Win32 call '{m.group(1)}'"))
    return [f"{path}:{lineno}: {msg}" for lineno, msg in sorted(found)]


def iter_py_files(paths: list[Path]):
    for p in paths:
        files = sorted(p.rglob("*.py")) if p.is_dir() else [p]
        for f in files:
            if f.resolve() != SELF:
                yield f


def main(argv: list[str]) -> int:
    paths = [Path(a) for a in argv] or [REPO / "src", REPO / "scripts", REPO / "uv.lock"]
    violations = [v for f in iter_py_files(paths) for v in find_violations(f)]
    for v in violations:
        print(v, file=sys.stderr)
    if violations:
        print(f"screen-only guard: {len(violations)} violation(s)", file=sys.stderr)
        return 2
    print("screen-only guard: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
