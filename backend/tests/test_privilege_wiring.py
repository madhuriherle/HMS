"""Every action follows the privileges: a signed-in user with no privileges can neither read nor change anything."""

from test_api import _staff_with_role

API = "/api/v1"

READS = [
    "/members/", "/members/export-labels", "/receipts/tracking", "/receipts/",
    "/reports/members", "/reports/receipts", "/reports/summary", "/activity/users", "/activity/members",
    "/masters/banks", "/masters/payment-modes", "/masters/particulars", "/masters/states", "/masters/membership-types",
    "/masters/postal-codes", "/events/", "/magazines/subscriptions", "/notifications/templates",
    "/engagements/affiliations", "/system/settings", "/system/error-logs", "/system/files",
    "/users/", "/users/roles", "/approvals/requests", "/approvals/deletion-requests",
]
WRITES = [
    ("post", "/members/", {"first_name_en": "X", "mobile": "9000000999"}), ("put", "/members/1", {}),
    ("delete", "/members/1", None), ("post", "/receipts/", {}), ("post", "/masters/states", {"name_en": "Z"}),
    ("put", "/system/settings", {}), ("post", "/users/", {}), ("post", "/users/roles", {}),
    ("put", "/approvals/requests/1/approve", None),
]


def test_user_without_privileges_cannot_read_or_change_anything(client, admin_headers):
    _, _, nobody = _staff_with_role(client, admin_headers, "wire_nobody", "WireNobody", "WIRE_NOBODY", permission_grants=[])
    for path in READS:
        r = client.get(f"{API}{path}", headers=nobody)
        assert r.status_code == 403, f"GET {path} -> {r.status_code}"
    for method, path, body in WRITES:
        r = client.request(method.upper(), f"{API}{path}", headers=nobody, **({"json": body} if body is not None else {}))
        assert r.status_code == 403, f"{method.upper()} {path} -> {r.status_code}"


def test_dashboard_blocks_follow_read_privileges(client, admin_headers):
    # nothing granted -> the dashboard itself refuses (needs dashboard.read)
    _, _, nobody = _staff_with_role(client, admin_headers, "dash_nobody", "DashNobody", "DASH_NOBODY", permission_grants=[])
    assert client.get(f"{API}/dashboard/", headers=nobody).status_code == 403

    # dashboard.read + only receipts.read -> the dashboard opens, but only the receipts block
    _, _, cashier = _staff_with_role(client, admin_headers, "dash_cashier", "DashCashier", "DASH_CASHIER",
                                     permission_grants=[("dashboard.read", False), ("receipts.read", False)])
    d = client.get(f"{API}/dashboard/", headers=cashier).json()
    assert d["receipts"] is not None and d["members"] is None and d["magazines"] is None and d["pending_approvals"] is None

    # an all-access admin sees everything
    d = client.get(f"{API}/dashboard/", headers=admin_headers).json()
    assert d["members"] and d["receipts"] is not None and d["magazines"] is not None and d["pending_approvals"] is not None


def test_login_landing_follows_the_menu(client, admin_headers):
    """The login redirect lands on the first page the role can actually open:
    the menu returns only entitled pages, so the first route in it is home."""
    _, _, h = _staff_with_role(client, admin_headers, "landing_user", "Landing Role", "LANDING_ROLE",
                               permission_grants=[("masters.payment_modes.read", False)])
    menu = client.get(f"{API}/users/modules/menu", headers=h).json()

    def first_route(nodes):
        for node in nodes or []:
            if isinstance(node.get("route"), str) and node["route"].startswith("/dashboard"):
                return node["route"]
            sub = first_route(node.get("submodules"))
            if sub:
                return sub
        return None

    # the gated dashboard is not in the menu; the banks screen is the first page
    def codes(nodes):
        out = {n["code"] for n in nodes or []}
        for n in nodes or []:
            out |= codes(n.get("submodules"))
        return out

    assert "dashboard" not in codes(menu)
    assert first_route(menu) == "/dashboard/master/payment-modes"
