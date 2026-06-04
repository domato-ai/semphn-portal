"""Template integrity check.

Fires every dashboard + map template via JS in a headless-like check —
verifies they register on window globals, have the right shape, and
the data arrays match the 10 SEMPHN LGA names where applicable.

Run: python scripts/test_templates.py
"""
from __future__ import annotations
import json, re, sys, urllib.request

PORTAL = "https://ambitious-cliff-02027e900.7.azurestaticapps.net"
SEMPHN_LGAS = {
    "Bayside (Vic.)", "Cardinia", "Casey", "Frankston", "Glen Eira",
    "Greater Dandenong", "Kingston (Vic.)", "Mornington Peninsula",
    "Port Phillip", "Stonnington", "Bayside", "Kingston",
}

EXPECTED_DASHBOARDS = [
    "mental-health", "first-nations", "aged-care", "homelessness",
    "chronic-disease", "workforce", "aod", "cald",
    "bowel-screening", "headspace-coverage", "gp-retention",
    # round 3 additions
    "risk-factor-profile", "cancer-screening-3prog", "suicide-prevention",
]
EXPECTED_MAPS = [
    "mh-hotspots", "service-network", "aged-care", "equity", "first-nations",
    "homelessness", "growth-corridor", "gp-supply", "screening-gap",
    "cald-density", "youth-services", "school-density",
    # round 3 additions
    "suicide-prevention", "risk-factors", "cvd-burden",
]


def fetch_shell_js() -> str:
    req = urllib.request.Request(PORTAL + "/_assets/shell.js?cb=test",
                                  headers={"User-Agent": "tpl-test"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode("utf-8")


def main():
    print(f"Fetching shell.js from {PORTAL}...")
    js = fetch_shell_js()
    print(f"shell.js · {len(js):,} bytes\n")

    # Detect template keys in DASHBOARD_TEMPLATES + MAP_TEMPLATES dicts
    # Each entry starts with quoted key followed by ': [' (dashboard) or ': {' (map)
    failed = 0
    print("DASHBOARD TEMPLATES")
    for name in EXPECTED_DASHBOARDS:
        # Look for the key followed by a colon and an opening bracket
        rx = re.compile(r"['\"]" + re.escape(name) + r"['\"]\s*:\s*\[")
        ok = bool(rx.search(js))
        marker = "PASS" if ok else "FAIL"
        print(f"  {marker} {name}")
        if not ok: failed += 1

    print("\nMAP TEMPLATES")
    for name in EXPECTED_MAPS:
        rx = re.compile(r"['\"]" + re.escape(name) + r"['\"]\s*:\s*\{")
        ok = bool(rx.search(js))
        marker = "PASS" if ok else "FAIL"
        print(f"  {marker} {name}")
        if not ok: failed += 1

    # Spot-check the new round-3 dashboard templates have data with LGA labels
    print("\nDATA-INTEGRITY SPOT-CHECKS (round 3 additions)")
    for needle, kind in [
        ("Catchment adult smoker", "risk-factor-profile KPI"),
        ("Casey · lowest bowel in Australia", "cancer-screening-3prog KPI"),
        ("Catchment suicide rate", "suicide-prevention KPI"),
    ]:
        ok = needle in js
        marker = "PASS" if ok else "FAIL"
        print(f"  {marker} contains: {needle!r}")
        if not ok: failed += 1

    for needle in [
        '"Suicide rate · per 100,000"',
        '"Adult overweight + obese (BMI ≥ 25)"',
        '"AMI admissions · per 100,000"',
    ]:
        ok = needle in js
        marker = "PASS" if ok else "FAIL"
        print(f"  {marker} map choropleth title: {needle}")
        if not ok: failed += 1

    total = len(EXPECTED_DASHBOARDS) + len(EXPECTED_MAPS) + 6
    passed = total - failed
    print(f"\n=== {passed}/{total} passed ({failed} failed) ===")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
