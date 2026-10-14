"""Tests for Magazine Module end-to-end workflow:
1. Registration with custom magazine delivery address.
2. Member edit: changing magazine_needed to True starts/restarts subscription; False stops it.
3. Receipt assignment creates active subscription for magazine_needed=True member (inline, manual allocate, bulk allocate).
4. Unsubscribed paid members listing and backfill subscriptions endpoint.
5. All-recipients endpoint including Member, Affiliation, Associate, Press.
6. Label generation with only_paid filtering and custom delivery address usage.
"""

from test_frontend_contract import API, _sfx
from test_receipt_entry_flow import _entry_payload


def test_member_registration_stores_magazine_delivery_address(client, admin_headers):
    h, s = admin_headers, _sfx()
    custom_addr = f"Flat 402, Magazine Tower, Sirsi {s}"
    res = client.post(f"{API}/members/", headers=h, json={
        "first_name_en": f"MagReg{s}",
        "mobile": "94" + s.zfill(8),
        "magazine_needed": True,
        "magazine_delivery_address": custom_addr,
    })
    assert res.status_code in (200, 201), res.text
    mid = res.json()["id"]

    # Verify field on member and in profile
    m = client.get(f"{API}/members/{mid}", headers=h).json()
    assert m["magazine_needed"] is True
    assert m["magazine_delivery_address"] == custom_addr

    prof = client.get(f"{API}/members/{mid}/profile", headers=h).json()
    assert prof["personal"]["magazine_needed"] is True
    assert prof["personal"]["magazine_delivery_address"] == custom_addr
    # A member who says Yes is on the magazine subscription straight away (Active, delivering to that address)
    assert len(prof["services"]["magazine"]) == 1
    assert prof["services"]["magazine"][0]["delivery_status"] == "ACTIVE"
    assert prof["services"]["magazine"][0]["address_override"] == custom_addr


def test_member_edit_starts_and_stops_subscription(client, admin_headers):
    h, s = admin_headers, _sfx()
    custom_addr = f"Branch Office, Hubli {s}"
    res = client.post(f"{API}/members/", headers=h, json={
        "first_name_en": f"EditSub{s}",
        "mobile": "94" + s.zfill(8),
        "magazine_needed": False,
        "magazine_delivery_address": custom_addr,
    })
    assert res.status_code in (200, 201), res.text
    mid = res.json()["id"]

    # Turn magazine_needed to True
    upd1 = client.put(f"{API}/members/{mid}", headers=h, json={"magazine_needed": True})
    assert upd1.status_code == 200, upd1.text

    # Subscription must be created and ACTIVE with address_override
    subs = client.get(f"{API}/magazines/subscriptions", headers=h, params={"member_id": mid}).json()["data"]
    assert len(subs) == 1
    assert subs[0]["delivery_status"] == "ACTIVE"
    assert subs[0]["address_override"] == custom_addr

    # Service opt-in must be synced and ACTIVE
    prof1 = client.get(f"{API}/members/{mid}/profile/magazine", headers=h).json()
    optins1 = [o for o in prof1["services"] if o["service_code"] == "MAGAZINE"]
    assert len(optins1) == 1
    assert optins1[0]["status"] == "ACTIVE"

    # Turn magazine_needed to False
    upd2 = client.put(f"{API}/members/{mid}", headers=h, json={"magazine_needed": False})
    assert upd2.status_code == 200, upd2.text

    subs2 = client.get(f"{API}/magazines/subscriptions", headers=h, params={"member_id": mid}).json()["data"]
    assert len(subs2) == 1
    assert subs2[0]["delivery_status"] == "STOPPED"

    prof2 = client.get(f"{API}/members/{mid}/profile/magazine", headers=h).json()
    optins2 = [o for o in prof2["services"] if o["service_code"] == "MAGAZINE"]
    assert len(optins2) == 0  # ACTIVE opt-ins queried, cancelled is excluded from active list


