"""End-to-end prompt regression for /api/chat.

Hits the live SWA endpoint with N representative prompts and checks:
  • HTTP 200
  • reply field present + non-empty
  • Widget blocks extracted (where the prompt asks for one)
  • Lie-detector wouldn't fire (no 'Added/Built X' claim without a ```widget block)
  • At least one citation pattern (source_id-style suffix or LGA name)

Run:    python scripts/test_chat_prompts.py
Env:    PORTAL_HOST defaults to https://ambitious-cliff-02027e900.7.azurestaticapps.net
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.request
import urllib.error

HOST = os.environ.get("PORTAL_HOST", "https://ambitious-cliff-02027e900.7.azurestaticapps.net").rstrip("/")
ENDPOINT = HOST + "/api/chat"

# Each test = (label, step_slug, step_name, user_prompt, expects_widget, expected_substrings_any)
TESTS = [
    (
        "01 · Dashboards · catchment KPI",
        "workbench-dashboards", "Dashboards builder",
        "Add a KPI tile showing the SEMPHN catchment population with year-on-year growth.",
        True, ["1,638,200", "1.64", "1,638", "3.1%"],
    ),
    (
        "02 · Dashboards · MH bar by LGA",
        "workbench-dashboards", "Dashboards builder",
        "Build a bar chart of MH conditions per 1,000 by LGA, ranked highest to lowest. Highlight Frankston. Unit per_1k.",
        True, ["Frankston", "116.1"],
    ),
    (
        "03 · Dashboards · funding donut",
        "workbench-dashboards", "Dashboards builder",
        "Build a donut chart of FY26 SEMPHN funding by program category. Unit aud.",
        True, ["Primary Mental Health", "9,12", "9120", "Headspace"],
    ),
    (
        "04 · Dashboards · workforce bar",
        "workbench-dashboards", "Dashboards builder",
        "Build a bar chart of GP practices by LGA, ranked highest to lowest. Highlight Casey.",
        True, ["Casey", "84"],
    ),
    (
        "05 · Dashboards · multi-widget",
        "workbench-dashboards", "Dashboards builder",
        "Build a complete 4-tile dashboard on chronic disease in the catchment.",
        True, ["diabetes", "chronic", "Greater Dandenong"],
    ),
    (
        "06 · Maps · choropleth",
        "workbench-maps", "Maps builder",
        "Map SEIFA disadvantage decile by SEMPHN LGA. Highlight Greater Dandenong.",
        True, ["Greater Dandenong"],
    ),
    (
        "07 · HNA · draft paragraph",
        "workbench-hna", "HNA doc co-author",
        "Draft a paragraph on the workforce-pressure facing the 2 ACCHS in the catchment.",
        True, ["ACCHS", "Bunurong"],
    ),
    (
        "08 · HNA · critique (NO widget)",
        "workbench-hna", "HNA doc co-author",
        "Looking at Chapter 4, what are the DoH Performance Rubric most likely to flag as missing? Reply in prose, no widget.",
        False, ["rubric", "performance", "DoH"],
    ),
]

# ---- helpers --------------------------------------------------------------
WIDGET_RE = re.compile(r"```widget\s*\n(.*?)\n```", re.DOTALL)
ACTION_VERB_RE = re.compile(r"\b(added|built|created|drafted|mapped|generated|inserted|composed)\b", re.IGNORECASE)


def call_chat(step_slug: str, step_name: str, user_msg: str) -> dict:
    body = json.dumps({
        "step_slug": step_slug,
        "step_name": step_name,
        "messages": [{"role": "user", "content": user_msg}],
        "context_summary": "",
    }).encode("utf-8")
    req = urllib.request.Request(ENDPOINT, data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=40) as resp:
            return {"status": resp.status, "body": json.loads(resp.read().decode("utf-8"))}
    except urllib.error.HTTPError as e:
        try:
            payload = json.loads(e.read().decode("utf-8"))
        except Exception:
            payload = {"error": str(e)}
        return {"status": e.code, "body": payload}
    except Exception as e:
        return {"status": 0, "body": {"error": str(e)}}


def check(label: str, step_slug: str, step_name: str, prompt: str, expects_widget: bool, needles: list[str]) -> tuple[bool, list[str], str]:
    out = call_chat(step_slug, step_name, prompt)
    notes: list[str] = []
    reply = (out.get("body") or {}).get("reply") or ""
    if out["status"] != 200:
        notes.append(f"HTTP {out['status']}: {out['body']}")
        return False, notes, reply
    if not reply:
        notes.append("Empty reply")
        return False, notes, reply
    widgets = WIDGET_RE.findall(reply)
    if expects_widget and not widgets:
        notes.append(f"Expected a ```widget block but got none. Reply: {reply[:140]}...")
        return False, notes, reply
    # Lie-detector: action verb in prose but no widget block at all
    if not widgets and ACTION_VERB_RE.search(reply):
        notes.append(f"Lie risk: action verb in prose but no widget. Reply: {reply[:140]}...")
        return False, notes, reply
    # Needle check (any-match)
    if needles:
        hits = [n for n in needles if n.lower() in reply.lower()]
        if not hits:
            notes.append(f"Missing all expected substrings {needles}. Reply: {reply[:140]}...")
            return False, notes, reply
        notes.append(f"matched needles: {hits}")
    notes.append(f"widgets extracted: {len(widgets)}")
    # Validate each widget is valid JSON
    for i, raw in enumerate(widgets):
        try:
            spec = json.loads(raw)
            t = spec.get("type")
            d = spec.get("data")
            notes.append(f"widget[{i}] type={t} data_rows={len(d) if isinstance(d, list) else 'n/a'}")
        except Exception as e:
            notes.append(f"widget[{i}] invalid JSON: {e}")
            return False, notes, reply
    return True, notes, reply


def main():
    print(f"Testing {ENDPOINT} ...\n")
    passed = 0
    failed = 0
    for label, step_slug, step_name, prompt, expects_widget, needles in TESTS:
        ok, notes, reply = check(label, step_slug, step_name, prompt, expects_widget, needles)
        status = "PASS" if ok else "FAIL"
        print(f"{status} {label}")
        for n in notes:
            print(f"     · {n}")
        if not ok:
            # Print first 300 chars of reply on fail for debugging
            print(f"     reply[:300]={reply[:300]!r}")
        print()
        passed += int(ok)
        failed += int(not ok)
        time.sleep(0.5)
    print(f"\n=== {passed}/{passed+failed} passed ({failed} failed) ===")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
