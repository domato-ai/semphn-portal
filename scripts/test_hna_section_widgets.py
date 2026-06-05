"""HNA · per-section chart + map regression.

Verifies that the SEMPHN HNA workbench accepts section-specific prompts and
emits valid widget blocks (bar / choropleth) for the chapters where the
inline "Add to this section" toolbar surfaces them.

This hits the LIVE /api/chat endpoint with step_slug=workbench-hna so the
backend uses the HNA system prompt (paragraph + widget fenced blocks).

Run:  python scripts/test_hna_section_widgets.py
"""
from __future__ import annotations
import io, json, re, sys, urllib.request, urllib.error

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", line_buffering=True)

PORTAL = "https://ambitious-cliff-02027e900.7.azurestaticapps.net"
CHAT_URL = PORTAL + "/api/chat"

# Each test mirrors a real "Add to this section" chip click.
# (section_topic, chapter_slug, chapter_name, prompt, expected_widget_type[, must_contain_label])
CASES = [
    (
        "Frankston · MH conditions bar",
        "07-mental-health",
        "Mental health",
        "Add a bar chart of MH conditions per 1,000 residents by SEMPHN LGA — ranked highest to lowest. Highlight Frankston (116.1).",
        "bar",
        "Frankston",
    ),
    (
        "Suicide rate bar",
        "07-mental-health",
        "Mental health",
        "Add a bar chart of suicide rate per 100,000 by SEMPHN LGA — ranked highest to lowest. Highlight Frankston.",
        "bar",
        "Frankston",
    ),
    (
        "Type 2 diabetes choropleth",
        "09-chronic-disease",
        "Chronic disease",
        "Add a choropleth widget mapping type 2 diabetes prevalence % by SEMPHN LGA. Highlight Greater Dandenong.",
        "choropleth",
        "Greater Dandenong",
    ),
    (
        "Bowel screening bar",
        "09-chronic-disease",
        "Chronic disease",
        "Add a bar chart of bowel screening % NBCSP FY24 by SEMPHN LGA — ranked lowest first. Highlight Casey 35.9%.",
        "bar",
        "Casey",
    ),
    (
        "First Nations IRSEO bar",
        "04-first-nations",
        "First Nations people",
        "Add a bar chart of First Nations IRSEO by SEMPHN LGA — higher = more disadvantaged. Highlight Greater Dandenong.",
        "bar",
        "Greater Dandenong",
    ),
]

WIDGET_BLOCK = re.compile(r"```widget\s*\n(.+?)\n```", re.S)


def chat(prompt: str, step_slug: str, step_name: str) -> str:
    body = json.dumps({
        "step_slug": step_slug,
        "step_name": step_name,
        "messages": [{"role": "user", "content": prompt}],
        "context_summary": "SEMPHN catchment · 10 LGAs · 1.55M residents.",
    }).encode("utf-8")
    req = urllib.request.Request(
        CHAT_URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "hna-section-test",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            payload = json.loads(r.read().decode("utf-8"))
            return payload.get("reply", "") or ""
    except urllib.error.HTTPError as e:
        return f"__HTTP_{e.code}__ {e.reason}"
    except Exception as e:  # pragma: no cover
        return f"__EXC__ {e!r}"


def extract_widgets(reply: str):
    blocks = WIDGET_BLOCK.findall(reply)
    out = []
    for b in blocks:
        try:
            out.append(json.loads(b))
        except Exception:
            pass
    return out


def main() -> int:
    print(f"Testing HNA per-section widget prompts against {CHAT_URL}\n")
    failed = 0
    for (label, slug, name, prompt, want_type, must_contain) in CASES:
        print(f"  CASE · {label}")
        print(f"    chapter: {slug}")
        print(f"    prompt:  {prompt[:90]}...")
        reply = chat(prompt, "workbench-hna", name)
        widgets = extract_widgets(reply)
        types = [w.get("type") for w in widgets]
        ok_type = want_type in types
        # Must-contain check across reply text + widget JSON
        ok_label = must_contain.lower() in reply.lower()
        marker = "PASS" if (ok_type and ok_label) else "FAIL"
        print(f"    -> widgets emitted: {types or '(none)'}")
        print(f"    -> reply mentions {must_contain!r}: {ok_label}")
        print(f"    -> {marker}\n")
        if not (ok_type and ok_label):
            failed += 1
            # Show a snippet of the reply so we can diagnose
            snip = reply[:280].replace("\n", " ")
            print(f"       snippet: {snip}\n")
    total = len(CASES)
    passed = total - failed
    print(f"=== {passed}/{total} passed ({failed} failed) ===")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