def test_receipt_assignment_creates_active_subscription(client, admin_headers):
    h, s = admin_headers, _sfx()
    custom_addr = f"Home Villa, Kumta {s}"

    # 1. Inline allocation at receipt creation
    m1 = client.post(f"{API}/members/", headers=h, json={
        "first_name_en": f"RecAssign1{s}",
        "mobile": "94" + s.zfill(8),
        "magazine_needed": True,
        "magazine_delivery_address": custom_addr,
    }).json()

    body1 = _entry_payload(f"RC1-{s}", "Inline Payer", payment_mode="CASH",
                           allocations=[{"member_id": m1["id"], "allocated_amount": 500}])
    r1 = client.post(f"{API}/receipts/", headers=h, json=body1)
    assert r1.status_code in (200, 201), r1.text

    subs1 = client.get(f"{API}/magazines/subscriptions", headers=h, params={"member_id": m1["id"]}).json()["data"]
    assert len(subs1) == 1
    assert subs1[0]["delivery_status"] == "ACTIVE"
    assert subs1[0]["address_override"] == custom_addr

    # 2. Manual allocation via POST /receipts/{id}/allocate
    s2 = _sfx()
    m2 = client.post(f"{API}/members/", headers=h, json={
        "first_name_en": f"RecAssign2{s2}",
        "mobile": "94" + s2.zfill(8),
        "magazine_needed": True,
        "magazine_delivery_address": f"Address 2 {s2}",
    }).json()

    body2 = _entry_payload(f"RC2-{s2}", "Manual Payer", payment_mode="CASH", allocations=[])
    r2 = client.post(f"{API}/receipts/", headers=h, json=body2).json()

    alloc_res = client.post(f"{API}/receipts/{r2['id']}/allocate", headers=h, json={
        "member_id": m2["id"],
        "allocated_amount": 500,
    })
    assert alloc_res.status_code in (200, 201), alloc_res.text

    subs2 = client.get(f"{API}/magazines/subscriptions", headers=h, params={"member_id": m2["id"]}).json()["data"]
    assert len(subs2) == 1
    assert subs2[0]["delivery_status"] == "ACTIVE"
    assert subs2[0]["address_override"] == f"Address 2 {s2}"

    # 3. Bulk allocation via POST /receipts/bulk-allocate
    s3 = _sfx()
    m3 = client.post(f"{API}/members/", headers=h, json={
        "first_name_en": f"RecAssign3{s3}",
        "mobile": "94" + s3.zfill(8),
        "magazine_needed": True,
        "magazine_delivery_address": f"Address 3 {s3}",
    }).json()

    body3 = _entry_payload(f"RC3-{s3}", "Bulk Payer", payment_mode="CASH", allocations=[])
    r3 = client.post(f"{API}/receipts/", headers=h, json=body3).json()

    bulk_res = client.post(f"{API}/receipts/bulk-allocate", headers=h, json={
        "allocations": [{"receipt_id": r3["id"], "member_id": m3["id"], "allocated_amount": 500}]
    })
    assert bulk_res.status_code == 200, bulk_res.text
    assert bulk_res.json()["allocated_count"] == 1

    subs3 = client.get(f"{API}/magazines/subscriptions", headers=h, params={"member_id": m3["id"]}).json()["data"]
    assert len(subs3) == 1
    assert subs3[0]["delivery_status"] == "ACTIVE"


