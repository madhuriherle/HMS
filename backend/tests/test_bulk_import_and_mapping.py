import pytest
from datetime import date


def test_bulk_member_import_and_receipt_auto_mapping(client, admin_headers):
    # 1. Create a receipt without a member (Unassigned) with payer_membership_no="LM-9999"
    receipt_res = client.post(
        "/api/v1/receipts/",
        headers=admin_headers,
        json={
            "receipt_number": "REC-TEST-9999",
            "receipt_date": str(date.today()),
            "receipt_type": "MEMBERSHIP",
            "payer_name": "Test Payer Live",
            "payment_mode": "CASH",
            "gross_amount": 2500,
            "net_amount": 2500,
            "payer_membership_no": "LM-9999",
            "payer_mobile": "9988776655",
            "items": [{"item_type": "MEMBERSHIP", "amount": 2500, "detail": "Membership Fee"}]
        }
    )
    assert receipt_res.status_code in (200, 201), receipt_res.text
    receipt_data = receipt_res.json()
    receipt_id = receipt_data["id"]
    assert receipt_data["receipt_status"] == "UNASSIGNED"

    # 2. Verify candidate list has this receipt as unmatched (match_type == "NONE")
    cand_res = client.get(
        "/api/v1/receipts/unassigned-candidates",
        headers=admin_headers,
        params={"search": "LM-9999"}
    )
    assert cand_res.status_code == 200, cand_res.text
    cand_data = cand_res.json()
    assert len(cand_data["candidates"]) >= 1
    found = [c for c in cand_data["candidates"] if c["receipt_id"] == receipt_id][0]
    assert found["match_type"] == "NONE"
    assert found["matched_member"] is None

    # 3. Bulk import the member with membership_number="LM-9999"
    import_res = client.post(
        "/api/v1/members/bulk-import",
        headers=admin_headers,
        json={
            "members": [
                {
                    "membership_number": "LM-9999",
                    "first_name_en": "Naveen",
                    "last_name_en": "Kumar",
                    "mobile": "9988776655",
                    "gender": "MALE",
                    "city": "Bengaluru"
                }
            ],
            "skip_duplicates": True
        }
    )
    assert import_res.status_code == 200, import_res.text
    import_data = import_res.json()
    assert import_data["success_count"] == 1

    # 4. Re-check candidate list - now it must match EXACT_NUMBER with Naveen Kumar!
    cand_res2 = client.get(
        "/api/v1/receipts/unassigned-candidates",
        headers=admin_headers,
        params={"search": "LM-9999"}
    )
    assert cand_res2.status_code == 200
    cand_data2 = cand_res2.json()
    matched_cand = [c for c in cand_data2["candidates"] if c["receipt_id"] == receipt_id][0]
    assert matched_cand["match_type"] == "EXACT_NUMBER"
    assert matched_cand["matched_member"] is not None
    assert "Naveen Kumar" in matched_cand["matched_member"]["name"]
    member_id = matched_cand["matched_member"]["id"]

    # 5. Bulk allocate the receipt to the matched member
    alloc_res = client.post(
        "/api/v1/receipts/bulk-allocate",
        headers=admin_headers,
        json={
            "allocations": [
                {"receipt_id": receipt_id, "member_id": member_id}
            ]
        }
    )
    assert alloc_res.status_code == 200, alloc_res.text
    assert alloc_res.json()["allocated_count"] == 1

    # 6. Verify receipt status is now ASSIGNED
    rec_check = client.get(f"/api/v1/receipts/{receipt_id}", headers=admin_headers)
    assert rec_check.status_code == 200
    assert rec_check.json()["receipt_status"] == "ASSIGNED"


def test_modules_seeded_and_gated(client, admin_headers):
    # 1. Unauthenticated calls must be rejected (401)
    unauth_res = client.post("/api/v1/members/bulk-import", json={"members": []})
    assert unauth_res.status_code in (401, 403)

    unauth_map = client.get("/api/v1/receipts/unassigned-candidates")
    assert unauth_map.status_code in (401, 403)

    unauth_alloc = client.post("/api/v1/receipts/bulk-allocate", json={"allocations": []})
    assert unauth_alloc.status_code in (401, 403)

    # 2. Check sidebar menu has Member Import and Bulk Receipt Mapping seeded
    menu_res = client.get("/api/v1/users/modules/menu", headers=admin_headers)
    assert menu_res.status_code == 200
    menu_data = menu_res.json()

    # Flatten menu routes
    routes = []
    def extract_routes(nodes):
        for n in nodes:
            if n.get("route"):
                routes.append(n["route"])
            if n.get("submodules"):
                extract_routes(n["submodules"])
    extract_routes(menu_data)

    assert "/dashboard/membership/import" in routes
    assert "/dashboard/receipts/bulk-mapping" in routes


