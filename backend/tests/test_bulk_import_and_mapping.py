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

    # 6. Verify receipt status is now ASSIGNED / APPROVED
    rec_check = client.get(f"/api/v1/receipts/{receipt_id}", headers=admin_headers)
    assert rec_check.status_code == 200
    assert rec_check.json()["receipt_status"] in ("ASSIGNED", "APPROVED")


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