def test_unsubscribed_paid_members_and_backfill(client, admin_headers):
    h, s = admin_headers, _sfx()
    # Create member with magazine_needed=True and a receipt allocation directly on database or simulate
    m = client.post(f"{API}/members/", headers=h, json={
        "first_name_en": f"Backfill{s}",
        "mobile": "94" + s.zfill(8),
        "magazine_needed": True,
        "magazine_delivery_address": f"Backfill Addr {s}",
    }).json()

    # Pay a receipt for this member
    body = _entry_payload(f"BF-{s}", "BF Payer", payment_mode="CASH",
                          allocations=[{"member_id": m["id"], "allocated_amount": 600}])
    client.post(f"{API}/receipts/", headers=h, json=body)

    # Now member has subscription because of receipt assignment. Delete the subscription to simulate legacy member!
    subs = client.get(f"{API}/magazines/subscriptions", headers=h, params={"member_id": m["id"]}).json()["data"]
    assert len(subs) == 1
    client.delete(f"{API}/magazines/subscriptions/{subs[0]['id']}", headers=h)

    # Now verify GET /magazines/unsubscribed-paid-members finds this member
    unsub = client.get(f"{API}/magazines/unsubscribed-paid-members", headers=h).json()
    unsub_mids = [u["member_id"] for u in unsub]
    assert m["id"] in unsub_mids

    # Run backfill
    bf_res = client.post(f"{API}/magazines/backfill-subscriptions", headers=h, json={
        "member_ids": [m["id"]]
    })
    assert bf_res.status_code == 200, bf_res.text
    assert bf_res.json()["created_count"] == 1

    # Verify subscription is now active again
    subs_after = client.get(f"{API}/magazines/subscriptions", headers=h, params={"member_id": m["id"]}).json()["data"]
    assert len(subs_after) == 1
    assert subs_after[0]["delivery_status"] == "ACTIVE"


def test_all_recipients_and_labels_paid_filtering(client, admin_headers):
    h, s = admin_headers, _sfx()

    # Create an affiliation, associate, and press with magazine enabled
    aff = client.post(f"{API}/engagements/affiliations", headers=h, json={
        "group_name": f"Affiliate {s}",
        "contact_person": "Secretary",
        "contact_number": "9800000001",
        "address": "Affiliate Bhavan, Sirsi",
        "magazine_enabled": True,
    }).json()

    assoc = client.post(f"{API}/engagements/associates", headers=h, json={
        "name": f"Associate {s}",
        "organization": "Trust",
        "mobile": "9800000002",
        "address": "Trust Office, Yellapur",
        "magazine_enabled": True,
    }).json()

    press = client.post(f"{API}/engagements/press-media", headers=h, json={
        "organization_name": f"Press Daily {s}",
        "reporter_name": "Editor",
        "mobile": "9800000003",
        "address": "Press Enclave, Karwar",
        "magazine_enabled": True,
    }).json()

    # Create a paid member with active subscription
    m_paid = client.post(f"{API}/members/", headers=h, json={
        "first_name_en": f"Paid{s}",
        "mobile": "94" + s.zfill(8),
        "magazine_needed": True,
        "address_line1": "Paid Street 1",
    }).json()
    client.post(f"{API}/receipts/", headers=h, json=_entry_payload(
        f"LBL-{s}", "Paid Member", payment_mode="CASH", allocations=[{"member_id": m_paid["id"], "allocated_amount": 500}]
    ))

    # Test GET /magazines/all-recipients
    recipients = client.get(f"{API}/magazines/all-recipients", headers=h).json()
    types = {r["recipient_type"] for r in recipients}
    assert "MEMBER" in types
    assert "AFFILIATION" in types
    assert "ASSOCIATE" in types
    assert "PRESS" in types

    # Test generate labels with only_paid=True
    gen = client.post(f"{API}/magazines/generate-labels", headers=h, params={
        "issue_month_year": "2026-07",
        "only_paid": True,
    })
    assert gen.status_code == 200, gen.text
    batch_id = gen.json()["batch_id"]
    batch_items = client.get(f"{API}/magazines/label-batches/{batch_id}", headers=h).json()["data"]

    # Verify member and non-members are in the generated batch
    batch_recip_types = {item["recipient_type"] for item in batch_items}
    assert "MEMBER" in batch_recip_types
    assert "AFFILIATION" in batch_recip_types
    assert "ASSOCIATE" in batch_recip_types
    assert "PRESS" in batch_recip_types