def test_parked_receipt_is_mapped_to_a_member_created_after_it(client, admin_headers):
    """Receipt first, member later: the parked receipt is mapped by hand from the Unapproved list.

    This is the walk-in flow — a receipt is entered for someone who is not a member yet, with the number
    they were given typed onto it. The member is registered afterwards, so the money is still waiting.
    It cannot match on the number (a registered member has no membership number until approval, see
    test_bulk_mapping_ignores_the_mobile_number), so the Unapproved screen lists every parked receipt
    and maps the picked one to the applicant's id instead of opening the entry form again.
    """
    import uuid

    typed_number = "2315-" + uuid.uuid4().hex[:6].upper()
    payer_mobile = "9" + str(uuid.uuid4().int)[:9]

    # 1. The receipt is entered first, for a payer who is not a member yet
    receipt_res = client.post(
        "/api/v1/receipts/",
        headers=admin_headers,
        json={
            "receipt_date": str(date.today()),
            "receipt_type": "MEMBERSHIP",
            "payer_name": "Walk In Payer",
            "payment_mode": "CASH",
            "gross_amount": 1500,
            "net_amount": 1500,
            "payer_membership_no": typed_number,
            "payer_mobile": payer_mobile,
            "items": [{"item_type": "MEMBERSHIP", "amount": 1500, "detail": "Membership Fee"}],
        },
    )
    assert receipt_res.status_code in (200, 201), receipt_res.text
    receipt_id = receipt_res.json()["id"]
    assert receipt_res.json()["receipt_status"] == "UNASSIGNED"

    # 2. The member is registered afterwards: an id, but no membership number until approval
    member_res = client.post(
        "/api/v1/members/",
        headers=admin_headers,
        json={
            "first_name_en": "Later",
            "last_name_en": "Registrant",
            "mobile": "9" + str(uuid.uuid4().int)[:9],
            "gender": "Male",
        },
    )
    assert member_res.status_code in (200, 201), member_res.text
    member = member_res.json()
    member_id = member["id"]
    assert member.get("approval_status") == "UNAPPROVED"
    assert not member.get("member_code"), "a membership number is minted only at approval"

    # 3. The applicant is on the Unapproved list — the screen whose Assign button must offer the receipt
    listing = client.get(
        "/api/v1/members/",
        headers=admin_headers,
        params={"approval_status": "UNAPPROVED", "limit": 1000},
    )
    assert listing.status_code == 200, listing.text
    assert member_id in {m["id"] for m in listing.json()["data"]}

    # 4. The receipt entered earlier is still parked and offered, with no automatic match on the number
    cand_res = client.get(
        "/api/v1/receipts/unassigned-candidates",
        headers=admin_headers,
        params={"limit": 500},
    )
    assert cand_res.status_code == 200, cand_res.text
    parked = [c for c in cand_res.json()["candidates"] if c["receipt_id"] == receipt_id]
    assert parked, "a receipt entered before registration must still be listed for mapping"
    assert parked[0]["match_type"] == "NONE" and parked[0]["matched_member"] is None
    assert parked[0]["payer_membership_no"] == typed_number
    assert parked[0]["net_amount"] == 1500

    # 5. Mapping the picked receipt to this applicant (what the Assign modal's Map button sends)
    alloc_res = client.post(
        "/api/v1/receipts/bulk-allocate",
        headers=admin_headers,
        json={
            "allocations": [
                {
                    "receipt_id": receipt_id,
                    "member_id": member_id,
                    "allocated_amount": parked[0]["net_amount"],
                }
            ]
        },
    )
    assert alloc_res.status_code == 200, alloc_res.text
    assert alloc_res.json()["allocated_count"] == 1
    assert alloc_res.json()["failed_count"] == 0

    # 6. The register now links the money to the member, which is what flips the list row to Assigned
    track = client.get(
        "/api/v1/receipts/tracking",
        headers=admin_headers,
        params={"receipt_id": receipt_id, "limit": 1},
    ).json()
    row = track["data"][0]
    assert row["receipt_status"] == "ASSIGNED"
    assert row["member_id"] == member_id

    # 7. It is no longer offered for mapping
    after = client.get(
        "/api/v1/receipts/unassigned-candidates",
        headers=admin_headers,
        params={"limit": 500},
    ).json()
    assert receipt_id not in {c["receipt_id"] for c in after["candidates"]}


