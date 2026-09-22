"""End-to-end API tests against a throwaway SQLite database.

Covers the fixes in this pass:
  * audit logging actually writes user_activity_logs / member_activity_logs
  * login activity is recorded
  * RBAC: <module>.write enforced, SUPERADMIN bypass, permission grant flow
  * paginated envelope on every list endpoint
  * membership_type_id filter on the members list
  * approval flows write their history tables
  * timezone-aware reset-password comparisons
  * receipt number sequence
"""

import re
from datetime import date, datetime, timedelta, timezone

import pytest


# ─────────────── helpers ───────────────

def _create_member(client, headers, mobile, name="Member"):
    response = client.post(
        "/api/v1/members/",
        headers=headers,
        json={"first_name_en": name, "mobile": mobile},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _create_membership_type(client, headers, code, name):
    response = client.post(
        "/api/v1/masters/membership-types",
        headers=headers,
        json={"code": code, "name_en": name},
    )
    assert response.status_code == 200, response.text
    return response.json()


# ─────────────── smoke ───────────────

def test_health(client):
    response = client.get("/health")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "healthy"
    assert body["database"] == "ok"
    # request-id middleware must stamp every response
    assert response.headers.get("X-Request-ID")


def test_permission_catalog_seeded(client, admin_headers):
    response = client.get("/api/v1/users/permissions", headers=admin_headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert {"total", "page", "limit", "pages", "data"} <= set(body)
    codes = {p["code"] for p in body["data"]}
    assert {"members.write", "users.write", "approvals.write"} <= codes
    assert body["total"] >= 11


# ─────────────── audit logging ───────────────

def test_login_writes_activity_log(client):
    response = client.post(
        "/api/v1/auth/login",
        data={"username": "admin", "password": "admintest123"},
    )
    assert response.status_code == 200, response.text

    from db.session import SessionLocal
    from models.activity import UserActivityLog

    with SessionLocal() as db:
        row = (
            db.query(UserActivityLog)
            .filter(UserActivityLog.action == "LOGIN")
            .order_by(UserActivityLog.id.desc())
            .first()
        )
    assert row is not None, "LOGIN was not recorded"
    assert row.user_id is not None
    assert row.ip_address is not None


def test_member_create_writes_audit_trails(client, admin_headers):
    member = _create_member(client, admin_headers, "9000000001", "Audited")

    from db.session import SessionLocal
    from models.activity import MemberActivityLog, UserActivityLog

    with SessionLocal() as db:
        user_log = (
            db.query(UserActivityLog)
            .filter(
                UserActivityLog.entity_type == "members",
                UserActivityLog.entity_id == member["id"],
            )
            .order_by(UserActivityLog.id.desc())
            .first()
        )
        member_log = (
            db.query(MemberActivityLog)
            .filter(MemberActivityLog.member_id == member["id"])
            .order_by(MemberActivityLog.id.desc())
            .first()
        )

    assert user_log is not None, "no user_activity_logs row for the new member"
    assert user_log.action == "CREATE"
    assert user_log.user_id is not None
    assert member_log is not None, "no member_activity_logs row for the new member"
    assert member_log.action == "CREATE"


# ─────────────── members list ───────────────

def test_members_list_uses_paginated_envelope(client, admin_headers):
    _create_member(client, admin_headers, "9000000002", "Paged")
    response = client.get("/api/v1/members/", headers=admin_headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert isinstance(body, dict)
    assert {"total", "page", "limit", "pages", "data"} <= set(body)
    assert isinstance(body["data"], list)


def test_members_membership_type_filter(client, admin_headers):
    type_a = _create_membership_type(client, admin_headers, "TST_POSH", "Poshaka")
    type_b = _create_membership_type(client, admin_headers, "TST_MPOS", "Mahaposhaka")

    member_a = _create_member(client, admin_headers, "9000000003", "TypeA")
    member_b = _create_member(client, admin_headers, "9000000004", "TypeB")

    from db.session import SessionLocal
    from models.members import MemberMembership

    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        db.add(MemberMembership(
            member_id=member_a["id"], membership_type_id=type_a["id"],
            applied_at=now, status="ACTIVE",
        ))
        db.add(MemberMembership(
            member_id=member_b["id"], membership_type_id=type_b["id"],
            applied_at=now, status="ACTIVE",
        ))
        db.commit()

    response = client.get(
        "/api/v1/members/",
        headers=admin_headers,
        params={"membership_type_id": type_a["id"]},
    )
    assert response.status_code == 200, response.text
    ids = {m["id"] for m in response.json()["data"]}
    assert member_a["id"] in ids
    assert member_b["id"] not in ids


# ─────────────── RBAC ───────────────

def test_rbac_blocks_then_grants_writes(client, admin_headers):
    response = client.post(
        "/api/v1/users/",
        headers=admin_headers,
        json={
            "name": "Staff Member",
            "username": "staff_rbac",
            "password": "staffpass1",
            "user_type": "STAFF",
        },
    )
    assert response.status_code == 200, response.text
    staff_id = response.json()["id"]

    login = client.post(
        "/api/v1/auth/login",
        data={"username": "staff_rbac", "password": "staffpass1"},
    )
    assert login.status_code == 200, login.text
    staff_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    # reads are open to any authenticated user
    assert client.get("/api/v1/members/", headers=staff_headers).status_code == 200

    # writes are denied without the permission
    denied = client.post(
        "/api/v1/members/",
        headers=staff_headers,
        json={"first_name_en": "Nope"},
    )
    assert denied.status_code == 403, denied.text
    assert "members.write" in denied.json()["detail"]

    # SUPERADMIN bypasses the permission check (this call succeeds)
    assert _create_member(client, admin_headers, "9000000005", "Super")["id"]

    # grant the permission through a role and retry
    role = client.post(
        "/api/v1/users/roles",
        headers=admin_headers,
        json={"name": "Member Admin", "code": "MEMBER_ADMIN"},
    )
    assert role.status_code == 200, role.text

    grant = client.post(
        f"/api/v1/users/roles/{role.json()['id']}/permissions",
        headers=admin_headers,
        params={"code": "members.write"},
    )
    assert grant.status_code == 200, grant.text

    assigned = client.post(
        f"/api/v1/users/{staff_id}/assign-role",
        headers=admin_headers,
        params={"role_id": role.json()["id"]},
    )
    assert assigned.status_code == 200, assigned.text

    allowed = client.post(
        "/api/v1/members/",
        headers=staff_headers,
        json={"first_name_en": "Now Allowed", "mobile": "9000000006"},
    )
    assert allowed.status_code == 200, allowed.text

    # assigning the same role twice is idempotent (DB unique index backs it)
    again = client.post(
        f"/api/v1/users/{staff_id}/assign-role",
        headers=admin_headers,
        params={"role_id": role.json()["id"]},
    )
    assert again.status_code == 200, again.text
    assert "already assigned" in again.json()["message"]


def test_users_static_routes_not_shadowed_by_id(client, admin_headers):
    """GET /users/roles must not be swallowed by GET /users/{id}."""
    for path in ("/api/v1/users/roles", "/api/v1/users/permissions"):
        response = client.get(path, headers=admin_headers)
        assert response.status_code == 200, f"{path}: {response.text}"
        assert "data" in response.json()


# ─────────────── approvals & history ───────────────

def test_member_approval_writes_history(client, admin_headers):
    member = _create_member(client, admin_headers, "9000000007", "Approve")

    response = client.put(
        f"/api/v1/members/{member['id']}/approve", headers=admin_headers
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["approval_status"] == "APPROVED"
    assert body["member_code"]

    from db.session import SessionLocal
    from models.members import MemberApprovalHistory

    with SessionLocal() as db:
        history = (
            db.query(MemberApprovalHistory)
            .filter(MemberApprovalHistory.member_id == member["id"])
            .order_by(MemberApprovalHistory.id.desc())
            .first()
        )
    assert history is not None, "approve did not write member_approval_history"
    assert history.action == "APPROVE"
    assert history.new_status == "APPROVED"


def test_membership_type_change_approval_writes_history(client, admin_headers):
    type_a = _create_membership_type(client, admin_headers, "TST_TYP_A", "Type A")
    type_b = _create_membership_type(client, admin_headers, "TST_TYP_B", "Type B")

    from db.session import SessionLocal
    from models.masters import MembershipTypePrice
    from models.members import (
        MemberMembership,
        MembershipTypeChangeRequest,
        MembershipTypeHistory,
    )

    with SessionLocal() as db:
        db.add(MembershipTypePrice(
            membership_type_id=type_a["id"], amount=100,
            effective_from=date(2026, 1, 1),
        ))
        db.add(MembershipTypePrice(
            membership_type_id=type_b["id"], amount=250,
            effective_from=date(2026, 1, 1),
        ))
        db.commit()

    member = _create_member(client, admin_headers, "9000000008", "TypeChange")

    with SessionLocal() as db:
        membership = MemberMembership(
            member_id=member["id"], membership_type_id=type_a["id"],
            applied_at=datetime.now(timezone.utc), status="ACTIVE",
        )
        db.add(membership)
        db.flush()
        change = MembershipTypeChangeRequest(
            member_id=member["id"],
            current_membership_id=membership.id,
            requested_type_id=type_b["id"],
            reason="Upgrade",
            status="PENDING",
        )
        db.add(change)
        db.commit()
        change_id = change.id
        membership_id = membership.id

    response = client.put(
        f"/api/v1/approvals/type-changes/{change_id}/approve",
        headers=admin_headers,
    )
    assert response.status_code == 200, response.text
    receipt_id = response.json().get("receipt_id")
    assert receipt_id, "type-change approval must mint a receipt for the upgrade"

    from models.receipts import Receipt

    with SessionLocal() as db:
        history = (
            db.query(MembershipTypeHistory)
            .filter(MembershipTypeHistory.membership_id == membership_id)
            .order_by(MembershipTypeHistory.id.desc())
            .first()
        )
        membership = db.query(MemberMembership).filter(
            MemberMembership.id == membership_id
        ).first()
        receipt = db.get(Receipt, receipt_id)

    assert history is not None, "type change approval wrote no history"
    assert history.old_type_id == type_a["id"]
    assert history.new_type_id == type_b["id"]
    assert float(history.old_price) == 100.0
    assert float(history.new_price) == 250.0
    assert history.receipt_id == receipt_id
    assert membership.membership_type_id == type_b["id"]

    # receipt covers the upgrade difference (250 - 100) and starts unpaid
    assert receipt is not None
    assert float(receipt.net_amount) == 150.0
    assert receipt.payment_status == "PENDING"


def test_profile_change_approval_applies_and_records(client, admin_headers):
    member = _create_member(client, admin_headers, "9000000009", "Profile")

    response = client.post(
        "/api/v1/members/profile-changes/",
        headers=admin_headers,
        json={"member_id": member["id"], "new_values": {"mobile": "9911991199"}},
    )
    assert response.status_code == 200, response.text
    request_id = response.json()["id"]

    response = client.put(
        f"/api/v1/approvals/profile-changes/{request_id}/approve",
        headers=admin_headers,
    )
    assert response.status_code == 200, response.text

    from db.session import SessionLocal
    from models.members import Member, MemberProfileHistory

    with SessionLocal() as db:
        updated = db.query(Member).filter(Member.id == member["id"]).first()
        history = (
            db.query(MemberProfileHistory)
            .filter(MemberProfileHistory.member_id == member["id"])
            .order_by(MemberProfileHistory.id.desc())
            .first()
        )

    assert updated.mobile == "9911991199"
    assert history is not None
    assert history.field_name == "mobile"
    assert history.new_value == "9911991199"


def test_deletion_request_approval_soft_deletes(client, admin_headers):
    member = _create_member(client, admin_headers, "9000000010", "Doomed")

    response = client.post(
        "/api/v1/approvals/deletion-requests",
        headers=admin_headers,
        params={"member_id": member["id"], "reason": "requested by member"},
    )
    assert response.status_code == 200, response.text

    from db.session import SessionLocal
    from models.members import Member, MemberApprovalHistory, MemberDeletionRequest

    with SessionLocal() as db:
        request = (
            db.query(MemberDeletionRequest)
            .filter(MemberDeletionRequest.member_id == member["id"])
            .order_by(MemberDeletionRequest.id.desc())
            .first()
        )
        request_id = request.id

    response = client.put(
        f"/api/v1/approvals/deletion-requests/{request_id}/approve",
        headers=admin_headers,
    )
    assert response.status_code == 200, response.text

    with SessionLocal() as db:
        deleted = db.query(Member).filter(Member.id == member["id"]).first()
        history = (
            db.query(MemberApprovalHistory)
            .filter(
                MemberApprovalHistory.member_id == member["id"],
                MemberApprovalHistory.action == "DELETE",
            )
            .first()
        )

    assert deleted.is_deleted is True
    assert history is not None, "deletion approval wrote no member_approval_history"


# ─────────────── auth / timezone ───────────────

def test_password_reset_roundtrip(client, admin_headers, monkeypatch):
    import services.whatsapp as whatsapp

    async def _no_send(*args, **kwargs):
        return {"ok": True}

    monkeypatch.setattr(whatsapp.whatsapp_service, "send_message", _no_send)

    response = client.post(
        "/api/v1/users/",
        headers=admin_headers,
        json={
            "name": "Mobile User",
            "username": "mobile_user",
            "password": "oldpass123",
            "user_type": "STAFF",
            "mobile": "9845000001",
        },
    )
    assert response.status_code == 200, response.text

    response = client.post(
        "/api/v1/auth/forgot-password", json={"mobile": "9845000001"}
    )
    assert response.status_code == 200, response.text

    from db.session import SessionLocal
    from models.system import PasswordResetToken

    with SessionLocal() as db:
        reset = (
            db.query(PasswordResetToken)
            .order_by(PasswordResetToken.id.desc())
            .first()
        )
        token = reset.token

    # weak passwords are rejected before the token is consumed
    response = client.post(
        "/api/v1/auth/reset-password",
        json={"token": token, "new_password": "short"},
    )
    assert response.status_code == 400, response.text

    response = client.post(
        "/api/v1/auth/reset-password",
        json={"token": token, "new_password": "brandnew123"},
    )
    assert response.status_code == 200, response.text

    # unknown token → clean 400 (never a naive/aware TypeError)
    response = client.post(
        "/api/v1/auth/reset-password",
        json={"token": "nope", "new_password": "whatever123"},
    )
    assert response.status_code == 400, response.text

    # already used token → 400
    response = client.post(
        "/api/v1/auth/reset-password",
        json={"token": token, "new_password": "again123"},
    )
    assert response.status_code == 400, response.text

    login = client.post(
        "/api/v1/auth/login",
        data={"username": "mobile_user", "password": "brandnew123"},
    )
    assert login.status_code == 200, login.text


# ─────────────── receipts ───────────────

def test_receipt_creation_and_sequence(client, admin_headers):
    payload = {
        "receipt_date": date.today().isoformat(),
        "receipt_type": "MEMBERSHIP",
        "payment_mode": "CASH",
        "payer_name": "Sequence Test",
        "gross_amount": 500,
        "discount_amount": 0,
        "net_amount": 500,
        "items": [{"item_type": "MEMBERSHIP", "amount": 500}],
    }
    first = client.post("/api/v1/receipts/", headers=admin_headers, json=payload)
    second = client.post("/api/v1/receipts/", headers=admin_headers, json=payload)
    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text

    number_1 = first.json()["receipt_number"]
    number_2 = second.json()["receipt_number"]
    pattern = r"^REC-\d{8}-\d{6}$"
    assert re.match(pattern, number_1), number_1
    assert re.match(pattern, number_2), number_2
    assert number_1 != number_2


# ─────────────── write endpoints (ORM serialisation) ───────────────

def test_engagement_write_endpoints_serialize(client, admin_headers):
    associate = client.post(
        "/api/v1/engagements/associates",
        headers=admin_headers,
        params={"name": "Assoc One", "organization": "Havyaka Group"},
    )
    assert associate.status_code == 200, associate.text
    assert associate.json()["id"]

    press = client.post(
        "/api/v1/engagements/press-media",
        headers=admin_headers,
        params={"organization_name": "Press One"},
    )
    assert press.status_code == 200, press.text
    assert press.json()["id"]

    category = client.post(
        "/api/v1/engagements/committee/categories",
        headers=admin_headers,
        params={"name_en": "Bengaluru constituency"},
    )
    assert category.status_code == 200, category.text

    term = client.post(
        "/api/v1/engagements/committee/terms",
        headers=admin_headers,
        params={"term_name": "2026-2029", "is_current": "true"},
    )
    assert term.status_code == 200, term.text
    assert term.json()["is_current"] is True

    member = client.post(
        "/api/v1/engagements/committee/members",
        headers=admin_headers,
        params={"category_id": category.json()["id"], "member_name": "Office Bearer"},
    )
    assert member.status_code == 200, member.text
    assert member.json()["member_name"] == "Office Bearer"

    updated = client.put(
        f"/api/v1/engagements/associates/{associate.json()['id']}",
        headers=admin_headers,
        params={"magazine_enabled": "false"},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["magazine_enabled"] is False


def test_receipt_refund_and_payment_transaction_serialize(client, admin_headers):
    receipt = client.post(
        "/api/v1/receipts/",
        headers=admin_headers,
        json={
            "receipt_date": date.today().isoformat(),
            "receipt_type": "MEMBERSHIP",
            "payment_mode": "CASH",
            "gross_amount": 100,
            "discount_amount": 0,
            "net_amount": 100,
            "items": [{"item_type": "MEMBERSHIP", "amount": 100}],
        },
    )
    assert receipt.status_code == 200, receipt.text
    receipt_id = receipt.json()["id"]

    refund = client.post(
        f"/api/v1/receipts/{receipt_id}/refund",
        headers=admin_headers,
        json={"amount": 50, "status": "PENDING"},
    )
    assert refund.status_code == 200, refund.text
    assert refund.json()["amount"] == 50

    payment = client.post(
        f"/api/v1/receipts/{receipt_id}/payment-transactions",
        headers=admin_headers,
        json={"status": "SUCCESS", "amount": 100, "gateway_reference": "GW-1"},
    )
    assert payment.status_code == 200, payment.text
    assert payment.json()["gateway_reference"] == "GW-1"


def test_delivery_batch_and_member_document_serialize(client, admin_headers):
    batch = client.post(
        "/api/v1/magazines/delivery-batches",
        headers=admin_headers,
        json={"batch_name": "Jan 2026", "issue_month_year": "2026-01"},
    )
    assert batch.status_code == 200, batch.text
    assert batch.json()["id"]

    doc_type = client.post(
        "/api/v1/masters/document-types",
        headers=admin_headers,
        json={"code": "TST_ID_PROOF", "name_en": "ID proof"},
    )
    assert doc_type.status_code == 200, doc_type.text

    member = _create_member(client, admin_headers, "9000000011", "Uploader")
    upload = client.post(
        "/api/v1/members/documents/",
        headers=admin_headers,
        params={"member_id": member["id"], "document_type_id": doc_type.json()["id"]},
        files={"file": ("id.png", b"\x89PNG\r\n\x1a\n0123456789", "image/png")},
    )
    assert upload.status_code == 200, upload.text
    assert upload.json()["original_filename"] == "id.png"

    deleted = client.delete(
        f"/api/v1/masters/states/{_dummy_state(client, admin_headers)}",
        headers=admin_headers,
    )
    assert deleted.status_code == 200, deleted.text


def _dummy_state(client, headers):
    state = client.post(
        "/api/v1/masters/states", headers=headers, json={"name_en": "Delete Me"}
    )
    assert state.status_code == 200, state.text
    return state.json()["id"]


# ─────────────── masters: geography & membership types ───────────────

def _create_district(client, headers, state_id, name):
    response = client.post(
        "/api/v1/masters/districts",
        headers=headers,
        json={"state_id": state_id, "name_en": name},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _create_taluk(client, headers, district_id, name):
    response = client.post(
        "/api/v1/masters/taluks",
        headers=headers,
        json={"district_id": district_id, "name_en": name},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_state_full_lifecycle(client, admin_headers):
    created = client.post(
        "/api/v1/masters/states", headers=admin_headers, json={"name_en": "Test Nadu", "code": "TN-X"}
    )
    assert created.status_code == 200, created.text
    state = created.json()

    # duplicate name is rejected
    dup = client.post(
        "/api/v1/masters/states", headers=admin_headers, json={"name_en": "Test Nadu"}
    )
    assert dup.status_code == 409, dup.text

    # get one works
    got = client.get(f"/api/v1/masters/states/{state['id']}", headers=admin_headers)
    assert got.status_code == 200, got.text
    assert got.json()["name_en"] == "Test Nadu"

    # update works
    upd = client.put(
        f"/api/v1/masters/states/{state['id']}", headers=admin_headers, json={"name_kn": "ಟೆಸ್ಟ್ ನಾಡು"}
    )
    assert upd.status_code == 200, upd.text
    assert upd.json()["name_kn"] == "ಟೆಸ್ಟ್ ನಾಡು"

    # rename to another state's name is rejected
    client.post("/api/v1/masters/states", headers=admin_headers, json={"name_en": "Other Nadu"})
    clash = client.put(
        f"/api/v1/masters/states/{state['id']}", headers=admin_headers, json={"name_en": "Other Nadu"}
    )
    assert clash.status_code == 409, clash.text

    # delete blocked while districts exist
    district = _create_district(client, admin_headers, state["id"], "Test District")
    blocked = client.delete(f"/api/v1/masters/states/{state['id']}", headers=admin_headers)
    assert blocked.status_code == 409, blocked.text

    # delete blocked while postal codes reference the district
    pc = client.post(
        "/api/v1/masters/postal-codes",
        headers=admin_headers,
        json={"pincode": "580001", "state_id": state["id"], "district_id": district["id"]},
    )
    assert pc.status_code == 200, pc.text
    blocked2 = client.delete(f"/api/v1/masters/districts/{district['id']}", headers=admin_headers)
    assert blocked2.status_code == 409, blocked2.text

    # taluk references checked on postal code create
    bad_taluk = client.post(
        "/api/v1/masters/postal-codes",
        headers=admin_headers,
        json={"pincode": "580002", "state_id": state["id"], "district_id": district["id"], "taluk_id": 999999},
    )
    assert bad_taluk.status_code == 400, bad_taluk.text

    # clean up in hierarchy order
    assert client.delete(f"/api/v1/masters/postal-codes/{pc.json()['id']}", headers=admin_headers).status_code == 200
    assert client.delete(f"/api/v1/masters/districts/{district['id']}", headers=admin_headers).status_code == 200
    assert client.delete(f"/api/v1/masters/states/{state['id']}", headers=admin_headers).status_code == 200

    # gone from the list afterwards
    listing = client.get("/api/v1/masters/states", headers=admin_headers, params={"search": "Test Nadu"})
    assert listing.json()["total"] == 0


def test_district_taluk_crud_and_hierarchy(client, admin_headers):
    state = client.post(
        "/api/v1/masters/states", headers=admin_headers, json={"name_en": "Hier Nadu"}
    ).json()
    district = _create_district(client, admin_headers, state["id"], "Hier District")
    taluk = _create_taluk(client, admin_headers, district["id"], "Hier Taluk")

    # duplicate district in the same state rejected
    dup_d = client.post(
        "/api/v1/masters/districts",
        headers=admin_headers,
        json={"state_id": state["id"], "name_en": "Hier District"},
    )
    assert dup_d.status_code == 409, dup_d.text

    # duplicate taluk in the same district rejected, other district fine
    dup_t = client.post(
        "/api/v1/masters/taluks",
        headers=admin_headers,
        json={"district_id": district["id"], "name_en": "Hier Taluk"},
    )
    assert dup_t.status_code == 409, dup_t.text

    # unknown parents rejected
    assert client.post(
        "/api/v1/masters/districts", headers=admin_headers, json={"state_id": 999999, "name_en": "X"}
    ).status_code == 400
    assert client.post(
        "/api/v1/masters/taluks", headers=admin_headers, json={"district_id": 999999, "name_en": "X"}
    ).status_code == 400

    # taluk update + move to a new district
    district2 = _create_district(client, admin_headers, state["id"], "Hier District 2")
    moved = client.put(
        f"/api/v1/masters/taluks/{taluk['id']}",
        headers=admin_headers,
        json={"district_id": district2["id"], "name_en": "Hier Taluk Moved"},
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["district_id"] == district2["id"]

    # taluk delete blocked while referenced by postal code
    pc = client.post(
        "/api/v1/masters/postal-codes",
        headers=admin_headers,
        json={
            "pincode": "581001",
            "state_id": state["id"],
            "district_id": district2["id"],
            "taluk_id": taluk["id"],
        },
    )
    assert pc.status_code == 200, pc.text
    blocked = client.delete(f"/api/v1/masters/taluks/{taluk['id']}", headers=admin_headers)
    assert blocked.status_code == 409, blocked.text

    assert client.delete(f"/api/v1/masters/postal-codes/{pc.json()['id']}", headers=admin_headers).status_code == 200
    assert client.delete(f"/api/v1/masters/taluks/{taluk['id']}", headers=admin_headers).status_code == 200

    # postal-code update revalidates the taluk/district pairing
    pc2 = client.post(
        "/api/v1/masters/postal-codes",
        headers=admin_headers,
        json={"pincode": "581002", "state_id": state["id"], "district_id": district["id"]},
    )
    assert pc2.status_code == 200, pc2.text
    mismatch = client.put(
        f"/api/v1/masters/postal-codes/{pc2.json()['id']}",
        headers=admin_headers,
        json={"taluk_id": taluk["id"]},  # taluk lives in district2, not district
    )
    assert mismatch.status_code == 400, mismatch.text

    filters = client.get(
        "/api/v1/masters/postal-codes",
        headers=admin_headers,
        params={"pincode": "581", "state_id": state["id"], "district_id": district["id"]},
    )
    assert filters.status_code == 200, filters.text
    assert filters.json()["total"] == 1


def test_postal_code_template_and_validation(client, admin_headers):
    tpl = client.get("/api/v1/masters/postal-codes/template", headers=admin_headers)
    assert tpl.status_code == 200, tpl.text
    assert "postal_codes_template.csv" in tpl.headers["Content-Disposition"]
    assert b"pincode,post_office_name,state_id,district_id,taluk_id" in tpl.content

    bad_pin = client.post(
        "/api/v1/masters/postal-codes",
        headers=admin_headers,
        json={"pincode": "5810", "state_id": 1, "district_id": 1},
    )
    assert bad_pin.status_code == 422, bad_pin.text

    assert client.get(
        "/api/v1/masters/postal-codes/999999", headers=admin_headers
    ).status_code == 404


def test_postal_code_import_validation_and_upsert(client, admin_headers):
    state = client.post(
        "/api/v1/masters/states", headers=admin_headers, json={"name_en": "Import Nadu"}
    ).json()
    district = _create_district(client, admin_headers, state["id"], "Import District")
    taluk = _create_taluk(client, admin_headers, district["id"], "Import Taluk")

    csv_content = (
        "pincode,post_office_name,state_id,district_id,taluk_id\n"
        "577001,Office A,{s},{d},{t}\n"
        "577001,Office B,{s},{d},\n"
        "57700,Office C,{s},{d},{t}\n"          # invalid pincode
        "577002,Office D,999999,{d},\n"          # unknown state
        "577003,Office E,{s},999999,\n"          # unknown district
        "577004,Office F,{s},{d},999999\n"       # taluk from another district
        "577001,Office A,{s},{d},\n"             # duplicate in-file, updates first
    ).format(s=state["id"], d=district["id"], t=taluk["id"])

    first = client.post(
        "/api/v1/imports/postal-codes/import",
        headers=admin_headers,
        files={"file": ("pincodes.csv", csv_content.encode("utf-8"), "text/csv")},
    )
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["inserted"] == 2, body
    assert body["skipped"] == 4, body

    # second import updates geography instead of duplicating
    csv_update = (
        "pincode,post_office_name,state_id,district_id\n"
        "577001,Office A,{s},{d}\n"
    ).format(s=state["id"], d=district["id"])
    second = client.post(
        "/api/v1/imports/postal-codes/import",
        headers=admin_headers,
        files={"file": ("pincodes.csv", csv_update.encode("utf-8"), "text/csv")},
    )
    assert second.status_code == 200, second.text
    assert second.json()["updated"] == 1, second.json()

    listing = client.get(
        "/api/v1/masters/postal-codes",
        headers=admin_headers,
        params={"pincode": "577001"},
    )
    offices = {row["post_office_name"] for row in listing.json()["data"]}
    assert offices == {"Office A", "Office B"}

    # name-based import resolves geography by name
    csv_names = (
        "pincode,post_office_name,state_name_en,district_name_en,taluk_name_en\n"
        "577005,Office G,Import Nadu,Import District,Import Taluk\n"
    )
    third = client.post(
        "/api/v1/imports/postal-codes/import",
        headers=admin_headers,
        files={"file": ("pincodes.csv", csv_names.encode("utf-8"), "text/csv")},
    )
    assert third.status_code == 200, third.text
    assert third.json()["inserted"] == 1, third.json()


def test_membership_type_price_history_flow(client, admin_headers):
    mt = _create_membership_type(client, admin_headers, "TST_PRICE", "Pricey Type")
    mt_id = mt["id"]

    # new type has no price
    got = client.get(f"/api/v1/masters/membership-types/{mt_id}", headers=admin_headers)
    assert got.status_code == 200, got.text
    assert got.json()["current_price"] is None
    assert client.get(
        f"/api/v1/masters/membership-types/{mt_id}/prices/current", headers=admin_headers
    ).status_code == 404

    # set first price
    p1 = client.post(
        f"/api/v1/masters/membership-types/{mt_id}/prices",
        headers=admin_headers,
        json={"amount": 100, "change_reason": "initial price"},
    )
    assert p1.status_code == 200, p1.text
    p1_id = p1.json()["id"]
    assert p1.json()["effective_to"] is None

    # current price reflects it
    cur = client.get(
        f"/api/v1/masters/membership-types/{mt_id}/prices/current", headers=admin_headers
    )
    assert cur.status_code == 200, cur.text
    assert float(cur.json()["amount"]) == 100.0

    # raise the price — old row closes, new row opens (explicit future effective date)
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    p2 = client.post(
        f"/api/v1/masters/membership-types/{mt_id}/prices",
        headers=admin_headers,
        json={"amount": 250, "change_reason": "AGM revision", "effective_from": tomorrow},
    )
    assert p2.status_code == 200, p2.text
    p2_id = p2.json()["id"]

    # price history shows both rows, newest effective first
    history = client.get(
        f"/api/v1/masters/membership-types/{mt_id}/prices", headers=admin_headers
    )
    assert history.status_code == 200, history.text
    rows = history.json()["data"]
    assert len(rows) == 2
    assert rows[0]["id"] == p2_id
    assert rows[0]["effective_to"] is None
    assert rows[1]["id"] == p1_id
    assert rows[1]["effective_to"] is not None  # closed by the new price
    assert rows[1]["change_reason"] == "initial price"

    # type listing includes the current price
    listing = client.get(
        "/api/v1/masters/membership-types", headers=admin_headers, params={"search": "Pricey"}
    )
    item = [t for t in listing.json()["data"] if t["id"] == mt_id][0]
    assert float(item["current_price"]) == 250.0

    # negative amount rejected
    neg = client.post(
        f"/api/v1/masters/membership-types/{mt_id}/prices",
        headers=admin_headers,
        json={"amount": -5},
    )
    assert neg.status_code == 422, neg.text

    # same-day reprice updates today's row in place instead of adding a duplicate
    same_day = client.post(
        f"/api/v1/masters/membership-types/{mt_id}/prices",
        headers=admin_headers,
        json={"amount": 125, "change_reason": "typo fix"},
    )
    assert same_day.status_code == 200, same_day.text
    assert same_day.json()["id"] == p2_id or same_day.json()["id"] == p1_id
    history_after = client.get(
        f"/api/v1/masters/membership-types/{mt_id}/prices", headers=admin_headers
    )
    assert history_after.json()["total"] == 2  # still two rows, no duplicate

    # price correction on a closed row works
    fix = client.put(
        f"/api/v1/masters/membership-types/{mt_id}/prices/{p1_id}",
        headers=admin_headers,
        json={"amount": 110},
    )
    assert fix.status_code == 200, fix.text
    assert float(fix.json()["amount"]) == 110.0

    # delete blocked while members hold this type
    member = _create_member(client, admin_headers, "9000000040", "TypeHolder")
    from db.session import SessionLocal
    from models.members import MemberMembership

    with SessionLocal() as db:
        db.add(MemberMembership(
            member_id=member["id"], membership_type_id=mt_id,
            applied_at=datetime.now(timezone.utc), status="ACTIVE",
        ))
        db.commit()

    blocked = client.delete(f"/api/v1/masters/membership-types/{mt_id}", headers=admin_headers)
    assert blocked.status_code == 409, blocked.text

    # duplicate code rejected
    dup = client.post(
        "/api/v1/masters/membership-types",
        headers=admin_headers,
        json={"code": "TST_PRICE", "name_en": "Another"},
    )
    assert dup.status_code == 409, dup.text


def test_membership_type_delete_unused_succeeds(client, admin_headers):
    mt = _create_membership_type(client, admin_headers, "TST_DELTYPE", "Deletable Type")
    deleted = client.delete(
        f"/api/v1/masters/membership-types/{mt['id']}", headers=admin_headers
    )
    assert deleted.status_code == 200, deleted.text
    assert client.get(
        f"/api/v1/masters/membership-types/{mt['id']}", headers=admin_headers
    ).status_code == 404


# ─────────────── users: roles & privileges ───────────────

def test_role_lifecycle_with_privilege_configuration(client, admin_headers):
    role = client.post(
        "/api/v1/users/roles",
        headers=admin_headers,
        json={"name": "Masters Manager", "code": "MASTERS_MGR"},
    )
    assert role.status_code == 200, role.text
    role_id = role.json()["id"]

    # detail starts empty
    detail = client.get(f"/api/v1/users/roles/{role_id}", headers=admin_headers)
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert body["permission_codes"] == []
    assert body["user_count"] == 0

    # bulk-configure privileges in one call
    configured = client.put(
        f"/api/v1/users/roles/{role_id}/permissions",
        headers=admin_headers,
        json={"permission_codes": ["masters.write", "members.write", "imports.write"]},
    )
    assert configured.status_code == 200, configured.text
    conf_body = configured.json()
    assert sorted(conf_body["granted"]) == ["imports.write", "masters.write", "members.write"]
    assert sorted(conf_body["permission_codes"]) == ["imports.write", "masters.write", "members.write"]

    # unknown permission code rejected
    unknown = client.put(
        f"/api/v1/users/roles/{role_id}/permissions",
        headers=admin_headers,
        json={"permission_codes": ["masters.write", "nope.write"]},
    )
    assert unknown.status_code == 400, unknown.text

    # re-sync with a different set revokes the absent ones
    resync = client.put(
        f"/api/v1/users/roles/{role_id}/permissions",
        headers=admin_headers,
        json={"permission_codes": ["masters.write"]},
    )
    assert resync.status_code == 200, resync.text
    assert sorted(resync.json()["revoked"]) == ["imports.write", "members.write"]
    assert resync.json()["permission_codes"] == ["masters.write"]

    # roles listing carries permission_codes + user_count
    listing = client.get("/api/v1/users/roles", headers=admin_headers)
    row = [r for r in listing.json()["data"] if r["id"] == role_id][0]
    assert row["permission_codes"] == ["masters.write"]
    assert row["user_count"] == 0

    # delete blocked while a user holds the role
    staff = client.post(
        "/api/v1/users/",
        headers=admin_headers,
        json={"name": "Role Holder", "username": "role_holder", "password": "holderpass1", "user_type": "STAFF"},
    )
    assert staff.status_code == 200, staff.text
    staff_id = staff.json()["id"]
    assigned = client.post(
        f"/api/v1/users/{staff_id}/assign-role",
        headers=admin_headers,
        params={"role_id": role_id},
    )
    assert assigned.status_code == 200, assigned.text

    blocked = client.delete(f"/api/v1/users/roles/{role_id}", headers=admin_headers)
    assert blocked.status_code == 409, blocked.text

    # deactivating an in-use role is blocked too
    deactivate = client.put(
        f"/api/v1/users/roles/{role_id}", headers=admin_headers, json={"status": False}
    )
    assert deactivate.status_code == 409, deactivate.text

    # remove the assignment, then delete succeeds
    removed = client.delete(
        f"/api/v1/users/{staff_id}/roles/{role_id}", headers=admin_headers
    )
    assert removed.status_code == 200, removed.text
    assert client.delete(f"/api/v1/users/roles/{role_id}", headers=admin_headers).status_code == 200
    assert client.get(f"/api/v1/users/roles/{role_id}", headers=admin_headers).status_code == 404


def test_user_role_assignment_scopes_and_removal(client, admin_headers):
    role = client.post(
        "/api/v1/users/roles",
        headers=admin_headers,
        json={"name": "Scoped Role", "code": "SCOPED_ROLE"},
    )
    assert role.status_code == 200, role.text
    role_id = role.json()["id"]

    staff = client.post(
        "/api/v1/users/",
        headers=admin_headers,
        json={"name": "Scoped User", "username": "scoped_user", "password": "scopedpass1", "user_type": "STAFF"},
    )
    assert staff.status_code == 200, staff.text
    staff_id = staff.json()["id"]

    # scoped assignment without scope_id rejected
    no_scope = client.post(
        f"/api/v1/users/{staff_id}/assign-role",
        headers=admin_headers,
        params={"role_id": role_id, "scope_type": "DISTRICT"},
    )
    assert no_scope.status_code == 400, no_scope.text

    # GLOBAL with a scope_id rejected
    bad_global = client.post(
        f"/api/v1/users/{staff_id}/assign-role",
        headers=admin_headers,
        params={"role_id": role_id, "scope_id": "3"},
    )
    assert bad_global.status_code == 400, bad_global.text

    # unknown scope value rejected
    bad_type = client.post(
        f"/api/v1/users/{staff_id}/assign-role",
        headers=admin_headers,
        params={"role_id": role_id, "scope_type": "GALAXY"},
    )
    assert bad_type.status_code == 400, bad_type.text

    # unknown scope target rejected
    missing = client.post(
        f"/api/v1/users/{staff_id}/assign-role",
        headers=admin_headers,
        params={"role_id": role_id, "scope_type": "STATE", "scope_id": "999999"},
    )
    assert missing.status_code == 400, missing.text

    # valid GLOBAL assignment shows up in user detail and roles listing
    state = client.post("/api/v1/masters/states", headers=admin_headers, json={"name_en": "Scope Nadu"}).json()
    ok = client.post(
        f"/api/v1/users/{staff_id}/assign-role",
        headers=admin_headers,
        params={"role_id": role_id, "scope_type": "STATE", "scope_id": state["id"]},
    )
    assert ok.status_code == 200, ok.text

    detail = client.get(f"/api/v1/users/{staff_id}", headers=admin_headers)
    assert detail.status_code == 200, detail.text
    roles = detail.json()["roles"]
    assert len(roles) == 1
    assert roles[0]["role_code"] == "SCOPED_ROLE"
    assert roles[0]["scope_type"] == "STATE"
    assert roles[0]["scope_id"] == state["id"]

    listed = client.get(f"/api/v1/users/{staff_id}/roles", headers=admin_headers)
    assert listed.status_code == 200, listed.text
    assert listed.json()[0]["role_name"] == "Scoped Role"

    # removing an unassigned role 404s
    assert client.delete(
        f"/api/v1/users/{staff_id}/roles/999999", headers=admin_headers
    ).status_code == 404


def test_user_update_password_reset_and_guards(client, admin_headers):
    staff = client.post(
        "/api/v1/users/",
        headers=admin_headers,
        json={"name": "Resettable", "username": "resettable", "password": "oldpass123", "user_type": "STAFF"},
    )
    assert staff.status_code == 200, staff.text
    staff_id = staff.json()["id"]

    # weak reset password rejected
    weak = client.put(
        f"/api/v1/users/{staff_id}", headers=admin_headers, json={"password": "short"}
    )
    assert weak.status_code == 400, weak.text

    # strong reset works and old password stops working
    reset = client.put(
        f"/api/v1/users/{staff_id}", headers=admin_headers, json={"password": "brandnew456"}
    )
    assert reset.status_code == 200, reset.text

    old_login = client.post(
        "/api/v1/auth/login", data={"username": "resettable", "password": "oldpass123"}
    )
    assert old_login.status_code == 401, old_login.text
    new_login = client.post(
        "/api/v1/auth/login", data={"username": "resettable", "password": "brandnew456"}
    )
    assert new_login.status_code == 200, new_login.text

    # admin cannot deactivate themselves
    self_deactivate = client.put(
        "/api/v1/users/1", headers=admin_headers, json={"status": False}
    )
    assert self_deactivate.status_code == 400, self_deactivate.text

    # deactivating another user works
    other = client.put(
        f"/api/v1/users/{staff_id}", headers=admin_headers, json={"status": False}
    )
    assert other.status_code == 200, other.text
    assert other.json()["status"] is False

    # deleting the user clears their role assignments
    role = client.post(
        "/api/v1/users/roles", headers=admin_headers, json={"name": "Doomed Holder", "code": "DOOMED_HOLDER"}
    )
    role_id = role.json()["id"]
    client.post(f"/api/v1/users/{staff_id}/assign-role", headers=admin_headers, params={"role_id": role_id})

    deleted = client.delete(f"/api/v1/users/{staff_id}", headers=admin_headers)
    assert deleted.status_code == 200, deleted.text

    # role is free again (assignment was cleaned up), so it can be deleted
    assert client.delete(f"/api/v1/users/roles/{role_id}", headers=admin_headers).status_code == 200

    # user detail 404s afterwards
    assert client.get(f"/api/v1/users/{staff_id}", headers=admin_headers).status_code == 404


def test_superadmin_protections(client, admin_headers):
    # cannot delete the SUPERADMIN account (even by itself)
    assert client.delete("/api/v1/users/1", headers=admin_headers).status_code == 409

    # SUPERADMIN cannot be deactivated via update either
    assert client.put("/api/v1/users/1", headers=admin_headers, json={"status": False}).status_code in (400, 409)

    # a second superadmin's last role cannot be stripped (never fully unprivileged)
    sa2 = client.post(
        "/api/v1/users/",
        headers=admin_headers,
        json={"name": "SA Two", "username": "sa_two", "password": "satwopass1", "user_type": "SUPERADMIN"},
    )
    assert sa2.status_code == 200, sa2.text
    sa2_id = sa2.json()["id"]

    role = client.post(
        "/api/v1/users/roles", headers=admin_headers, json={"name": "SA Guard", "code": "SA_GUARD"}
    )
    role_id = role.json()["id"]
    assigned = client.post(f"/api/v1/users/{sa2_id}/assign-role", headers=admin_headers, params={"role_id": role_id})
    assert assigned.status_code == 200, assigned.text

    # stripping their only role is blocked — a superadmin is never left unprivileged
    removed = client.delete(f"/api/v1/users/{sa2_id}/roles/{role_id}", headers=admin_headers)
    assert removed.status_code == 409, removed.text
    assert "last role" in removed.json()["detail"]

    # with a second role assigned, removing the first one works
    role2 = client.post(
        "/api/v1/users/roles", headers=admin_headers, json={"name": "SA Guard 2", "code": "SA_GUARD_2"}
    )
    role2_id = role2.json()["id"]
    client.post(f"/api/v1/users/{sa2_id}/assign-role", headers=admin_headers, params={"role_id": role2_id})
    removed_now = client.delete(f"/api/v1/users/{sa2_id}/roles/{role_id}", headers=admin_headers)
    assert removed_now.status_code == 200, removed_now.text


# ─────────────── response shapes ───────────────


# ─────────────── response shapes ───────────────

@pytest.mark.parametrize("path", [
    "/api/v1/members/",
    "/api/v1/users",
    "/api/v1/users/roles",
    "/api/v1/users/permissions",
    "/api/v1/masters/states",
    "/api/v1/masters/districts",
    "/api/v1/masters/taluks",
    "/api/v1/masters/postal-codes",
    "/api/v1/masters/membership-types",
    "/api/v1/masters/document-types",
    "/api/v1/masters/service-types",
    "/api/v1/receipts/",
    "/api/v1/magazines/subscriptions",
    "/api/v1/magazines/returns",
    "/api/v1/magazines/delivery-batches",
    "/api/v1/events/",
    "/api/v1/engagements/affiliations",
    "/api/v1/engagements/associates",
    "/api/v1/engagements/press-media",
    "/api/v1/engagements/committee/categories",
    "/api/v1/engagements/committee/terms",
    "/api/v1/engagements/committee/members",
    "/api/v1/notifications/templates",
    "/api/v1/notifications/campaigns",
    "/api/v1/approvals/profile-changes",
    "/api/v1/approvals/type-changes",
    "/api/v1/approvals/deletion-requests",
    "/api/v1/reports/saved",
    "/api/v1/reports/export-logs",
    "/api/v1/system/attachments",
    "/api/v1/system/error-logs",
    "/api/v1/activity/users",
    "/api/v1/activity/members",
])
def test_lists_use_paginated_envelope(client, admin_headers, path):
    response = client.get(path, headers=admin_headers)
    assert response.status_code == 200, f"{path}: {response.text}"
    body = response.json()
    assert isinstance(body, dict), f"{path} returned a raw list"
    assert {"total", "page", "limit", "pages", "data"} <= set(body), path


# ─────────────── hardening round ───────────────

def test_profile_change_submit_rejects_illegal_fields(client, admin_headers):
    member = _create_member(client, admin_headers, "9000000020", "Guarded")
    response = client.post(
        "/api/v1/members/profile-changes/",
        headers=admin_headers,
        json={"member_id": member["id"], "new_values": {"approval_status": "APPROVED"}},
    )
    assert response.status_code == 422, response.text


def test_profile_change_approve_skips_illegal_fields(client, admin_headers):
    member = _create_member(client, admin_headers, "9000000021", "Legacy")

    from db.session import SessionLocal
    from models.members import Member, MemberProfileChangeRequest

    # A request that predates the whitelist (or bypassed the schema)
    with SessionLocal() as db:
        request_row = MemberProfileChangeRequest(
            member_id=member["id"],
            source="APP",
            new_values={"mobile": "9009009009", "approval_status": "APPROVED"},
            status="PENDING",
        )
        db.add(request_row)
        db.commit()
        request_id = request_row.id

    response = client.put(
        f"/api/v1/approvals/profile-changes/{request_id}/approve",
        headers=admin_headers,
    )
    assert response.status_code == 200, response.text
    assert response.json().get("skipped_fields") == ["approval_status"]

    with SessionLocal() as db:
        updated = db.get(Member, member["id"])
        assert updated.mobile == "9009009009"          # applied
        assert updated.approval_status == "UNAPPROVED"  # NOT escalated


def test_file_download_is_authenticated(client, admin_headers):
    doc_type = client.post(
        "/api/v1/masters/document-types",
        headers=admin_headers,
        json={"code": "TST_FILE_PROOF", "name_en": "File proof"},
    )
    assert doc_type.status_code == 200, doc_type.text
    member = _create_member(client, admin_headers, "9000000030", "File Owner")

    upload = client.post(
        "/api/v1/members/documents/",
        headers=admin_headers,
        params={"member_id": member["id"], "document_type_id": doc_type.json()["id"]},
        files={"file": ("photo.png", b"\x89PNG\r\n\x1a\n0123456789", "image/png")},
    )
    assert upload.status_code == 200, upload.text
    stored = upload.json()["file_path"]

    # authenticated download works and returns the real bytes
    ok = client.get("/api/v1/system/files", headers=admin_headers, params={"path": stored})
    assert ok.status_code == 200, ok.text
    assert ok.content.startswith(b"\x89PNG")

    # anonymous access is refused
    assert client.get("/api/v1/system/files", params={"path": stored}).status_code == 401

    # path traversal is refused
    traversal = client.get(
        "/api/v1/system/files",
        headers=admin_headers,
        params={"path": "../../../etc/passwd"},
    )
    assert traversal.status_code == 400

    # the old world-readable static mount is gone
    assert client.get("/uploads/photo.png").status_code == 404


def test_delivery_callback_requires_secret(client):
    from db.session import SessionLocal
    from models.notifications import NotificationMessage

    with SessionLocal() as db:
        message = NotificationMessage(
            recipient_number="9000000000",
            message_content="hello",
            delivery_status="SENT",
        )
        db.add(message)
        db.commit()
        message_id = message.id

    payload = {"message_id": message_id, "status_update": "READ"}

    assert client.post("/api/v1/notifications/callbacks", json=payload).status_code == 403
    assert client.post(
        "/api/v1/notifications/callbacks",
        json=payload,
        headers={"X-Callback-Secret": "wrong"},
    ).status_code == 403

    accepted = client.post(
        "/api/v1/notifications/callbacks",
        json=payload,
        headers={"X-Callback-Secret": "cb-secret-test"},
    )
    assert accepted.status_code == 200, accepted.text

    with SessionLocal() as db:
        assert db.get(NotificationMessage, message_id).delivery_status == "READ"


def test_login_rate_limited(client):
    for _ in range(10):
        response = client.post(
            "/api/v1/auth/login",
            data={"username": "ratelimit_probe", "password": "wrongpass1"},
        )
        assert response.status_code == 401
    response = client.post(
        "/api/v1/auth/login",
        data={"username": "ratelimit_probe", "password": "wrongpass1"},
    )
    assert response.status_code == 429, response.text


def test_password_policy_enforced(client, admin_headers):
    weak = client.post(
        "/api/v1/users/",
        headers=admin_headers,
        json={"name": "Weak", "username": "weakpass_user", "password": "short", "user_type": "STAFF"},
    )
    assert weak.status_code == 400, weak.text

    numeric = client.post(
        "/api/v1/users/",
        headers=admin_headers,
        json={"name": "Numeric", "username": "numericpass_user", "password": "12345678", "user_type": "STAFF"},
    )
    assert numeric.status_code == 400, numeric.text

    fine = client.post(
        "/api/v1/users/",
        headers=admin_headers,
        json={"name": "Fine", "username": "goodpass_user", "password": "goodpass123", "user_type": "STAFF"},
    )
    assert fine.status_code == 200, fine.text


def test_invalid_user_type_rejected(client, admin_headers):
    response = client.post(
        "/api/v1/users/",
        headers=admin_headers,
        json={"name": "Wizard", "username": "wizard_user", "password": "wizardpass1", "user_type": "WIZARD"},
    )
    assert response.status_code == 422, response.text


def test_duplicate_mobile_blocked_at_api_and_db(client, admin_headers):
    _create_member(client, admin_headers, "9000000022", "Original")

    duplicate = client.post(
        "/api/v1/members/",
        headers=admin_headers,
        json={"first_name_en": "Duplicate", "mobile": "9000000022"},
    )
    assert duplicate.status_code == 400, duplicate.text

    # and the partial unique index backstops races around the API check
    from sqlalchemy.exc import IntegrityError
    from db.session import SessionLocal
    from models.members import Member

    with pytest.raises(IntegrityError):
        with SessionLocal() as db:
            db.add(Member(first_name_en="Racy Duplicate", mobile="9000000022"))
            db.commit()


def test_permission_revoke_and_regrant(client, admin_headers):
    role = client.post(
        "/api/v1/users/roles",
        headers=admin_headers,
        json={"name": "Regrant Role", "code": "RBAC_REGRANT"},
    )
    assert role.status_code == 200, role.text
    role_id = role.json()["id"]

    grant = client.post(
        f"/api/v1/users/roles/{role_id}/permissions",
        headers=admin_headers,
        params={"code": "events.write"},
    )
    assert grant.status_code == 200, grant.text

    perms = client.get(f"/api/v1/users/roles/{role_id}/permissions", headers=admin_headers).json()
    permission_id = [p["id"] for p in perms if p["code"] == "events.write"][0]

    revoke = client.delete(
        f"/api/v1/users/roles/{role_id}/permissions/{permission_id}",
        headers=admin_headers,
    )
    assert revoke.status_code == 200, revoke.text

    # re-grant must work (soft-deleted row must not block the unique index)
    regrant = client.post(
        f"/api/v1/users/roles/{role_id}/permissions",
        headers=admin_headers,
        params={"code": "events.write"},
    )
    assert regrant.status_code == 200, regrant.text
    assert "already has" not in regrant.json()["message"]

    perms = client.get(f"/api/v1/users/roles/{role_id}/permissions", headers=admin_headers).json()
    assert len([p for p in perms if p["code"] == "events.write"]) == 1

    # a second ACTIVE grant is impossible at the DB level
    from sqlalchemy.exc import IntegrityError
    from db.session import SessionLocal
    from models.users import RolePermission

    with pytest.raises(IntegrityError):
        with SessionLocal() as db:
            db.add(RolePermission(role_id=role_id, permission_id=permission_id))
            db.commit()


def test_membership_numbered_on_approval(client, admin_headers):
    type_ = _create_membership_type(client, admin_headers, "TST_NUM", "Numbered Type")
    member = _create_member(client, admin_headers, "9000000023", "Numbered")

    created = client.post(
        f"/api/v1/members/{member['id']}/memberships",
        headers=admin_headers,
        json={"membership_type_id": type_["id"]},
    )
    assert created.status_code == 200, created.text
    membership_id = created.json()["id"]
    assert created.json()["membership_number"] is None  # not activated yet

    approved = client.put(f"/api/v1/members/{member['id']}/approve", headers=admin_headers)
    assert approved.status_code == 200, approved.text

    from db.session import SessionLocal
    from models.members import MemberMembership

    with SessionLocal() as db:
        membership = db.get(MemberMembership, membership_id)
        assert membership.membership_number
        assert membership.membership_number.startswith("HMSM-")
        assert membership.activated_at is not None


def test_permanent_delete_cascades(client, admin_headers):
    from db.session import SessionLocal
    from models.members import (
        Member, MemberDeletionRequest, MemberMembership,
    )
    from models.magazines import MagazineDeliveryPause, MagazineSubscription
    from models.receipts import Receipt, ReceiptAllocation

    member = _create_member(client, admin_headers, "9000000024", "Vanishing")
    type_ = _create_membership_type(client, admin_headers, "TST_PURGE", "Purge Type")

    membership = client.post(
        f"/api/v1/members/{member['id']}/memberships",
        headers=admin_headers,
        json={"membership_type_id": type_["id"]},
    )
    assert membership.status_code == 200, membership.text

    subscription = client.post(
        "/api/v1/magazines/subscriptions",
        headers=admin_headers,
        json={"member_id": member["id"]},
    )
    assert subscription.status_code == 200, subscription.text
    subscription_id = subscription.json()["id"]

    pause = client.post(
        "/api/v1/magazines/pauses",
        headers=admin_headers,
        json={"subscription_id": subscription_id, "pause_start_date": "2026-01-01"},
    )
    assert pause.status_code == 200, pause.text

    receipt = client.post(
        "/api/v1/receipts/",
        headers=admin_headers,
        json={
            "receipt_date": date.today().isoformat(),
            "receipt_type": "MEMBERSHIP",
            "payment_mode": "CASH",
            "gross_amount": 100,
            "discount_amount": 0,
            "net_amount": 100,
            "items": [{"item_type": "MEMBERSHIP", "amount": 100}],
        },
    )
    assert receipt.status_code == 200, receipt.text
    receipt_id = receipt.json()["id"]

    allocation = client.post(
        f"/api/v1/receipts/{receipt_id}/allocate",
        headers=admin_headers,
        params={"member_id": member["id"], "allocated_amount": 100},
    )
    assert allocation.status_code == 200, allocation.text

    request_made = client.post(
        "/api/v1/approvals/deletion-requests",
        headers=admin_headers,
        params={"member_id": member["id"], "reason": "purge test", "deletion_type": "PERMANENT"},
    )
    assert request_made.status_code == 200, request_made.text

    with SessionLocal() as db:
        deletion_request = (
            db.query(MemberDeletionRequest)
            .filter(MemberDeletionRequest.member_id == member["id"])
            .order_by(MemberDeletionRequest.id.desc())
            .first()
        )
        request_id = deletion_request.id

    approved = client.put(
        f"/api/v1/approvals/deletion-requests/{request_id}/approve",
        headers=admin_headers,
    )
    assert approved.status_code == 200, approved.text
    assert "permanently" in approved.json()["message"]

    with SessionLocal() as db:
        # member and everything referencing them is gone
        assert db.get(Member, member["id"]) is None
        assert db.query(MemberMembership).filter(MemberMembership.member_id == member["id"]).count() == 0
        assert db.query(MagazineSubscription).filter(MagazineSubscription.member_id == member["id"]).count() == 0
        assert db.query(MagazineDeliveryPause).filter(MagazineDeliveryPause.subscription_id == subscription_id).count() == 0
        assert db.query(MemberDeletionRequest).filter(MemberDeletionRequest.member_id == member["id"]).count() == 0
        # the money trail survives, just detached
        assert db.get(Receipt, receipt_id) is not None
        allocation_row = db.query(ReceiptAllocation).filter(ReceiptAllocation.receipt_id == receipt_id).first()
        assert allocation_row is not None
        assert allocation_row.member_id is None


def test_kyc_link_flow(client, admin_headers, monkeypatch):
    import services.whatsapp as whatsapp

    async def _ok(*args, **kwargs):
        return {"ok": True}

    monkeypatch.setattr(whatsapp.whatsapp_service, "send_message", _ok)

    from db.session import SessionLocal
    from models.members import Member

    member = _create_member(client, admin_headers, "9000000025", "KYC Member")
    sent = client.post(
        f"/api/v1/magazines/members/{member['id']}/send-kyc-link",
        headers=admin_headers,
    )
    assert sent.status_code == 200, sent.text
    token = sent.json()["kyc_url"].split("token=")[1]

    # the token itself is the credential — no bearer header needed
    preview = client.get(f"/api/v1/kyc/{token}")
    assert preview.status_code == 200, preview.text
    assert preview.json()["member"]["mobile"] == "9000000025"

    # non-editable fields refused up front
    bad = client.post(
        f"/api/v1/kyc/{token}",
        json={"values": {"approval_status": "APPROVED"}},
    )
    assert bad.status_code == 422, bad.text

    submitted = client.post(
        f"/api/v1/kyc/{token}",
        json={"values": {"mobile": "9112911291", "email": "kyc@example.com"}},
    )
    assert submitted.status_code == 200, submitted.text
    request_id = submitted.json()["request_id"]

    # links are single-use
    reused = client.post(
        f"/api/v1/kyc/{token}",
        json={"values": {"mobile": "9112911292"}},
    )
    assert reused.status_code == 400, reused.text

    assert client.get("/api/v1/kyc/not-a-real-token").status_code == 404

    # changes land as a request and only apply after approval
    approved = client.put(
        f"/api/v1/approvals/profile-changes/{request_id}/approve",
        headers=admin_headers,
    )
    assert approved.status_code == 200, approved.text

    with SessionLocal() as db:
        updated = db.get(Member, member["id"])
        assert updated.mobile == "9112911291"
        assert updated.email == "kyc@example.com"
        assert updated.approval_status == "UNAPPROVED"


def test_event_notification_targets_linked_members(client, admin_headers, monkeypatch):
    import services.whatsapp as whatsapp
    from db.session import SessionLocal
    from models.events import EventMemberLink

    sent_batches = []

    async def _capture(recipients, message, template_id=None):
        sent_batches.append(list(recipients))
        return [{"to": r, "ok": True} for r in recipients]

    monkeypatch.setattr(whatsapp.whatsapp_service, "send_bulk", _capture)

    event = client.post(
        "/api/v1/events/",
        headers=admin_headers,
        json={"title": "Annual Day", "event_date": "2026-12-01"},
    )
    assert event.status_code == 200, event.text
    event_id = event.json()["id"]

    member = _create_member(client, admin_headers, "9000000026", "Invitee")
    with SessionLocal() as db:
        db.add(EventMemberLink(event_id=event_id, member_id=member["id"]))
        db.commit()

    no_content = client.post(f"/api/v1/events/{event_id}/notify", headers=admin_headers)
    assert no_content.status_code == 400, no_content.text

    notified = client.post(
        f"/api/v1/events/{event_id}/notify",
        headers=admin_headers,
        params={"message": "You are invited!"},
    )
    assert notified.status_code == 200, notified.text
    assert notified.json()["queued"] == 1

    # the background task ran within the request lifecycle
    assert sent_batches
    assert any("9000000026" in number for number in sent_batches[0])


def test_label_batches_and_printable_pdf(client, admin_headers):
    member = _create_member(client, admin_headers, "9000000027", "Labeled")
    subscription = client.post(
        "/api/v1/magazines/subscriptions",
        headers=admin_headers,
        json={"member_id": member["id"]},
    )
    assert subscription.status_code == 200, subscription.text

    generated = client.post(
        "/api/v1/magazines/generate-labels",
        headers=admin_headers,
        params={"issue_month_year": "2026-03"},
    )
    assert generated.status_code == 200, generated.text
    batch_id = generated.json()["batch_id"]
    assert generated.json()["total_labels"] >= 1

    listing = client.get("/api/v1/magazines/label-batches", headers=admin_headers)
    assert listing.status_code == 200, listing.text
    assert {"total", "page", "limit", "pages", "data"} <= set(listing.json())
    assert any(b["id"] == batch_id for b in listing.json()["data"])

    pdf = client.get(
        f"/api/v1/magazines/label-batches/{batch_id}/pdf",
        headers=admin_headers,
    )
    assert pdf.status_code == 200, pdf.text
    assert pdf.headers["content-type"].startswith("application/pdf")
    assert pdf.content.startswith(b"%PDF")


def test_report_language_and_column_selection(client, admin_headers):
    _create_member(client, admin_headers, "9000000028", "Reportable")

    kannada_csv = client.get(
        "/api/v1/reports/members",
        headers=admin_headers,
        params={"export": "csv", "language": "kn", "columns": "member_code,mobile"},
    )
    assert kannada_csv.status_code == 200, kannada_csv.text
    text = kannada_csv.text
    assert "ಸದಸ್ಯ ಸಂಖ್ಯೆ" in text
    assert "ಮೊಬೈಲ್ ಸಂಖ್ಯೆ" in text
    assert "first_name_en" not in text

    assert client.get(
        "/api/v1/reports/members", headers=admin_headers, params={"columns": "nope"}
    ).status_code == 400
    assert client.get(
        "/api/v1/reports/members", headers=admin_headers, params={"language": "fr"}
    ).status_code == 400

    body = client.get(
        "/api/v1/reports/members",
        headers=admin_headers,
        params={"columns": "member_code"},
    ).json()
    assert body["language"] == "en"
    assert body["columns"] == ["member_code"]
    assert body["total"] >= 1


def test_campaign_send_records_delivery_status(client, admin_headers, monkeypatch):
    import services.whatsapp as whatsapp
    from db.session import SessionLocal
    from models.notifications import NotificationCampaign, NotificationRecipient

    async def _all_ok(recipients, message, template_id=None):
        return [{"to": r, "ok": True} for r in recipients]

    monkeypatch.setattr(whatsapp.whatsapp_service, "send_bulk", _all_ok)

    template = client.post(
        "/api/v1/notifications/templates",
        headers=admin_headers,
        json={"template_name": "TST_TPL_1", "content": "Hello members"},
    )
    assert template.status_code == 200, template.text

    campaign = client.post(
        "/api/v1/notifications/campaigns",
        headers=admin_headers,
        json={"campaign_name": "TST_CAMP_1", "template_id": template.json()["id"]},
    )
    assert campaign.status_code == 200, campaign.text
    campaign_id = campaign.json()["id"]

    queued = client.post(
        f"/api/v1/notifications/campaigns/{campaign_id}/send",
        headers=admin_headers,
    )
    assert queued.status_code == 200, queued.text

    # the background send completed and left a terminal status behind
    with SessionLocal() as db:
        row = db.get(NotificationCampaign, campaign_id)
        assert row.status == "SENT"
        recipients = db.query(NotificationRecipient).filter(
            NotificationRecipient.campaign_id == campaign_id
        ).all()
        assert all(r.status == "SENT" for r in recipients)


def test_page_size_clamped(client, admin_headers):
    response = client.get("/api/v1/members/", headers=admin_headers, params={"limit": 100000})
    assert response.status_code == 200, response.text
    assert response.json()["limit"] == 500


def test_production_requires_strong_secret():
    from core.config import Settings, validate_secret_key, PLACEHOLDER_SECRET

    with pytest.raises(RuntimeError):
        validate_secret_key(Settings(ENVIRONMENT="production", SECRET_KEY=PLACEHOLDER_SECRET))
    with pytest.raises(RuntimeError):
        validate_secret_key(Settings(ENVIRONMENT="production", SECRET_KEY="short"))
    # non-production and strong secrets pass
    validate_secret_key(Settings(ENVIRONMENT="production", SECRET_KEY="x" * 48))
    validate_secret_key(Settings(ENVIRONMENT="development", SECRET_KEY=PLACEHOLDER_SECRET))
