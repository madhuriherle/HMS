"""Every route of the API refuses a signed-in user who holds no privileges (403), except the ones listed here.

A new endpoint that forgets its privilege check shows up as a failure of this test."""

import re

from test_api import _staff_with_role

API = "/api/v1"

# (method, path) that are open on purpose, with why
OPEN = {
    # documentation
    ("GET", "/api/v1/openapi.json"), ("GET", "/api/v1/docs"), ("GET", "/api/v1/redoc"),
    # login and the person's own account
    ("POST", "/api/v1/auth/login"), ("POST", "/api/v1/auth/logout"), ("POST", "/api/v1/auth/refresh"),
    ("POST", "/api/v1/auth/forgot-password"), ("POST", "/api/v1/auth/reset-password"),
    ("POST", "/api/v1/auth/change-password"), ("GET", "/api/v1/auth/me"), ("PUT", "/api/v1/auth/me"),
    # token links and the public form
    ("GET", "/api/v1/kyc/{token}"), ("POST", "/api/v1/kyc/{token}"), ("POST", "/api/v1/members/public-register"),
    # the sidebar and lists every screen needs; each answers only what the role may see
    ("GET", "/api/v1/users/modules/menu"), ("GET", "/api/v1/dashboard/search"),
    ("GET", "/api/v1/meta/rules"), ("GET", "/api/v1/meta/lists"), ("GET", "/api/v1/meta/pin-prefixes"),
    ("GET", "/api/v1/meta/pincode/{pin}"), ("GET", "/api/v1/meta/import-template/{kind}"),
    # the mobile app: members file requests that only take effect once approved, and read their own inbox
    ("POST", "/api/v1/members/profile-changes/"), ("POST", "/api/v1/approvals/type-changes"),
    ("POST", "/api/v1/approvals/deletion-requests"),
    ("POST", "/api/v1/notifications/callbacks"), ("GET", "/api/v1/notifications/inbox"),
    ("GET", "/api/v1/notifications/inbox/unread-count"), ("POST", "/api/v1/notifications/inbox/{notification_id}/read"),
    ("POST", "/api/v1/notifications/devices"), ("DELETE", "/api/v1/notifications/devices/{token_id}"),
}


def test_every_route_needs_a_privilege_unless_listed(client, admin_headers):
    from main import app

    _, _, nobody = _staff_with_role(client, admin_headers, "route_nobody", "RouteNobody", "ROUTE_NOBODY", permission_grants=[])
    loose, seen = [], set()
    for route in app.routes:
        path = getattr(route, "path", "")
        if not path.startswith(API) or not hasattr(route, "methods"):
            continue
        for method in sorted(route.methods - {"HEAD", "OPTIONS"}):
            if (method, path) in OPEN or (method, path) in seen:
                continue
            seen.add((method, path))
            url = re.sub(r"\{[^}]+\}", "1", path)
            resp = client.request(method, url, headers=nobody, **({} if method == "GET" else {"json": {}}))
            if resp.status_code != 403:
                loose.append(f"{method} {path} -> {resp.status_code}")
    assert len(seen) > 300, "the route list was read"
    assert not loose, "routes that do not check a privilege:\n" + "\n".join(loose)