def test_bulk_mapping_ignores_the_mobile_number(client, admin_headers):
    """A receipt is matched on the membership number only: a member with the same mobile is not a match."""
    import uuid

    mobile = "9" + str(uuid.uuid4().int)[:9]
    member = client.post(
        "/api/v1/members/", headers=admin_headers,
        json={"first_name_en": "Same", "last_name_en": "Mobile", "mobile": mobile, "gender": "Male"},
    )
    assert member.status_code in (200, 201), member.text
    tag = "NOMATCH-" + uuid.uuid4().hex[:6].upper()
    receipt = client.post(
        "/api/v1/receipts/", headers=admin_headers,
        json={
            "receipt_date": "2026-10-13", "receipt_type": "MEMBERSHIP", "payer_name": "Someone Else",
            "payment_mode": "CASH", "gross_amount": 100, "net_amount": 100,
            "payer_membership_no": tag, "payer_mobile": mobile,
            "items": [{"item_type": "MEMBERSHIP", "amount": 100}],
        },
    )
    assert receipt.status_code in (200, 201), receipt.text
    rid = receipt.json()["id"]
    cands = client.get("/api/v1/receipts/unassigned-candidates", headers=admin_headers, params={"search": tag}).json()
    found = [c for c in cands["candidates"] if c["receipt_id"] == rid][0]
    assert found["match_type"] == "NONE" and found["matched_member"] is None


def test_bulk_import_history_records_who_imported_what(client, admin_headers):
    rows = [{"membership_number": "HIST9001", "first_name_en": "Hist One"}, {"membership_number": "HIST9002", "first_name_en": "Hist Two"}]
    base = {"skip_duplicates": True, "run_id": "histrun-1", "file_name": "members.csv", "total_rows": 3}
    assert client.post("/api/v1/members/bulk-import", headers=admin_headers, json={**base, "members": rows}).status_code == 200
    # second batch of the same file: one new, one already there
    again = [{"membership_number": "HIST9002", "first_name_en": "Hist Two"}, {"membership_number": "HIST9003", "first_name_en": "Hist Three"}]
    assert client.post("/api/v1/members/bulk-import", headers=admin_headers, json={**base, "members": again[:1]}).status_code == 200
    listing = client.get("/api/v1/members/import-history", headers=admin_headers).json()["data"]
    run = next(r for r in listing if r["file_name"] == "members.csv")
    assert run["success_count"] == 2 and run["skipped_count"] == 1 and run["processed_rows"] == 3
    assert run["status"] == "COMPLETED" and run["imported_by"] != "-"
    detail = client.get(f"/api/v1/members/import-history/{run['id']}", headers=admin_headers).json()
    assert detail["skipped"][0]["membership_number"] == "HIST9002"
    assert client.get("/api/v1/members/import-history").status_code in (401, 403)


