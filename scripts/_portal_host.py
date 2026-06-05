"""Resolve the right PORTAL hostname for test scripts.

Order of preference:
  1. $PORTAL_HOST env var (explicit override always wins).
  2. The custom domain https://semphn.domato.ai · if its TLS cert
     verifies and / returns 200.
  3. Fallback to the Azure SWA default hostname.

This means the test suite "just works" through the cert-validation
window (custom domain DNS resolves but cert isn't issued yet → fall
back to SWA) and automatically picks up the custom domain once Azure's
managed cert lands. Test output prints which host was chosen so a
discrepancy is obvious.
"""
from __future__ import annotations
import os
import socket
import ssl
import urllib.request

CUSTOM = "https://semphn.domato.ai"
SWA    = "https://ambitious-cliff-02027e900.7.azurestaticapps.net"


def _can_reach(url: str, timeout: float = 6.0) -> bool:
    """True only if a) TLS cert verifies and b) / returns 200."""
    try:
        host = url.split("://", 1)[1].split("/", 1)[0]
        ctx = ssl.create_default_context()
        with socket.create_connection((host, 443), timeout=timeout) as raw:
            with ctx.wrap_socket(raw, server_hostname=host):
                pass
        req = urllib.request.Request(url + "/", headers={"User-Agent": "host-picker"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status == 200
    except Exception:
        return False


def portal_host() -> str:
    override = os.environ.get("PORTAL_HOST", "").rstrip("/")
    if override:
        return override
    if _can_reach(CUSTOM):
        return CUSTOM
    return SWA


if __name__ == "__main__":
    # Diagnostic — print which host wins right now.
    print(portal_host())
