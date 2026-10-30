"""UConn CAS login: the redirect and CAS 2.0 serviceValidate ticket checks."""

from __future__ import annotations

import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

CAS_NAMESPACE = {"cas": "http://www.yale.edu/tp/cas"}


class CasClient:
    def __init__(self, base_url: str, service_url: str) -> None:
        self.base_url = base_url
        self.service_url = service_url

    @property
    def login_url(self) -> str:
        return f"{self.base_url}/login?service={_quote(self.service_url)}"

    def validate(self, ticket: str) -> str | None:
        """Return the NetID CAS issued the ticket to, or None if CAS rejects it."""
        url = (
            f"{self.base_url}/serviceValidate"
            f"?service={_quote(self.service_url)}&ticket={_quote(ticket)}"
        )
        with urllib.request.urlopen(url, timeout=5) as response:
            xml = response.read().decode("utf-8", errors="replace")

        try:
            root = ET.fromstring(xml)
        except ET.ParseError:
            return None
        success = root.find("cas:authenticationSuccess", CAS_NAMESPACE)
        if success is None:
            return None
        return success.findtext("cas:user", default="", namespaces=CAS_NAMESPACE) or None


def _quote(value: str) -> str:
    return urllib.parse.quote(value, safe="")
