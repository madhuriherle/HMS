"""Module privilege -> sub-module (screen) privileges, decided by the request.

Routes keep asking for the module-level code (``masters.write``). When the call belongs to a
screen that has its own privileges (``/masters/banks`` -> ``masters.banks``), the check, the module
gate and the maker-checker flag use that screen's code (``masters.banks.write``) instead.

A rule is a path prefix (any method) or ``(methods, path-regex[, query])``; ``query`` is
``"unapproved"`` / ``"not-unapproved"`` for the member list's ``approval_status`` filter. Several
screens may share a route (the member detail is read by Membership List and Unapproved Members): the
caller then needs ANY of the matching screens' privileges. Calls that match no screen keep the
module-level code.
"""

import re
from contextvars import ContextVar
from typing import Dict, List, Optional

from db.seed_defaults import AREA_ACTIONS, SUB_MODULE_AREAS

# Set once per request by RequestPathMiddleware (main.py); dependencies read it.
request_info: ContextVar[tuple] = ContextVar("request_info", default=("", "", ""))

_API_PREFIX = "/api/v1"
_CODE = re.compile(r"^([a-z_.]+)\.(read|write|delete)$")


def _compile(rule):
    if isinstance(rule, str):  # a path prefix, any method
        return ("*", re.compile("^" + re.escape(rule) + "(/.*)?$"), None)
    methods = rule[0]
    return (methods, re.compile(rule[1]), rule[2] if len(rule) > 2 else None)


_AREAS: Dict[str, List[tuple]] = {
    module: [(sub, [_compile(r) for r in rules]) for sub, _label, rules in areas]
    for module, areas in SUB_MODULE_AREAS.items()
}


def _query_says_unapproved(query: str) -> bool:
    return bool(re.search(r"(^|&)approval_status=UNAPPROVED(&|$)", query or "", re.I))


def candidates(code: str, path: Optional[str] = None, method: Optional[str] = None, query: Optional[str] = None) -> List[str]:
    """Privilege codes that satisfy ``code`` on this request (any one is enough)."""
    m = _CODE.match(code or "")
    if not m or m.group(1) not in _AREAS:
        return [code]
    if path is None:
        path, method, query = request_info.get()
    if _API_PREFIX in path:
        path = path.split(_API_PREFIX, 1)[1]
    path = path.rstrip("/") or "/"
    action = m.group(2)
    found = []
    for sub, rules in _AREAS[m.group(1)]:
        if action not in AREA_ACTIONS.get(sub, ("read", "write", "delete")):
            continue
        for methods, rx, q in rules:
            if methods != "*" and (method or "").upper() not in methods.split("|"):
                continue
            if not rx.match(path):
                continue
            if q == "unapproved" and not _query_says_unapproved(query):
                continue
            if q == "not-unapproved" and _query_says_unapproved(query):
                continue
            found.append(f"{sub}.{action}")
            break
    return found or [code]


def resolve(code: str, path: Optional[str] = None) -> str:
    """First matching code (kept for callers that need a single code)."""
    return candidates(code, path)[0]


class RequestPathMiddleware:
    """Pure ASGI middleware: remember the request's path, method and query for permission checks."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket"):
            token = request_info.set((scope.get("path", ""), scope.get("method", "GET"), scope.get("query_string", b"").decode("latin-1")))
            try:
                await self.app(scope, receive, send)
            finally:
                request_info.reset(token)
        else:
            await self.app(scope, receive, send)
