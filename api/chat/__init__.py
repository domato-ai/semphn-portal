"""Chat-assist Function for the SEMPHN HNA Workbench.

POST /api/chat — body JSON:
  {
    "step_slug": "04-first-nations",     # required
    "step_name": "First Nations people", # required
    "messages": [                        # required: prior conversation + latest user msg
      {"role": "user", "content": "What's the strongest finding here?"},
      ...
    ],
    "context_summary": "Catchment 7,500 First Nations residents; MH prevalence..."  # optional
  }

Sends to Azure AI Foundry (OpenAI-compatible Inference API) using model determined
by MODEL_TIER env var (default: 'mini' = gpt-4o-mini).

Returns:
  { "reply": "<assistant text>", "model": "<deployment name>" }
  { "error": "<message>" } on failure

SWA Application Settings required (set after deploy):
  AZURE_FOUNDRY_ENDPOINT  — e.g. https://aif-semphn-portal.<region>.inference.azure.com
  AZURE_FOUNDRY_KEY       — primary key from Foundry → Keys
  MODEL_TIER              — 'mini' (default) | 'sonnet' (Phase 2)
  MODEL_MINI_DEPLOYMENT   — Foundry deployment name for mini path (default 'gpt-4o-mini')
  MODEL_SONNET_DEPLOYMENT — Foundry deployment name for sonnet path (default 'claude-sonnet-4-5')

Cost & safety:
  - Hard per-call message cap (10 messages back). Older history truncated.
  - Total response cap: 600 output tokens (per call).
  - Rate-limit: in-memory token bucket per client IP (200 requests / day).
    NOTE: SWA Functions are stateless across cold starts → this is best-effort.
    For real rate limiting, swap to Azure Table Storage in Phase 1.5.

System prompt is built per-step from a small static dict — when Phase 2 lands and
each step has live SEMPHN data in the payload, the system prompt can pull richer
context dynamically.
"""
from __future__ import annotations

import json
import logging
import os
import time
from collections import defaultdict, deque

import azure.functions as func
from openai import AzureOpenAI, OpenAIError

log = logging.getLogger("chat")

# ---- Configuration ---------------------------------------------------------

DEFAULT_TIMEOUT_S = 25
MAX_HISTORY = 10
MAX_OUTPUT_TOKENS = 600
RATE_LIMIT_REQUESTS_PER_DAY = 200

DEFAULT_DEPLOYMENTS = {
    "mini":   "gpt-4o-mini",
    "sonnet": "claude-sonnet-4-5",
}

# Per-step system prompt — keeps the model grounded in what the user is doing.
STEP_PROMPTS = {
    "01-introduction":     "the methodology + frameworks chapter — Bradshaw's Taxonomy of Need, Dahlgren-Whitehead SDOH, DoH triangulation matrix",
    "02-region":           "the regional overview — 10 LGAs, 1.56M residents, 24% of Victoria, projected 2M by 2030",
    "03-cald":             "the CALD priority population — 1 in 3 residents born overseas, concentrated in Casey + Greater Dandenong",
    "04-first-nations":    "the First Nations priority population — catchment IRSEO 25 vs Vic 14, MH the most common chronic condition",
    "05-older-people":     "the 65+ priority population — 16.2% of catchment, +29.7% projected growth to 2030",
    "06-homelessness":     "the homelessness priority population — 4,580 residents homeless or marginal; Greater Dandenong 149.5/10k",
    "07-mental-health":    "the mental health priority — Frankston highest MH conditions per 1k; Casey highest diagnosis share at 22.4%",
    "08-aod":              "the AOD priority — alcohol consistent with state; risky drinking highest in coastal LGAs",
    "09-chronic-disease":  "chronic disease — dementia leading cause for women, CHD for men; multi-chronic highest in Mornington Peninsula",
    "10-workforce":        "the health workforce — 497 GPs, 2,813 practitioners, 155 RACFs, 2 ACCHS, bulk-billing concentrated in disadvantaged LGAs",
    "11-recommendations":  "aggregated recommendations across all 9 substantive chapters",
    "12-preflight":        "the DoH Compliance Checklist + Performance Rubric pre-flight check",
    "13-lodgement":        "final lodgement to PPERS",
}