def _register(client, h, s, **extra):
    res = client.post(f"{API}/members/", headers=h, json={
        "first_name_en": f"MagKind{s}", "mobile": "93" + s.zfill(8), "magazine_needed": True, **extra,
    })
    return res


def test_yes_puts_the_member_on_the_subscription_with_the_kind(client, admin_headers):
    h, s = admin_headers, _sfx()
    res = _register(client, h, s, magazine_kind="BOTH", magazine_email="reader@example.com", magazine_delivery_address="Sirsi")
    assert res.status_code in (200, 201), res.text
    mid = res.json()["id"]
    m = client.get(f"{API}/members/{mid}", headers=h).json()
    assert (m["magazine_kind"], m["magazine_email"]) == ("BOTH", "reader@example.com")
    subs = client.get(f"{API}/magazines/subscriptions", headers=h, params={"member_id": mid}).json()["data"]
    assert len(subs) == 1 and subs[0]["delivery_status"] == "ACTIVE"
    prof = client.get(f"{API}/members/{mid}/profile/magazine", headers=h).json()
    assert prof["magazine_kind"] == "BOTH" and prof["magazine_email"] == "reader@example.com"


def test_a_physical_copy_is_the_default_and_needs_no_email(client, admin_headers):
    h, s = admin_headers, _sfx()
    res = _register(client, h, s)
    assert res.status_code in (200, 201), res.text
    m = client.get(f"{API}/members/{res.json()['id']}", headers=h).json()
    assert m["magazine_kind"] == "PHYSICAL" and m["magazine_email"] is None


def test_an_e_copy_needs_an_email_and_has_no_address(client, admin_headers):
    h, s = admin_headers, _sfx()
    assert _register(client, h, s, magazine_kind="EMAIL").status_code == 400
    bad = _register(client, h, s, magazine_kind="PAPER")
    assert bad.status_code == 400
    ok = _register(client, h, s, magazine_kind="EMAIL", magazine_email="e@example.com", magazine_delivery_address="Ignored St")
    assert ok.status_code in (200, 201), ok.text
    m = client.get(f"{API}/members/{ok.json()['id']}", headers=h).json()
    assert m["magazine_kind"] == "EMAIL" and m["magazine_delivery_address"] is None


def _label_members(client, h, batch_id):
    body = client.get(f"{API}/magazines/label-batches/{batch_id}", headers=h).json()
    return [i["recipient_id"] for i in body["data"] if i["recipient_type"] == "MEMBER"]


def test_an_e_copy_member_gets_no_posted_label(client, admin_headers):
    h, s = admin_headers, _sfx()
    mid = _register(client, h, s, magazine_kind="EMAIL", magazine_email="e@example.com").json()["id"]
    labels = client.post(f"{API}/magazines/generate-labels", headers=h, params={"issue_month_year": "2026-07", "only_paid": False})
    assert labels.status_code in (200, 201), labels.text
    assert mid not in _label_members(client, h, labels.json()["batch_id"])
    # switching the same member to a posted copy puts them on the next list
    assert client.put(f"{API}/members/{mid}", headers=h, json={"magazine_kind": "PHYSICAL"}).status_code == 200
    again = client.post(f"{API}/magazines/generate-labels", headers=h, params={"issue_month_year": "2026-08", "only_paid": False})
    assert mid in _label_members(client, h, again.json()["batch_id"])


def test_the_profile_lists_the_members_pauses(client, admin_headers):
    h, s = admin_headers, _sfx()
    mid = _register(client, h, s, magazine_kind="PHYSICAL").json()["id"]
    sub = client.get(f"{API}/magazines/subscriptions", headers=h, params={"member_id": mid}).json()["data"][0]
    made = client.post(f"{API}/magazines/pauses", headers=h, json={
        "subscription_id": sub["id"], "pause_start_date": "2026-10-01", "pause_end_date": None, "reason": "returned twice",
    })
    assert made.status_code in (200, 201), made.text
    prof = client.get(f"{API}/members/{mid}/profile/magazine", headers=h).json()
    assert [p["reason"] for p in prof["pauses"]] == ["returned twice"]
    assert prof["pauses"][0]["pause_end_date"] is None


