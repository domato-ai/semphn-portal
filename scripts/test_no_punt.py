"""Verify the AI no longer punts/asks permission instead of drafting.

Targets the exact failure the user reported:
   "The data slice does not provide specific recommendations or measurable
    indicators to create a linked paragraph. However, I can assist you in
    drafting recommendations based on the data trends and issues identified
    in the HNA. Would you like to proceed with that?"

Each test prompt asks for a paragraph/recommendation. The reply must:
  • Contain a ```paragraph``` widget (HNA paragraph drafted)
  • NOT contain punt phrases (would you like, shall I, etc.)
  • NOT contain hedge phrases (data slice does not provide, etc.)
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.request
import urllib.error

from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _portal_host import portal_host  # noqa: E402

HOST = portal_host().rstrip("/")
ENDPOINT = HOST + "/api/chat"

TESTS = [
    (
        "01 · recommendations linked paragraph",
        "workbench-hna",
        "Draft a paragraph linking each recommendation to a measurable indicator. Heading: \"How we'll measure progress\".",
    ),
    (
        "02 · top 5 recommendations",
        "workbench-hna",
        "Draft the top 5 recommendations from this HNA, ranked by potential impact + actionability. Heading: \"Top 5 recommendations\".",
    ),
    (
        "03 · pre-flight summary",
        "workbench-hna",
        "Draft a one-paragraph summary of pre-flight check results. Heading: \"Pre-flight summary\".",
    ),
    (
        "04 · workforce paragraph",
        "workbench-hna",
        "Draft a paragraph on workforce pressure facing the 2 ACCHS in the catchment. Heading: \"Workforce · two ACCHS, stretched\". Use real figures.",
    ),
]

WIDGET_RE = re.compile(r"```widget\s*\n(.*?)\n```", re.DOTALL)
PUNT_RE = re.compile(
    r"(would you like (me )?to|shall i (proceed|draft|continue)|let me know if you('|')?d like|do you want me to|should i (draft|proceed))",
    re.IGNORECASE,
)
HEDGE_RE = re.compile(
    r"(data slice (does not|doesn't) provide|i don't have specific|insufficient data|data is limited)",
    re.IGNORECASE,
)


def call(step_slug: str, step_name: str, user_msg: str) -> dict:
    body = json.dumps({
        "step_slug": step_slug,
        "step_name": step_name,
        "messages": [{"role": "user", "content": user_msg}],
        "context_summary": "",
    }).encode("utf-8")
    req = urllib.request.Request(ENDPOINT, data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return {"status": r.status, "body": json.loads(r.read().decode("utf-8"))}
    except urllib.error.HTTPError as e:
        return {"status": e.code, "body": {"error": str(e)}}
    except Exception as e:
        return {"status": 0, "body": {"error": str(e)}}


def main():
    print(f"Testing punt detection · {ENDPOINT}\n")
    passed = failed = 0
    for label, slug, prompt in TESTS:
        out = call(slug, "HNA doc co-author", prompt)
        reply = (out.get("body") or {}).get("reply") or ""
        widgets = WIDGET_RE.findall(reply)
        punted = bool(PUNT_RE.search(reply))
        hedged = bool(HEDGE_RE.search(reply))
        has_paragraph = any('"type": "paragraph"' in w or '"type":"paragraph"' in w for w in widgets)
        ok = has_paragraph and not punted and not hedged
        status = "PASS" if ok else "FAIL"
        print(f"{status} {label}")
        print(f"     · widgets={len(widgets)} has_paragraph={has_paragraph} punted={punted} hedged={hedged}")
        if not ok:
            print(f"     reply[:280]={reply[:280]!r}")
        print()
        passed += int(ok); failed += int(not ok)
    print(f"\n=== {passed}/{passed+failed} passed ({failed} failed) ===")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
