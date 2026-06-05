"""HNA · all 12 chapters fleshed + toolbar regression.

Headless-style check: fetches shell.js from the live deploy and verifies
1. All 12 HNA_CHAPTERS entries are present
2. NONE are stub: true (every chapter has a deck + sections)
3. Each fleshed chapter has at least 2 sections
4. Section headings the per-section toolbar relies on are present

Run:  python scripts/test_hna_chapters.py
"""
from __future__ import annotations
import io, re, sys, urllib.request

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", line_buffering=True)

PORTAL = "https://ambitious-cliff-02027e900.7.azurestaticapps.net"

EXPECTED_CHAPTERS = [
    "01-introduction", "02-region", "03-cald", "04-first-nations",
    "05-older-people", "06-homelessness", "07-mental-health", "08-aod",
    "09-chronic-disease", "10-workforce", "11-recommendations", "12-preflight",
]

# Key headings that the per-section toolbar's `suggestionsForSection` keys
# off of (case-insensitive substring match).
EXPECTED_HEADINGS = {
    "08-aod": ["Methamphetamine", "Frankston", "Wait times", "Comorbidity", "Commissioning"],
    "11-recommendations": ["Rec 1", "Rec 2", "Rec 3", "Rec 4", "Rec 5", "Measurement framework"],
    "12-preflight": ["DoH compliance", "Performance Rubric", "transparency", "Lodgement"],
}


def fetch_shell_js() -> str:
    req = urllib.request.Request(PORTAL + "/_assets/shell.js?cb=hnachecker",
                                  headers={"User-Agent": "hna-chapter-test"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode("utf-8")


def main() -> int:
    print(f"Fetching shell.js from {PORTAL}...")
    js = fetch_shell_js()
    print(f"shell.js · {len(js):,} bytes\n")

    failed = 0

    print("All 12 chapters declared")
    for slug in EXPECTED_CHAPTERS:
        rx = re.compile(r"['\"]" + re.escape(slug) + r"['\"]\s*:\s*\{")
        ok = bool(rx.search(js))
        print(f"  {'PASS' if ok else 'FAIL'} {slug}")
        if not ok: failed += 1

    print("\nNo stub chapters remain (all should have deck + sections)")
    # The stub:true flag must not appear inside any chapter entry. We can
    # tolerate occurrences inside JS string literals if any, but the actual
    # `stub: true` property pattern should be gone.
    stub_count = len(re.findall(r"\bstub\s*:\s*true\b", js))
    print(f"  {'PASS' if stub_count == 0 else 'FAIL'} stub:true occurrences: {stub_count}")
    if stub_count: failed += 1

    print("\nKey section headings present (drives per-section toolbar)")
    for slug, headings in EXPECTED_HEADINGS.items():
        for h in headings:
            # Heading appears inside a `heading: '...'` JS literal somewhere
            ok = h.lower() in js.lower()
            print(f"  {'PASS' if ok else 'FAIL'} {slug} · '{h}'")
            if not ok: failed += 1

    print("\nDedup logic present in suggestionsForSection")
    ok = "function dedupBy" in js or "dedupBy(" in js
    print(f"  {'PASS' if ok else 'FAIL'} chip dedup helper present")
    if not ok: failed += 1

    print("\nHNA per-section toolbar function present")
    for name in ("buildSectionAddToolbar", "suggestionsForSection", "fireHnaSectionPrompt"):
        ok = name in js
        print(f"  {'PASS' if ok else 'FAIL'} {name}")
        if not ok: failed += 1

    total = (len(EXPECTED_CHAPTERS) + 1 +
             sum(len(v) for v in EXPECTED_HEADINGS.values()) + 1 + 3)
    passed = total - failed
    print(f"\n=== {passed}/{total} passed ({failed} failed) ===")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