def test_bulk_import_rules_for_duplicates_mobiles_and_names(client, admin_headers):
    def row(num, name, mobile=None, mtype=None):
        return {"membership_number": num, "first_name_en": name, "mobile": mobile, "membership_type": mtype}

    batch = [
        row("RUL001", "  SUJATA   BHAT, ", "+91 98452 49580"),         # spaces / comma / +91 cleaned
        row("RUL002", "FAMILY MEMBER", "9845249580"),                   # same mobile as RUL001: allowed, flagged
        row("RUL003", "SUJATA BHAT", "98452-49580"),                    # same name + mobile: possible duplicate person
        row("RUL001", "AGAIN", None),                                   # same number twice in one file: skipped
        row("RUL004", "LANDLINE", "080-23612047"),                      # landline: mobile left blank
        row("RUL005", "FOREIGN", "61432716266"),                        # not a mobile: left blank
        row("", "NO NUMBER", None),                                     # no number: skipped
        row("RUL006", "   ", None),                                     # no name: skipped
        row("RUL007", "NO MOBILE", None),                               # blank mobile is fine
        row("RUL008", "ODD TYPE", None, "No Such Type"),                # unknown type: default used, flagged
    ]
    # validate first: nothing is saved
    dry = client.post("/api/v1/members/bulk-import/validate", headers=admin_headers, json={"members": batch}).json()
    assert dry["dry_run"] is True and dry["success_count"] == 7
    assert client.get("/api/v1/members/", headers=admin_headers, params={"search": "RUL001"}).json()["data"] == []

    res = client.post("/api/v1/members/bulk-import", headers=admin_headers, json={"members": batch, "run_id": "rules-run", "file_name": "rules.csv", "total_rows": 10}).json()
    assert res["success_count"] == 7 and res["skipped_count"] == 3
    reasons = {s["membership_number"] or "-": s["reason"] for s in res["skipped"]}
    assert "earlier in this file" in reasons["RUL001"] and reasons["-"] == "Missing membership number" and reasons["RUL006"] == "Missing name"
    warn = {}
    for w in res["warnings"]:
        warn.setdefault(w["membership_number"], []).append(w["warning"])
    assert any("shared with" in w for w in warn["RUL002"])
    assert any("possible duplicate person" in w for w in warn["RUL003"])
    assert any("landline" in w for w in warn["RUL004"]) and any("not a valid mobile" in w for w in warn["RUL005"])
    assert any("not found" in w for w in warn["RUL008"]) and "RUL007" not in warn
    got = {m["member_code"]: m for m in client.get("/api/v1/members/", headers=admin_headers, params={"search": "RUL", "limit": 50}).json()["data"]}
    assert got["RUL001"]["mobile"] == "9845249580" and (got["RUL001"]["first_name_en"], got["RUL001"]["last_name_en"]) == ("SUJATA", "BHAT")
    assert got["RUL004"]["mobile"] is None and got["RUL005"]["mobile"] is None
    # running the same file again creates nothing new
    again = client.post("/api/v1/members/bulk-import", headers=admin_headers, json={"members": batch}).json()
    assert again["success_count"] == 0


def test_bulk_import_maps_gotra_spellings_to_the_master(client, admin_headers):
    from models.masters import Gotra
    from db.session import SessionLocal
    db = SessionLocal()
    try:
        if not db.query(Gotra).filter(Gotra.name_en == "Vasista", Gotra.is_deleted == False).first():  # noqa: E712
            db.add(Gotra(name_en="Vasista", status=True))
            db.commit()
        master_id = db.query(Gotra).filter(Gotra.name_en == "Vasista", Gotra.is_deleted == False).first().id  # noqa: E712
    finally:
        db.close()
    rows = [{"membership_number": f"GOT00{i}", "first_name_en": f"Gotra {i}", "gotra": g}
            for i, g in enumerate(["VASHISHTA", "vasistha", "GENERAL", "", "Zzyzx"], start=1)]
    res = client.post("/api/v1/members/bulk-import", headers=admin_headers, json={"members": rows}).json()
    assert res["success_count"] == 5
    assert [w["membership_number"] for w in res["warnings"] if "Gotra" in w["warning"]] == ["GOT005"]
    got = {m["member_code"]: m for m in client.get("/api/v1/members/", headers=admin_headers, params={"search": "GOT00", "limit": 20}).json()["data"]}
    assert got["GOT001"]["gotra_id"] == master_id and got["GOT002"]["gotra_id"] == master_id
    assert got["GOT001"]["gotra_text"] == "Vasista"
    assert got["GOT003"]["gotra_id"] is None and got["GOT003"]["gotra_text"] is None and got["GOT004"]["gotra_text"] is None
    assert got["GOT005"]["gotra_id"] is None and got["GOT005"]["gotra_text"] == "Zzyzx"