def _cfg(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _deployment_for_tier(tier: str) -> str:
    if tier == "sonnet":
        return _cfg("MODEL_SONNET_DEPLOYMENT", DEFAULT_DEPLOYMENTS["sonnet"])
    return _cfg("MODEL_MINI_DEPLOYMENT", DEFAULT_DEPLOYMENTS["mini"])


def _system_prompt(step_slug: str, step_name: str, context_summary: str) -> str:
    step_desc = STEP_PROMPTS.get(step_slug, f"step '{step_name}'")
    parts = [
        "You are an assistant for SEMPHN (South Eastern Melbourne Primary Health Network) "
        "staff preparing their 2025-2028 Health Needs Assessment annual update for "
        "lodgement to the Australian Department of Health and Aged Care via PPERS.",
        f"The user is currently on {step_desc}.",
        "Help them frame priorities, draft narrative, and decide what rises to a "
        "recommendation in the lodged HNA.",
        "Be concise: 2-4 sentences unless they ask for a draft paragraph.",
        "Cite specific LGA names and figures from the context where relevant.",
        "Australian English. Australian healthcare terminology.",
        "Never invent figures. If you don't know a number, say so plainly.",
    ]
    if context_summary:
        parts.append(f"\nStep-specific data context:\n{context_summary.strip()}")
    return "\n".join(parts)


# ---- Rate limiting (in-memory, best-effort) --------------------------------
_buckets: dict[str, deque] = defaultdict(deque)


def _allowed(client_id: str) -> bool:
    now = time.time()
    day_ago = now - 86400
    b = _buckets[client_id]
    while b and b[0] < day_ago:
        b.popleft()
    if len(b) >= RATE_LIMIT_REQUESTS_PER_DAY:
        return False
    b.append(now)
    return True


def _client_id(req: func.HttpRequest) -> str:
    fwd = req.headers.get("x-forwarded-for") or req.headers.get("X-Forwarded-For") or ""
    if fwd:
        # Take the first IP, strip any port
        ip = fwd.split(",")[0].strip()
        if ":" in ip and "." in ip:
            ip = ip.split(":")[0]
        return ip
    return "anonymous"


# ---- Response helpers ------------------------------------------------------
def _cors_headers() -> dict:
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    }


def _json_response(payload: dict, status: int = 200) -> func.HttpResponse:
    return func.HttpResponse(
        body=json.dumps(payload),
        status_code=status,
        mimetype="application/json",
        headers=_cors_headers(),
    )


# ---- Main handler ----------------------------------------------------------
def main(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return func.HttpResponse(status_code=204, headers=_cors_headers())

    # Rate limit
    cid = _client_id(req)
    if not _allowed(cid):
        log.warning("rate-limited %s", cid)
        return _json_response(
            {"error": "Too many requests. Daily limit reached. Try again tomorrow."},
            status=429,
        )

    # Parse body
    try:
        body = req.get_json()
    except ValueError:
        return _json_response({"error": "Body must be valid JSON."}, status=400)

    step_slug = (body.get("step_slug") or "").strip()
    step_name = (body.get("step_name") or "").strip()
    messages_in = body.get("messages") or []
    context_summary = (body.get("context_summary") or "").strip()

    if not step_slug or not step_name:
        return _json_response(
            {"error": "step_slug and step_name are required."}, status=400
        )
    if not isinstance(messages_in, list) or not messages_in:
        return _json_response({"error": "messages must be a non-empty list."}, status=400)

    # Truncate history to the most recent MAX_HISTORY turns
    history = [
        {"role": m.get("role"), "content": m.get("content")}
        for m in messages_in[-MAX_HISTORY:]
        if m.get("role") in ("user", "assistant") and m.get("content")
    ]
    if not history:
        return _json_response({"error": "no valid messages in history."}, status=400)

    # Config check
    endpoint = _cfg("AZURE_FOUNDRY_ENDPOINT")
    key = _cfg("AZURE_FOUNDRY_KEY")
    tier = _cfg("MODEL_TIER", "mini").lower()
    if not endpoint or not key:
        log.error("Foundry config missing — set AZURE_FOUNDRY_ENDPOINT + AZURE_FOUNDRY_KEY")
        return _json_response(
            {"error": "Chat assist is not configured. Contact support@domato.ai."},
            status=503,
        )

    deployment = _deployment_for_tier(tier)
    system_prompt = _system_prompt(step_slug, step_name, context_summary)

    # Build the prompt
    messages = [{"role": "system", "content": system_prompt}] + history

    # Call Foundry via the OpenAI-compatible API
    try:
        client = AzureOpenAI(
            azure_endpoint=endpoint,
            api_key=key,
            api_version="2024-08-01-preview",
            timeout=DEFAULT_TIMEOUT_S,
        )
        completion = client.chat.completions.create(
            model=deployment,
            messages=messages,
            max_tokens=MAX_OUTPUT_TOKENS,
            temperature=0.4,
        )
    except OpenAIError as e:
        log.exception("Foundry API call failed")
        return _json_response(
            {"error": "Chat assist temporarily unavailable. Try again in a moment."},
            status=502,
        )
    except Exception:
        log.exception("Unexpected error in chat handler")
        return _json_response(
            {"error": "Unexpected error. Try again in a moment."}, status=500
        )

    if not completion.choices:
        return _json_response({"error": "Model returned no choices."}, status=502)
    reply = (completion.choices[0].message.content or "").strip()
    if not reply:
        return _json_response({"error": "Model returned an empty reply."}, status=502)

    return _json_response({"reply": reply, "model": deployment})