def test_an_issue_shows_as_sent_once_its_delivery_batch_is_dispatched(client, admin_headers):
    h, s = admin_headers, _sfx()
    mid = _register(client, h, s, magazine_kind="PHYSICAL").json()["id"]
    sub = client.get(f"{API}/magazines/subscriptions", headers=h, params={"member_id": mid}).json()["data"][0]
    year = 1990 + int(s) % 9      # a year no other test uses, so older batches cannot interfere
    issue = f"{year}-05"
    made = client.post(f"{API}/magazines/generate-labels", headers=h, params={"issue_month_year": issue, "only_paid": False})
    assert made.status_code in (200, 201), made.text

    def may():
        grid = client.get(f"{API}/magazines/subscriptions/{sub['id']}/monthly", headers=h, params={"year": year}).json()
        return grid["months"][4]

    assert may()["mark"] == "" and may()["sent"] is False          # labels printed, nothing dispatched yet
    batch = client.post(f"{API}/magazines/delivery-batches", headers=h, json={
        "batch_name": f"Dispatch {issue}", "issue_month_year": issue, "dispatch_date": f"{year}-05-03", "status": "PENDING",
    }).json()
    assert may()["mark"] == ""                                      # a pending batch is not a send
    assert client.put(f"{API}/magazines/delivery-batches/{batch['id']}", headers=h, json={"status": "DISPATCHED"}).status_code == 200
    assert may()["mark"] == "S" and may()["sent"] is True
    # a return still wins over the send
    assert client.post(f"{API}/magazines/returns", headers=h, json={
        "subscription_id": sub["id"], "issue_month_year": issue, "return_date": f"{year}-05-20",
    }).status_code in (200, 201)
    assert may()["mark"] == "R"


def test_the_delivery_history_lists_each_issue(client, admin_headers):
    h, s = admin_headers, _sfx()
    mid = _register(client, h, s, magazine_kind="PHYSICAL").json()["id"]
    sub = client.get(f"{API}/magazines/subscriptions", headers=h, params={"member_id": mid}).json()["data"][0]
    year = 1980 + int(s) % 9
    for month in (3, 4, 5):
        assert client.post(f"{API}/magazines/generate-labels", headers=h, params={"issue_month_year": f"{year}-{month:02d}", "only_paid": False}).status_code in (200, 201)
    batch = client.post(f"{API}/magazines/delivery-batches", headers=h, json={
        "batch_name": f"Dispatch {year}-03", "issue_month_year": f"{year}-03", "dispatch_date": f"{year}-03-04", "status": "DISPATCHED"}).json()
    assert batch["id"]
    assert client.post(f"{API}/magazines/returns", headers=h, json={
        "subscription_id": sub["id"], "issue_month_year": f"{year}-04", "return_date": f"{year}-04-20", "return_reason": "address wrong"}).status_code in (200, 201)
    got = client.get(f"{API}/magazines/subscriptions/{sub['id']}/history", headers=h).json()["issues"]
    by_issue = {i["issue_month_year"]: i for i in got if i["issue_month_year"].startswith(str(year))}
    assert by_issue[f"{year}-03"]["result"] == "SENT"
    assert by_issue[f"{year}-04"]["result"] == "RETURNED" and by_issue[f"{year}-04"]["detail"] == "address wrong"
    assert by_issue[f"{year}-05"]["result"] == "LISTED"
    assert [i["issue_month_year"] for i in got] == sorted((i["issue_month_year"] for i in got), reverse=True)
    prof = client.get(f"{API}/members/{mid}/profile/magazine", headers=h).json()
    assert {i["issue_month_year"] for i in prof["issues"]} >= {f"{year}-03", f"{year}-04", f"{year}-05"}
