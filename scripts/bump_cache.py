"""Bump the ?v= cache buster on shell.css / shell.js references.

Always use this — NEVER PowerShell's Get-Content | Set-Content — because
PS reads as cp1252 by default and writes UTF-8, doubling encoded mojibake.

Run:  python scripts/bump_cache.py <new-version>
      python scripts/bump_cache.py        # auto-bumps by +1
"""
from __future__ import annotations
import re
import sys
from pathlib import Path

FILES = [
    "site/hna/index.html",
    "site/dashboards/index.html",
    "site/maps/index.html",
]

PAT_CSS = re.compile(r"shell\.css\?v=(\d+)")
PAT_JS  = re.compile(r"shell\.js\?v=(\d+)")


def current_version(root: Path) -> int:
    versions = []
    for rel in FILES:
        path = root / rel
        if not path.exists():
            continue
        raw = path.read_text(encoding="utf-8")
        for m in PAT_CSS.finditer(raw):
            versions.append(int(m.group(1)))
        for m in PAT_JS.finditer(raw):
            versions.append(int(m.group(1)))
    return max(versions) if versions else 1700000000


def bump(root: Path, new_v: int) -> int:
    new_s = str(new_v)
    changed = 0
    for rel in FILES:
        path = root / rel
        if not path.exists():
            print(f"  - skip (missing): {rel}")
            continue
        raw = path.read_text(encoding="utf-8")
        new = PAT_CSS.sub("shell.css?v=" + new_s, raw)
        new = PAT_JS.sub("shell.js?v=" + new_s, new)
        if new != raw:
            path.write_bytes(new.encode("utf-8"))
            changed += 1
            print(f"  - bumped:  {rel}")
        else:
            print(f"  - clean:   {rel}")
    return changed


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    if len(sys.argv) > 1:
        new_v = int(sys.argv[1])
    else:
        new_v = current_version(root) + 1
    print(f"Bumping cache version to v={new_v}\n")
    changed = bump(root, new_v)
    print(f"\n{changed} file(s) updated to v={new_v}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
