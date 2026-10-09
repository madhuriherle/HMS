"""Module privilege -> sub-module (area) privilege, decided by the request path.

Routes keep asking for the module-level code (``masters.write``). When the call is for an area
that has its own privileges (``/masters/banks`` -> ``masters.banks``), the check, the module
gate and the maker-checker flag all use ``masters.banks.write`` instead. Calls outside every
area (e.g. ``/masters/document-types``) keep the module-level code.
"""

import re
from contextvars import ContextVar
from typing import Dict, List, Tuple

from db.seed_defaults import SUB_MODULE_AREAS

# Set once per request by RequestPathMiddleware (main.py); dependencies read it.
request_path: ContextVar[str] = ContextVar("request_path", default="")

_API_PREFIX = "/api/v1"
_CODE = re.compile(r"^([a-z_.]+)\.(read|write|delete)$")
_AREAS: Dict[str, List[Tuple[str, str]]] = {
    module: [(prefix, sub) for sub, _label, prefixes in areas for prefix in prefixes]
    for module, areas in SUB_MODULE_AREAS.items()
}


def resolve(code: str, path: str = None) -> str:
    """The privilege code to enforce for ``code`` on the current request."""
    m = _CODE.match(code or "")
    if not m or m.group(1) not in _AREAS:
        return code
    path = request_path.get() if path is None else path
    if _API_PREFIX in path:
        path = path.split(_API_PREFIX, 1)[1]
    path = path.rstrip("/")
    for prefix, sub in _AREAS[m.group(1)]:
        if path == prefix or path.startswith(prefix + "/"):
            return f"{sub}.{m.group(2)}"
    return code


class RequestPathMiddleware:
    """Pure ASGI middleware: remember the request path for permission checks."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket"):
            token = request_path.set(scope.get("path", ""))
            try:
                await self.app(scope, receive, send)
            finally:
                request_path.reset(token)
        else:
            await self.app(scope, receive, send)
