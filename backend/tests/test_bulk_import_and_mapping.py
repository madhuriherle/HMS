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
