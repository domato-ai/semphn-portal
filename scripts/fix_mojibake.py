"""Fix double-encoded mojibake in the site HTML files.

PowerShell's `Get-Content -Raw | -replace | Set-Content -Encoding UTF8`
loop without `-Encoding UTF8` on the READ side re-encodes the UTF-8 bytes
as if they were Latin-1, then writes them back as UTF-8 — doubling the
encoding each pass.

This script reverses that.

Run:  python scripts/fix_mojibake.py
"""
from __future__ import annotations
import sys
from pathlib import Path

# Order matters · the 3-char patterns starting with the 'a-circumflex + euro'
# prefix must come BEFORE the standalone ('a-circumflex + euro') → '"' rule,
# otherwise the trailing byte of each sequence ends up paired with a stray
# fallback character. Earlier runs already produced some of those bad pairs
# (e.g. '”¹', '”º') so we also clean them up explicitly.
#
# Pairs are listed as (source mojibake, intended Unicode codepoint).
REPLACEMENTS = [
    # Command key (U+2318)
    ("âŒ˜", "⌘"),
    # Earlier-run double-corruption fixups
    ("”¹", "‹"),  # was '‹' (single left angle)
    ("”º", "›"),  # was '›' (single right angle)
    ("”š", "‚"),  # was '‚' (low-9 single)
    ("”ž", "„"),  # was '„' (low-9 double)
    # 3-byte \xE2\x80\xB9..\xBA range
    ("â€¹", "‹"),
    ("â€º", "›"),
    ("â€š", "‚"),
    ("â€ž", "„"),
    # em-dash (U+2014)
    ("â€”", "—"),
    # en-dash (U+2013)
    ("â€“", "–"),
    # ellipsis (U+2026)
    ("â€¦", "…"),
    # right arrow (U+2192)
    ("â†’", "→"),
    # check mark (U+2713)
    ("âœ“", "✓"),
    # circle U+25D0
    ("â—", "◐"),
    # down triangle U+25BE
    ("â–¾", "▾"),
    # multiplication sign U+00D7
    ("Ã—", "×"),
    # right single quote (U+2019)
    ("â€™", "’"),
    # left double quote (U+201C)
    ("â€œ", "“"),
    # right double quote (U+201D) — this one is the greedy generic
    ("â€", "”"),
    # middle dot (U+00B7)
    ("Â·", "·"),
    # degree
    ("Â°", "°"),
    # left/right guillemet
    ("Â«", "«"),
    ("Â»", "»"),
    # standalone 'Â' — last pass
    ("Â", ""),
]

FILES = [
    "site/hna/index.html",
    "site/dashboards/index.html",
    "site/maps/index.html",
    "site/signin/index.html",
    "site/build/index.html",
]


def fix(path: Path) -> bool:
    raw = path.read_text(encoding="utf-8")
    fixed = raw
    for src, dst in REPLACEMENTS:
        fixed = fixed.replace(src, dst)
    if fixed != raw:
        path.write_bytes(fixed.encode("utf-8"))
        return True
    return False


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    changed = 0
    for rel in FILES:
        path = root / rel
        if not path.exists():
            print(f"  - skip (missing): {rel}")
            continue
        if fix(path):
            changed += 1
            print(f"  - fixed:   {rel}")
        else:
            print(f"  - clean:   {rel}")
    print(f"\n{changed} file(s) updated.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
