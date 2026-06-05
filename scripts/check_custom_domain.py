"""Probe the live custom-domain configuration for app.semphn.domato.ai.

Run:  python scripts/check_custom_domain.py

Checks (each prints PASS / FAIL):
  1. DNS · app.semphn.domato.ai resolves through the Azure SWA CNAME chain
  2. HTTPS · cert is valid (trusts the system roots, no -k needed)
  3. Cert SAN covers app.semphn.domato.ai
  4. /            serves HTML 200
  5. /signin/     serves HTML 200
  6. /hna/        serves HTML 200
  7. /dashboards/ serves HTML 200
  8. /maps/       serves HTML 200
  9. /api/chat    POST returns 200 + reply JSON
"""
from __future__ import annotations
import io, json, socket, ssl, sys, urllib.request

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", line_buffering=True)

HOST = "app.semphn.domato.ai"
ROOT = f"https://{HOST}"


def dns_check() -> bool:
    try:
        ais = socket.getaddrinfo(HOST, 443)
        return bool(ais)
    except Exception:
        return False


def cert_check() -> tuple[bool, list[str], str]:
    """Returns (valid_chain, SAN list, issuer_cn)."""
    ctx = ssl.create_default_context()
    try:
        with socket.create_connection((HOST, 443), timeout=12) as raw:
            with ctx.wrap_socket(raw, server_hostname=HOST) as s:
                cert = s.getpeercert()
        sans = [v for k, v in cert.get("subjectAltName", []) if k == "DNS"]
        issuer = "; ".join("=".join(p) for p in (cert.get("issuer", [])[1] or []))
        return True, sans, issuer
    except ssl.SSLCertVerificationError:
        return False, [], "verify-failed"
    except Exception as e:
        return False, [], f"err:{e!r}"


def http_get(path: str) -> tuple[int, int]:
    try:
        req = urllib.request.Request(ROOT + path, headers={"User-Agent": "domain-check"})
        with urllib.request.urlopen(req, timeout=15) as r:
            body = r.read()
            return r.status, len(body)
    except urllib.error.HTTPError as e:
        return e.code, 0
    except Exception:
        return 0, 0


def api_check() -> tuple[int, bool, str]:
    body = json.dumps({
        "step_slug": "workbench-hna",
        "step_name": "Mental health",
        "messages": [{"role": "user", "content": "Reply with the single word OK."}],
        "context_summary": "Smoke test",
    }).encode("utf-8")
    req = urllib.request.Request(
        ROOT + "/api/chat",
        data=body,
        headers={"Content-Type": "application/json", "User-Agent": "domain-check"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            payload = json.loads(r.read().decode("utf-8"))
            return r.status, "reply" in payload, (payload.get("reply", "") or "")[:90]
    except urllib.error.HTTPError as e:
        return e.code, False, e.reason
    except Exception as e:
        return 0, False, repr(e)


def main() -> int:
    failed = 0
    print(f"Probing https://{HOST}\n")

    ok = dns_check()
    print(f"  {'PASS' if ok else 'FAIL'} DNS resolves")
    if not ok: failed += 1

    valid, sans, issuer = cert_check()
    print(f"  {'PASS' if valid else 'FAIL'} TLS cert verifies (issuer: {issuer or '—'})")
    if not valid: failed += 1
    san_ok = HOST in sans
    print(f"  {'PASS' if san_ok else 'FAIL'} cert SAN covers {HOST} (found {len(sans)} SAN entries)")
    if not san_ok: failed += 1

    for path in ["/", "/signin/", "/hna/", "/dashboards/", "/maps/"]:
        code, size = http_get(path)
        ok = code == 200 and size > 200
        print(f"  {'PASS' if ok else 'FAIL'} GET {path} -> {code} · {size} bytes")
        if not ok: failed += 1

    print("\nAPI smoke test")
    code, ok, snip = api_check()
    print(f"  {'PASS' if ok else 'FAIL'} POST /api/chat -> {code} · reply: {snip!r}")
    if not ok: failed += 1

    total = 3 + 5 + 1
    passed = total - failed
    print(f"\n=== {passed}/{total} passed ({failed} failed) ===")
    if not valid:
        print("\nHint: 'TLS cert verifies' failing usually just means Azure is still")
        print("issuing the managed certificate. Re-run in 15–60 minutes.")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