def test_bulk_import_splits_a_full_name_like_the_register_screen(client, admin_headers):
    rows = [{"membership_number": "NAM001", "first_name_en": "B.SEETHA  KESHAV BHAT"},
            {"membership_number": "NAM002", "first_name_en": "T.S.GOPALKRISHNA"},
            {"membership_number": "NAM003", "first_name_en": "Given Name", "last_name_en": "Family Name"}]
    assert client.post("/api/v1/members/bulk-import", headers=admin_headers, json={"members": rows}).json()["success_count"] == 3
    got = {m["member_code"]: m for m in client.get("/api/v1/members/", headers=admin_headers, params={"search": "NAM00", "limit": 10}).json()["data"]}
    assert (got["NAM001"]["first_name_en"], got["NAM001"]["middle_name_en"], got["NAM001"]["last_name_en"]) == ("B.SEETHA", "KESHAV", "BHAT")
    assert (got["NAM002"]["first_name_en"], got["NAM002"]["last_name_en"]) == ("T.S.GOPALKRISHNA", None)
    assert (got["NAM003"]["first_name_en"], got["NAM003"]["last_name_en"]) == ("Given Name", "Family Name")


def test_member_keeps_the_full_name_and_the_parts_together(client, admin_headers):
    rows = [{"membership_number": "FUL001", "first_name_en": "ZQX.SEETHA  KESHAV BHAT"}]
    assert client.post("/api/v1/members/bulk-import", headers=admin_headers, json={"members": rows}).json()["success_count"] == 1
    m = client.get("/api/v1/members/", headers=admin_headers, params={"search": "ZQX.SEETHA KESHAV"}).json()["data"]
    assert [x["member_code"] for x in m] == ["FUL001"] and m[0]["full_name_en"] == "ZQX.SEETHA KESHAV BHAT"
    # editing the parts rebuilds the full name; editing the full name re-splits the parts
    mid = m[0]["id"]
    assert client.put(f"/api/v1/members/{mid}", headers=admin_headers, json={"last_name_en": "HEGDE"}).status_code in (200, 202)
    got = client.get(f"/api/v1/members/{mid}", headers=admin_headers).json()
    assert got["full_name_en"] == "ZQX.SEETHA KESHAV HEGDE"
    assert client.put(f"/api/v1/members/{mid}", headers=admin_headers, json={"full_name_en": "Ravi Kumar Rao"}).status_code in (200, 202)
    got = client.get(f"/api/v1/members/{mid}", headers=admin_headers).json()
    assert (got["first_name_en"], got["middle_name_en"], got["last_name_en"]) == ("Ravi", "Kumar", "Rao")


def test_gotra_aliases_reach_the_real_gotra():
    from api.v1.endpoints.members import _GOTRA_ALIAS_KEYS, _gotra_key
    for alias, real in (("VSISHTA", "Vasista"), ("JAMADGNI", "Jamadagni"), ("KASHYPA", "Kashyapa"),
                        ("VISHVAMITRA", "Vishwamitra"), ("GUTHAMA", "Goutama"), ("MOUNBHARGHAVA", "Mouna Bharghava")):
        assert _GOTRA_ALIAS_KEYS.get(_gotra_key(alias), _gotra_key(alias)) == _gotra_key(real), alias
    # a gotra that is not a misspelling is never forced onto another one
    assert _gotra_key("BHARGAVA") not in {_gotra_key(g) for g in ("Vasista", "Vishwamitra", "Kashyapa", "Aangiras", "Goutama", "Jamadagni", "Bharadwaja", "Mouna Bharghava")}


def test_bulk_import_never_guesses_a_gender(client, admin_headers):
    rows = [{"membership_number": f"GEN00{i}", "first_name_en": f"Gender {i}", "gender": g}
            for i, g in enumerate([None, "", "f", "Female", "Other?"], start=1)]
    res = client.post("/api/v1/members/bulk-import", headers=admin_headers, json={"members": rows}).json()
    assert res["success_count"] == 5
    assert [w["membership_number"] for w in res["warnings"] if "Gender" in w["warning"]] == ["GEN005"]
    got = {m["member_code"]: m["gender"] for m in client.get("/api/v1/members/", headers=admin_headers, params={"search": "GEN00", "limit": 20}).json()["data"]}
    assert got == {"GEN001": None, "GEN002": None, "GEN003": "FEMALE", "GEN004": "FEMALE", "GEN005": None}
