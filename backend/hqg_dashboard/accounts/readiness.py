"""The live readiness probes that resuming a trading mode requires."""

from __future__ import annotations

import urllib.request

CONTROL_READY_MARKER = "hqg-account-control-ready"
WEBSITE_READY_MARKER = "hqg-dashboard-app"
PROBE_TIMEOUT_SECONDS = 0.8
MAX_RESPONSE_BYTES = 1_000_000


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class ReadinessProbe:
    """True only when the public control and website URLs both answer, over HTTPS,
    with their markers. No cached generic /health response can grant permission.

    The probes ignore the proxy environment variables. Given proxy_url, they connect
    through that proxy, except to hosts that NO_PROXY lists."""

    def __init__(
        self, control_url: str, control_token: str, website_url: str, proxy_url: str = ""
    ) -> None:
        self.control_url = control_url
        self.control_token = control_token
        self.website_url = website_url
        self.proxies = {"https": proxy_url} if proxy_url else {}

    def __call__(self) -> bool:
        probes = (
            (
                self.control_url,
                CONTROL_READY_MARKER,
                {"Authorization": f"Bearer {self.control_token}"},
            ),
            (self.website_url, WEBSITE_READY_MARKER, {}),
        )
        try:
            opener = urllib.request.build_opener(
                urllib.request.ProxyHandler(self.proxies), NoRedirect()
            )
            for url, marker, headers in probes:
                if not url.startswith("https://"):
                    return False
                request = urllib.request.Request(url, headers=headers)
                with opener.open(request, timeout=PROBE_TIMEOUT_SECONDS) as response:
                    body = response.read(MAX_RESPONSE_BYTES).decode()
                    if response.status != 200 or marker not in body:
                        return False
            return True
        except Exception:
            return False
