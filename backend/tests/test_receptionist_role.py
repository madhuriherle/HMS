"""A role with only the Receipt Entry and Receipt Tracking privileges can use both screens completely, and nothing else."""
from test_frontend_contract import API
from test_sub_modules import _role_user

RECEIPT_ONLY = ["receipts.entry.read", "receipts.entry.write", "receipts.tracking.read", "receipts.tracking.write"]


def test_receipt_screens_work_with_their_own_privileges_only(client, admin_headers):
    h = _role_user(client, admin_headers, RECEIPT_ONLY)
    # everything Receipt Entry and Receipt Tracking load
    for path in (
        "/receipts/next-number", "/receipts/number-check?number=0001&date=2026-10-13", "/receipts/tracking?limit=5",
        "/receipts/?limit=5", "/receipts/member-lookup?number=ABC",
        "/masters/particulars?limit=50", "/masters/payment-modes?limit=50", "/masters/banks?limit=50",
        "/masters/membership-types?limit=50", "/masters/states?limit=50", "/masters/districts?limit=50",
        "/masters/taluks?limit=50", "/masters/postal-codes?limit=50",
        "/members/?limit=5", "/members/?limit=5&approval_status=UNAPPROVED", "/meta/lists", "/auth/me",
    ):
        r = client.get(f"{API}{path}", headers=h)
        assert r.status_code == 200, (path, r.status_code, r.text[:200])
    # nothing is writable outside the receipt pages
    assert client.post(f"{API}/masters/particulars", headers=h, json={"name_en": "Nope"}).status_code == 403
    assert client.post(f"{API}/masters/banks", headers=h, json={"name_en": "Nope"}).status_code == 403
    assert client.post(f"{API}/masters/states", headers=h, json={"name_en": "Nope"}).status_code == 403
    assert client.post(f"{API}/members/", headers=h, json={"first_name_en": "Nope"}).status_code == 403
    # other pages stay closed
    for path in ("/users/?limit=5", "/system/number-formats", "/masters/service-types", "/dashboard/stats"):
        assert client.get(f"{API}{path}", headers=h).status_code in (403, 404), path
    # and the menu offers only the two receipt pages
    menu = client.get(f"{API}/users/modules/menu", headers=h).json()
    names = []

    def walk(nodes):
        for n in nodes:
            names.append(n["name"])
            walk(n.get("submodules", []))
    walk(menu)
    assert "Receipt Entry" in names and "Receipt Tracking" in names
    assert not {"Particulars Master", "Payment Mode Setup", "Location Setup", "Membership List", "Unapproved Members"} & set(names)


def test_a_role_with_only_the_page_read_cannot_save(client, admin_headers):
    h = _role_user(client, admin_headers, ["receipts.entry.read"])
    assert client.get(f"{API}/receipts/next-number", headers=h).status_code == 200
    assert client.get(f"{API}/masters/particulars?limit=5", headers=h).status_code == 200
    assert client.post(f"{API}/receipts/", headers=h, json={"receipt_date": "2026-10-13"}).status_code == 403


def test_every_page_loads_what_it_needs_with_its_own_privilege(client, admin_headers):
    """One role per page, holding only that page's privilege: every call the page makes on load works."""
    pages = {
        "members.list.read": ["/members/?limit=5", "/masters/states?limit=5", "/masters/districts?limit=5", "/masters/taluks?limit=5",
                              "/masters/postal-codes?limit=5", "/masters/membership-types?limit=5", "/masters/gotras?limit=5",
                              "/receipts/?limit=5"],
        "members.unapproved.read": ["/members/?limit=5&approval_status=UNAPPROVED", "/masters/states?limit=5",
                                    "/masters/districts?limit=5", "/masters/membership-types?limit=5"],
        "members.register.write": ["/masters/payment-modes?limit=5", "/masters/banks?limit=5", "/masters/gotras?limit=5",
                                   "/masters/qualifications?limit=5", "/masters/states?limit=5", "/masters/membership-types?limit=5",
                                   "/members/duplicate-check?mobile=9000000000", "/members/lookup?number=ABC"],
        "masters.membership_types.read": ["/masters/membership-types?limit=5", "/masters/usage/membership-types"],
        "masters.particulars.read": ["/masters/particulars?limit=5", "/masters/usage/particulars"],
        "masters.payment_modes.read": ["/masters/payment-modes?limit=5", "/masters/banks?limit=5", "/receipts/?limit=5"],
        "receipts.tracking.read": ["/receipts/tracking?limit=5", "/receipts/day-book?from_date=2026-10-13&to_date=2026-10-13",
                                   "/members/?limit=5", "/masters/particulars?limit=5"],
    }
    for code, paths in pages.items():
        h = _role_user(client, admin_headers, [code])
        for path in paths:
            r = client.get(f"{API}{path}", headers=h)
            assert r.status_code == 200, (code, path, r.status_code, r.text[:150])
