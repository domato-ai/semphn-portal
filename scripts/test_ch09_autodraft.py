"""Verify the 3 Ch 09 (Chronic disease) auto-draft prompts that failed
for the user all now produce a `paragraph` widget.
"""
from __future__ import annotations
import json, os, re, sys, urllib.request, urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _portal_host import portal_host  # noqa: E402

HOST = portal_host().rstrip("/")
ENDPOINT = HOST + "/api/chat"

TESTS = [
    "Draft a deck paragraph on the chronic disease load in the SEMPHN catchment. Heading: \"Chronic disease · the productivity tax\".",
    "Draft a paragraph on Gr Dandenong as the catchment's diabetes hotspot. Heading: \"Gr Dandenong · 8.9% type 2 diabetes\".",
    "Draft a paragraph on avoidable hospital admissions as a primary-care performance signal. Heading: \"Avoidable admissions\".",
]

WIDGET_RE = re.compile(r"```widget\s*\n(.*?)\n```", re.DOTALL)


def call(prompt):
    body = json.dumps({
        "step_slug": "workbench-hna",
        "step_name": "HNA doc co-author",
        "messages": [{"role": "user", "content": prompt}],
        "context_summary": "",
    }).encode("utf-8")
    req = urllib.request.Request(ENDPOINT, data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception as e:
        return {"error": str(e)}


def main():
    print(f"Testing Ch 09 auto-draft prompts at {ENDPOINT}\n")
    passed = failed = 0
    for i, prompt in enumerate(TESTS, 1):
        res = call(prompt)
        reply = res.get("reply") or ""
        widgets = WIDGET_RE.findall(reply)
        para_ok = any('"type": "paragraph"' in w or '"type":"paragraph"' in w for w in widgets)
        status = "PASS" if para_ok else "FAIL"
        print(f"{status} prompt {i}: '{prompt[:60]}...'")
        print(f"     · widgets={len(widgets)} paragraph_widget={para_ok}")
        if not para_ok:
            print(f"     reply[:300]={reply[:300]!r}")
        print()
        passed += int(para_ok); failed += int(not para_ok)
    print(f"\n=== {passed}/{passed+failed} passed ===")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
