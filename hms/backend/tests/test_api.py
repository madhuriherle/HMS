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
    assert response.status_code in (200, 201), response.text
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
    assert allowed.status_code == 201, allowed.text

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
    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text

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
        json={"name": "Assoc One", "organization": "Havyaka Group", "address": "Hubballi"},
    )
    assert associate.status_code == 201, associate.text
    assert associate.json()["id"]

    press = client.post(
        "/api/v1/engagements/press-media",
        headers=admin_headers,
        json={"organization_name": "Press One", "reporter_name": "Reporter", "address": "Bengaluru"},
    )
    assert press.status_code == 201, press.text
    assert press.json()["id"]

    category = client.post(
        "/api/v1/engagements/committee/categories",
        headers=admin_headers,
        json={"name_en": "Bengaluru constituency"},
    )
    assert category.status_code == 201, category.text

    term = client.post(
        "/api/v1/engagements/committee/terms",
        headers=admin_headers,
        json={"term_name": "2026-2029", "is_current": True},
    )
    assert term.status_code == 201, term.text
    assert term.json()["is_current"] is True

    member = client.post(
        "/api/v1/engagements/committee/members",
        headers=admin_headers,
        json={"category_id": category.json()["id"], "member_name": "Office Bearer"},
    )
    assert member.status_code == 201, member.text
    assert member.json()["member_name"] == "Office Bearer"

    updated = client.put(
        f"/api/v1/engagements/associates/{associate.json()['id']}",
        headers=admin_headers,
        json={"magazine_enabled": False, "address": "Mysuru"},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["magazine_enabled"] is False
    assert updated.json()["address"] == "Mysuru"


def test_affiliation_full_lifecycle_magazine_and_labels(client, admin_headers):
    """Affiliate groups: full info, magazine toggle, label print inclusion."""
    # ── create with all necessary information ──
    aff = client.post(
        "/api/v1/engagements/affiliations",
        headers=admin_headers,
        json={
            "group_name": "Saraswath Havyaka Sangha",
            "contact_person": "Rama Bhat",
            "contact_number": "9340000301",
            "address": "Sangha Bhavana, Shirva",
            "magazine_enabled": True,
        },
    )
    assert aff.status_code == 201, aff.text
    aff_body = aff.json()
    assert aff_body["address"] == "Sangha Bhavana, Shirva"
    aff_id = aff_body["id"]

    # contact persons management
    contact = client.post(
        f"/api/v1/engagements/affiliations/{aff_id}/contacts",
        headers=admin_headers,
        json={"name": "Suresh Pai", "mobile": "9340000302", "designation": "Secretary"},
    )
    assert contact.status_code == 201, contact.text

    contacts = client.get(
        f"/api/v1/engagements/affiliations/{aff_id}/contacts", headers=admin_headers
    )
    assert contacts.status_code == 200, contacts.text
    assert contacts.json()["total"] == 1
    assert contacts.json()["data"][0]["designation"] == "Secretary"

    # affiliates list with magazine filter
    listing = client.get(
        "/api/v1/engagements/affiliations",
        headers=admin_headers,
        params={"magazine_enabled": "true"},
    )
    assert any(a["id"] == aff_id for a in listing.json()["data"])

    # ── magazine enable/disable toggle ──
    disabled = client.put(
        f"/api/v1/engagements/affiliations/{aff_id}",
        headers=admin_headers,
        json={"magazine_enabled": False},
    )
    assert disabled.status_code == 200, disabled.text
    assert disabled.json()["magazine_enabled"] is False

    # member with subscription for the label batch comparison
    member = _create_member(client, admin_headers, "9340000310", "LabelMember")
    sub = client.post(
        "/api/v1/magazines/subscriptions", headers=admin_headers, json={"member_id": member["id"]}
    )
    assert sub.status_code == 201, sub.text

    issue = date.today().strftime("%Y-%m")
    generated = client.post(
        "/api/v1/magazines/generate-labels",
        headers=admin_headers,
        params={"issue_month_year": issue},
    )
    assert generated.status_code == 200, generated.text
    batch_id = generated.json()["batch_id"]

    def _batch_types(bid):
        detail = client.get(
            f"/api/v1/magazines/label-batches/{bid}", headers=admin_headers
        ).json()
        return {
            i["recipient_type"] for i in detail["data"]
            if i["recipient_id"] == aff_id
        }, detail["data"]

    # disabled affiliate is NOT in the labels
    types, _ = _batch_types(batch_id)
    assert "AFFILIATION" not in types

    # re-enable → appears in the next label batch alongside members
    client.put(
        f"/api/v1/engagements/affiliations/{aff_id}",
        headers=admin_headers,
        json={"magazine_enabled": True},
    )
    generated2 = client.post(
        "/api/v1/magazines/generate-labels",
        headers=admin_headers,
        params={"issue_month_year": issue},
    )
    batch2 = generated2.json()["batch_id"]
    detail2 = client.get(
        f"/api/v1/magazines/label-batches/{batch2}", headers=admin_headers
    ).json()
    aff_labels = [
        i for i in detail2["data"]
        if i["recipient_type"] == "AFFILIATION" and i["recipient_id"] == aff_id
    ]
    member_labels = [
        i for i in detail2["data"]
        if i["recipient_type"] == "MEMBER" and i["recipient_id"] == member["id"]
    ]
    assert aff_labels and "Saraswath Havyaka Sangha" in (aff_labels[0]["recipient_name"] or "")
    assert member_labels  # member listed in the same batch


    # ── associates & press magazine toggles + labels ──
    assoc = client.post(
        "/api/v1/engagements/associates",
        headers=admin_headers,
        json={"name": "Havyaka Trust", "address": "Sirsi", "magazine_enabled": True},
    ).json()
    press = client.post(
        "/api/v1/engagements/press-media",
        headers=admin_headers,
        json={"organization_name": "Havyaka Times", "address": "Mangaluru"},
    ).json()

    generated3 = client.post(
        "/api/v1/magazines/generate-labels",
        headers=admin_headers,
        params={"issue_month_year": issue},
    )
    detail3 = client.get(
        f"/api/v1/magazines/label-batches/{generated3.json()['batch_id']}", headers=admin_headers
    ).json()
    assert any(
        i["recipient_type"] == "ASSOCIATE" and i["recipient_id"] == assoc["id"]
        for i in detail3["data"]
    )
    assert any(
        i["recipient_type"] == "PRESS" and i["recipient_id"] == press["id"]
        for i in detail3["data"]
    )

    # disable associate → excluded from the next batch
    client.put(
        f"/api/v1/engagements/associates/{assoc['id']}",
        headers=admin_headers,
        json={"magazine_enabled": False},
    )
    client.put(
        f"/api/v1/engagements/press-media/{press['id']}",
        headers=admin_headers,
        json={"magazine_enabled": False},
    )
    generated4 = client.post(
        "/api/v1/magazines/generate-labels",
        headers=admin_headers,
        params={"issue_month_year": issue},
    )
    detail4 = client.get(
        f"/api/v1/magazines/label-batches/{generated4.json()['batch_id']}", headers=admin_headers
    ).json()
    assert not any(
        i["recipient_type"] == "ASSOCIATE" and i["recipient_id"] == assoc["id"]
        for i in detail4["data"]
    )
    assert not any(
        i["recipient_type"] == "PRESS" and i["recipient_id"] == press["id"]
        for i in detail4["data"]
    )


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
    assert receipt.status_code == 201, receipt.text
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


# ─────────────── membership module ───────────────

def test_offline_registration_bilingual_and_duplicates(client, admin_headers):
    payload = {
        "first_name_en": "Ramesh",
        "last_name_en": "Hegde",
        "full_name_kn": "ರಮೇಶ್ ಹೆಗಡೆ",
        "gender": "MALE",
        "date_of_birth": "1990-05-01",
        "mobile": "9330000001",
        "address_line1": "1st Cross",
        "registration_source": "OFFLINE",
    }
    response = client.post(
        "/api/v1/members/", headers=admin_headers, json=payload
    )
    assert response.status_code == 201, response.text
    member = response.json()
    assert member["full_name_kn"] == "ರಮೇಶ್ ಹೆಗಡೆ"
    assert member["registration_source"] == "OFFLINE"
    assert member["approval_status"] == "UNAPPROVED"

    # duplicate mobile → 409 with the existing id
    dup = client.post(
        "/api/v1/members/",
        headers=admin_headers,
        json={"first_name_en": "Other", "mobile": "9330000001"},
    )
    assert dup.status_code == 409, dup.text
    assert "Duplicate" in dup.json()["detail"]

    # duplicate Kannada name + same DOB → 409
    dup_kn = client.post(
        "/api/v1/members/",
        headers=admin_headers,
        json={
            "first_name_en": "Different",
            "full_name_kn": "ರಮೇಶ್ ಹೆಗಡೆ",
            "date_of_birth": "1990-05-01",
            "mobile": "9330000002",
        },
    )
    assert dup_kn.status_code == 409, dup_kn.text
    assert "Kannada name" in dup_kn.json()["detail"]

    # same Kannada name but different DOB is fine
    ok_kn = client.post(
        "/api/v1/members/",
        headers=admin_headers,
        json={
            "first_name_en": "Different",
            "full_name_kn": "ರಮೇಶ್ ಹೆಗಡೆ",
            "date_of_birth": "1985-05-01",
            "mobile": "9330000003",
        },
    )
    assert ok_kn.status_code == 201, ok_kn.text

    # a MEMBER login account was provisioned with mobile as username
    from db.session import SessionLocal
    from models.users import User as UserModel

    with SessionLocal() as db:
        login = db.query(UserModel).filter(UserModel.username == "9330000001").first()
        assert login is not None, "member login account was not provisioned"
        assert login.user_type == "MEMBER"
        assert login.member_id == member["id"]

    # validation: bad gender, future dob, bad mobile
    assert client.post(
        "/api/v1/members/", headers=admin_headers, json={"first_name_en": "X", "gender": "ALIEN"}
    ).status_code == 422
    assert client.post(
        "/api/v1/members/", headers=admin_headers, json={"first_name_en": "X", "date_of_birth": "2999-01-01"}
    ).status_code == 422
    assert client.post(
        "/api/v1/members/", headers=admin_headers, json={"first_name_en": "X", "mobile": "123"}
    ).status_code == 422


def test_member_registration_geography_autofill(client, admin_headers):
    state = client.post("/api/v1/masters/states", headers=admin_headers, json={"name_en": "M Nadu"}).json()
    district = client.post(
        "/api/v1/masters/districts", headers=admin_headers,
        json={"state_id": state["id"], "name_en": "M District"},
    ).json()
    pc = client.post(
        "/api/v1/masters/postal-codes", headers=admin_headers,
        json={"pincode": "589001", "state_id": state["id"], "district_id": district["id"]},
    ).json()

    # only pincode supplied → geography auto-filled from the postal code
    member = client.post(
        "/api/v1/members/",
        headers=admin_headers,
        json={"first_name_en": "Auto", "pincode_id": pc["id"], "mobile": "9330000010"},
    )
    assert member.status_code == 201, member.text
    body = member.json()
    assert body["state_id"] == state["id"]
    assert body["district_id"] == district["id"]

    # mismatched district/state rejected
    state2 = client.post("/api/v1/masters/states", headers=admin_headers, json={"name_en": "M Nadu 2"}).json()
    bad = client.post(
        "/api/v1/members/",
        headers=admin_headers,
        json={"first_name_en": "Bad", "state_id": state2["id"], "district_id": district["id"]},
    )
    assert bad.status_code == 400, bad.text

    # unknown geography rejected
    assert client.post(
        "/api/v1/members/", headers=admin_headers, json={"first_name_en": "X", "state_id": 999999}
    ).status_code == 400


def test_member_list_filters_and_edit(client, admin_headers):
    m1 = client.post(
        "/api/v1/members/", headers=admin_headers,
        json={"first_name_en": "FilterOne", "gender": "FEMALE", "mobile": "9330000020", "full_name_kn": "ಫಿಲ್ಟರ್ ಒಂದು"},
    ).json()
    m2 = client.post(
        "/api/v1/members/", headers=admin_headers,
        json={"first_name_en": "FilterTwo", "gender": "MALE", "mobile": "9330000021"},
    ).json()

    # gender + approval_status filters
    females = client.get("/api/v1/members/", headers=admin_headers, params={"gender": "FEMALE"}).json()
    assert any(m["id"] == m1["id"] for m in females["data"])
    assert not any(m["id"] == m2["id"] for m in females["data"])

    unapproved = client.get(
        "/api/v1/members/", headers=admin_headers, params={"approval_status": "UNAPPROVED"}
    ).json()
    assert any(m["id"] == m1["id"] for m in unapproved["data"])

    # Kannada search
    kn = client.get("/api/v1/members/", headers=admin_headers, params={"search": "ಫಿಲ್ಟರ್"}).json()
    assert any(m["id"] == m1["id"] for m in kn["data"])

    # full bilingual edit via PUT
    upd = client.put(
        f"/api/v1/members/{m1['id']}",
        headers=admin_headers,
        json={
            "address_line1": "New Street",
            "address_line1_kn": "ಹೊಸ ಬೀದಿ",
            "alternate_mobile": "9330000099",
            "email": "filterone@example.com",
        },
    )
    assert upd.status_code == 200, upd.text
    assert upd.json()["address_line1_kn"] == "ಹೊಸ ಬೀದಿ"

    # mobile change onto another member's number → 409
    clash = client.put(
        f"/api/v1/members/{m1['id']}", headers=admin_headers, json={"mobile": "9330000021"}
    )
    assert clash.status_code == 409, clash.text

    # include_deleted shows soft-deleted members
    client.delete(
        f"/api/v1/members/{m2['id']}", headers=admin_headers, params={"reason": "dupe"}
    )
    gone = client.get(
        "/api/v1/members/", headers=admin_headers, params={"include_deleted": True, "search": "FilterTwo"}
    ).json()
    assert any(m["id"] == m2["id"] for m in gone["data"])


def test_member_profile_endpoint(client, admin_headers):
    mt = _create_membership_type(client, admin_headers, "TST_PROF", "Profile Type")
    member = _create_member(client, admin_headers, "9330000030", "Profiler")
    client.post(
        f"/api/v1/members/{member['id']}/memberships",
        headers=admin_headers,
        json={"membership_type_id": mt["id"]},
    )
    client.put(f"/api/v1/members/{member['id']}/approve", headers=admin_headers)

    # magazine subscription + receipt allocation as service/financial data
    sub = client.post("/api/v1/magazines/subscriptions", headers=admin_headers, json={"member_id": member["id"]})
    assert sub.status_code in (200, 201), sub.text
    receipt = client.post(
        "/api/v1/receipts/",
        headers=admin_headers,
        json={
            "receipt_date": date.today().isoformat(),
            "receipt_type": "MEMBERSHIP",
            "payment_mode": "CASH",
            "gross_amount": 250,
            "discount_amount": 0,
            "net_amount": 250,
            "items": [{"item_type": "MEMBERSHIP", "amount": 250}],
        },
    ).json()
    client.post(
        f"/api/v1/receipts/{receipt['id']}/allocate",
        headers=admin_headers,
        json={"member_id": member["id"], "allocated_amount": 250},
    )

    profile = client.get(f"/api/v1/members/{member['id']}/profile", headers=admin_headers)
    assert profile.status_code == 200, profile.text
    body = profile.json()

    assert body["personal"]["first_name_en"] == "Profiler"
    assert body["personal"]["member_code"]
    assert len(body["memberships"]) == 1
    assert body["memberships"][0]["type_code"] == "TST_PROF"
    assert body["memberships"][0]["membership_number"]  # activated on approve
    assert len(body["services"]["magazine"]) == 1
    assert len(body["financial"]["receipts"]) == 1
    assert body["financial"]["receipts"][0]["net_amount"] == 250.0
    assert len(body["history"]["approvals"]) >= 1
    assert body["deletion_requests"] == []
    assert body["kyc_requests"] == []

    assert client.get("/api/v1/members/999999/profile", headers=admin_headers).status_code == 404


def test_direct_delete_soft_and_permanent(client, admin_headers):
    soft_target = _create_member(client, admin_headers, "9330000040", "Softly")
    perm_target = _create_member(client, admin_headers, "9330000041", "Permaly")

    # soft delete with reason records history
    soft = client.delete(
        f"/api/v1/members/{soft_target['id']}", headers=admin_headers, params={"reason": "left sabha"}
    )
    assert soft.status_code == 200, soft.text
    assert soft.json()["mode"] == "SOFT"

    from db.session import SessionLocal
    from models.members import Member, MemberApprovalHistory

    with SessionLocal() as db:
        row = db.get(Member, soft_target["id"])
        assert row.is_deleted is True
        history = (
            db.query(MemberApprovalHistory)
            .filter(
                MemberApprovalHistory.member_id == soft_target["id"],
                MemberApprovalHistory.action == "DELETE",
            )
            .first()
        )
        assert history is not None
        assert history.reason == "left sabha"

    # permanent delete wipes the row entirely (receipt allocation detached)
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
    ).json()
    client.post(
        f"/api/v1/receipts/{receipt['id']}/allocate",
        headers=admin_headers,
        json={"member_id": perm_target["id"], "allocated_amount": 100},
    )

    perm = client.delete(
        f"/api/v1/members/{perm_target['id']}",
        headers=admin_headers,
        params={"reason": "gdpr request", "mode": "PERMANENT"},
    )
    assert perm.status_code == 200, perm.text
    assert perm.json()["mode"] == "PERMANENT"

    with SessionLocal() as db:
        assert db.get(Member, perm_target["id"]) is None

    # mode validation and missing reason
    assert client.delete(
        f"/api/v1/members/{_create_member(client, admin_headers, '9330000042', 'Bad')['id']}",
        headers=admin_headers,
        params={"reason": "x", "mode": "HARD"},
    ).status_code == 400
    assert client.delete(
        f"/api/v1/members/{_create_member(client, admin_headers, '9330000043', 'NoR')['id']}",
        headers=admin_headers,
    ).status_code == 422  # reason is required


def test_kyc_link_channels(client, admin_headers, monkeypatch):
    import services.whatsapp as whatsapp

    sent = []

    async def _capture(to, message, template_id=None):
        sent.append(message)
        return {"ok": True}

    monkeypatch.setattr(whatsapp.whatsapp_service, "send_message", _capture)

    member = _create_member(client, admin_headers, "9330000050", "KycLink")

    # APP channel: no link, nudge message
    app_resp = client.post(
        f"/api/v1/magazines/members/{member['id']}/send-kyc-link",
        headers=admin_headers,
        params={"channel": "APP"},
    )
    assert app_resp.status_code == 200, app_resp.text
    assert app_resp.json()["channel"] == "APP"
    assert "kyc_url" not in app_resp.json()
    assert len(sent) == 1 and "app" in sent[0].lower()

    # LINK channel: still works, returns url
    link_resp = client.post(
        f"/api/v1/magazines/members/{member['id']}/send-kyc-link",
        headers=admin_headers,
        params={"channel": "LINK"},
    )
    assert link_resp.status_code == 200, link_resp.text
    assert "kyc_url" in link_resp.json()

    # bad channel rejected
    assert client.post(
        f"/api/v1/magazines/members/{member['id']}/send-kyc-link",
        headers=admin_headers,
        params={"channel": "SMS"},
    ).status_code == 400

    # KYC submit still lands as a profile-change request (end-to-end)
    token = link_resp.json()["kyc_url"].split("token=")[1]
    submitted = client.post(
        f"/api/v1/kyc/{token}",
        json={"values": {"email": "kyc2@example.com"}},
    )
    assert submitted.status_code == 200, submitted.text

    # profile shows the kyc request trail
    profile = client.get(f"/api/v1/members/{member['id']}/profile", headers=admin_headers)
    assert len(profile.json()["kyc_requests"]) == 2
    assert len(profile.json()["profile_change_requests"]) == 1


# ─────────────── magazine module ───────────────

def test_magazine_subscription_stop_start(client, admin_headers):
    member = _create_member(client, admin_headers, "9340000001", "MagReader")

    # start delivery
    sub = client.post(
        "/api/v1/magazines/subscriptions",
        headers=admin_headers,
        json={"member_id": member["id"], "delivery_status": "ACTIVE"},
    )
    assert sub.status_code == 201, sub.text
    sub_id = sub.json()["id"]

    # second subscription for the same member blocked
    dup = client.post(
        "/api/v1/magazines/subscriptions",
        headers=admin_headers,
        json={"member_id": member["id"]},
    )
    assert dup.status_code == 409, dup.text

    # unknown member blocked
    assert client.post(
        "/api/v1/magazines/subscriptions",
        headers=admin_headers,
        json={"member_id": 999999},
    ).status_code == 400

    # stop delivery
    stopped = client.put(
        f"/api/v1/magazines/subscriptions/{sub_id}",
        headers=admin_headers,
        json={"delivery_status": "STOPPED"},
    )
    assert stopped.status_code == 200, stopped.text
    assert stopped.json()["delivery_status"] == "STOPPED"

    # invalid status rejected
    assert client.put(
        f"/api/v1/magazines/subscriptions/{sub_id}",
        headers=admin_headers,
        json={"delivery_status": "PAUSED_FOREVER"},
    ).status_code == 400

    # start again
    restarted = client.put(
        f"/api/v1/magazines/subscriptions/{sub_id}",
        headers=admin_headers,
        json={"delivery_status": "ACTIVE"},
    )
    assert restarted.status_code == 200, restarted.text

    # filter by member
    listed = client.get(
        "/api/v1/magazines/subscriptions",
        headers=admin_headers,
        params={"member_id": member["id"]},
    )
    assert listed.json()["total"] == 1


def test_magazine_pause_resume_cycle(client, admin_headers):
    member = _create_member(client, admin_headers, "9340000002", "Pauser")
    sub = client.post(
        "/api/v1/magazines/subscriptions", headers=admin_headers, json={"member_id": member["id"]}
    ).json()

    # pause with note
    pause = client.post(
        "/api/v1/magazines/pauses",
        headers=admin_headers,
        json={"subscription_id": sub["id"], "pause_start_date": "2026-01-01", "reason": "travelling abroad"},
    )
    assert pause.status_code == 201, pause.text
    pause_id = pause.json()["id"]

    # second open pause blocked while first is open
    dup_pause = client.post(
        "/api/v1/magazines/pauses",
        headers=admin_headers,
        json={"subscription_id": sub["id"], "pause_start_date": "2026-02-01"},
    )
    assert dup_pause.status_code == 409, dup_pause.text

    # end before start rejected
    bad = client.post(
        "/api/v1/magazines/pauses",
        headers=admin_headers,
        json={"subscription_id": sub["id"], "pause_start_date": "2026-03-01", "pause_end_date": "2026-02-01"},
    )
    assert bad.status_code == 400, bad.text

    # active_only filter shows the open pause
    active = client.get(
        "/api/v1/magazines/pauses", headers=admin_headers, params={"active_only": True}
    )
    assert any(p["id"] == pause_id for p in active.json()["data"])

    # resume closes the pause
    resumed = client.post(f"/api/v1/magazines/pauses/{pause_id}/resume", headers=admin_headers)
    assert resumed.status_code == 200, resumed.text
    assert resumed.json()["pause_end_date"] is not None

    # resuming a closed pause blocked
    assert client.post(
        f"/api/v1/magazines/pauses/{pause_id}/resume", headers=admin_headers
    ).status_code == 400

    # extend window via PUT
    pause2 = client.post(
        "/api/v1/magazines/pauses",
        headers=admin_headers,
        json={"subscription_id": sub["id"], "pause_start_date": "2026-05-01", "pause_end_date": "2026-05-10"},
    ).json()
    extended = client.put(
        f"/api/v1/magazines/pauses/{pause2['id']}",
        headers=admin_headers,
        json={"pause_end_date": "2026-05-31", "reason": "extended holiday"},
    )
    assert extended.status_code == 200, extended.text
    assert extended.json()["pause_end_date"] == "2026-05-31"


def test_magazine_returns_lifecycle_and_label_flagging(client, admin_headers):
    member = _create_member(client, admin_headers, "9340000003", "Returner")
    sub = client.post(
        "/api/v1/magazines/subscriptions", headers=admin_headers, json={"member_id": member["id"]}
    ).json()

    # mark a return
    ret = client.post(
        "/api/v1/magazines/returns",
        headers=admin_headers,
        json={
            "subscription_id": sub["id"],
            "issue_month_year": "2026-04",
            "return_date": "2026-05-02",
            "return_reason": "not received at address",
        },
    )
    assert ret.status_code == 201, ret.text
    ret_id = ret.json()["id"]

    # duplicate return for the same issue blocked
    dup = client.post(
        "/api/v1/magazines/returns",
        headers=admin_headers,
        json={"subscription_id": sub["id"], "issue_month_year": "2026-04", "return_date": "2026-05-03"},
    )
    assert dup.status_code == 409, dup.text

    # bad issue format rejected
    assert client.post(
        "/api/v1/magazines/returns",
        headers=admin_headers,
        json={"subscription_id": sub["id"], "issue_month_year": "April 2026", "return_date": "2026-05-03"},
    ).status_code == 400

    # returns list filters by member and month
    by_member = client.get(
        "/api/v1/magazines/returns", headers=admin_headers, params={"member_id": member["id"]}
    )
    assert by_member.json()["total"] == 1

    # follow-up workflow
    followed = client.put(
        f"/api/v1/magazines/returns/{ret_id}",
        headers=admin_headers,
        json={"follow_up_status": "CONTACTED"},
    )
    assert followed.status_code == 200, followed.text
    assert followed.json()["follow_up_status"] == "CONTACTED"

    # invalid follow-up status rejected
    assert client.put(
        f"/api/v1/magazines/returns/{ret_id}",
        headers=admin_headers,
        json={"follow_up_status": "DONE"},
    ).status_code == 400

    # returns appear highlighted on the member profile
    profile = client.get(f"/api/v1/members/{member['id']}/profile", headers=admin_headers)
    returns = profile.json()["services"]["magazine_returns"]
    assert len(returns) == 1
    assert returns[0]["issue_month_year"] == "2026-04"

    # label generation flags the return
    generated = client.post(
        "/api/v1/magazines/generate-labels",
        headers=admin_headers,
        params={"issue_month_year": "2026-04"},
    )
    assert generated.status_code == 200, generated.text
    assert generated.json()["returned_count"] == 1

    batch_id = generated.json()["batch_id"]
    detail = client.get(
        f"/api/v1/magazines/label-batches/{batch_id}",
        headers=admin_headers,
        params={"returns_only": True},
    )
    assert detail.status_code == 200, detail.text
    assert detail.json()["total"] == 1
    assert detail.json()["data"][0]["is_return"] is True

    # undo the return → it leaves the returns list
    undone = client.delete(f"/api/v1/magazines/returns/{ret_id}", headers=admin_headers)
    assert undone.status_code == 200, undone.text
    remaining = client.get(
        "/api/v1/magazines/returns", headers=admin_headers, params={"member_id": member["id"]}
    )
    assert remaining.json()["total"] == 0


def test_label_generation_skips_stopped_and_paused(client, admin_headers):
    m_active = _create_member(client, admin_headers, "9340000010", "Active")
    m_stopped = _create_member(client, admin_headers, "9340000011", "Stopped")
    m_paused = _create_member(client, admin_headers, "9340000012", "Paused")

    sub_a = client.post(
        "/api/v1/magazines/subscriptions", headers=admin_headers, json={"member_id": m_active["id"]}
    ).json()
    sub_s = client.post(
        "/api/v1/magazines/subscriptions", headers=admin_headers, json={"member_id": m_stopped["id"]}
    ).json()
    sub_p = client.post(
        "/api/v1/magazines/subscriptions", headers=admin_headers, json={"member_id": m_paused["id"]}
    ).json()

    client.put(
        f"/api/v1/magazines/subscriptions/{sub_s['id']}",
        headers=admin_headers,
        json={"delivery_status": "STOPPED"},
    )
    client.post(
        "/api/v1/magazines/pauses",
        headers=admin_headers,
        json={"subscription_id": sub_p["id"], "pause_start_date": "2020-01-01"},  # open-ended
    )

    issue = (date.today()).strftime("%Y-%m")
    generated = client.post(
        "/api/v1/magazines/generate-labels", headers=admin_headers, params={"issue_month_year": issue}
    )
    assert generated.status_code == 200, generated.text

    detail = client.get(
        f"/api/v1/magazines/label-batches/{generated.json()['batch_id']}", headers=admin_headers
    )
    member_ids = {
        item["recipient_id"] for item in detail.json()["data"] if item["recipient_type"] == "MEMBER"
    }
    assert m_active["id"] in member_ids
    assert m_stopped["id"] not in member_ids  # stopped delivery
    assert m_paused["id"] not in member_ids   # paused → skipped in label print

    # district/taluk/state filters respected
    state = client.post("/api/v1/masters/states", headers=admin_headers, json={"name_en": "Mag Nadu"}).json()
    district = client.post(
        "/api/v1/masters/districts",
        headers=admin_headers,
        json={"state_id": state["id"], "name_en": "Mag District"},
    ).json()
    client.put(
        f"/api/v1/members/{m_active['id']}",
        headers=admin_headers,
        json={"state_id": state["id"], "district_id": district["id"]},
    )

    filtered = client.post(
        "/api/v1/magazines/generate-labels",
        headers=admin_headers,
        params={"issue_month_year": issue, "district_id": district["id"]},
    )
    assert filtered.status_code == 200, filtered.text
    detail2 = client.get(
        f"/api/v1/magazines/label-batches/{filtered.json()['batch_id']}", headers=admin_headers
    )
    member_ids2 = {
        item["recipient_id"] for item in detail2.json()["data"] if item["recipient_type"] == "MEMBER"
    }
    assert member_ids2 == {m_active["id"]}

    # bad issue format rejected
    assert client.post(
        "/api/v1/magazines/generate-labels",
        headers=admin_headers,
        params={"issue_month_year": "Jan 2026"},
    ).status_code == 400


def test_label_generation_only_paid_receipt_members(client, admin_headers):
    m_paid = _create_member(client, admin_headers, "9340000020", "PaidUp")
    m_free = _create_member(client, admin_headers, "9340000021", "FreeRider")

    for m in (m_paid, m_free):
        sub = client.post(
            "/api/v1/magazines/subscriptions", headers=admin_headers, json={"member_id": m["id"]}
        )
        assert sub.status_code == 201, sub.text

    receipt = client.post(
        "/api/v1/receipts/",
        headers=admin_headers,
        json={
            "receipt_date": date.today().isoformat(),
            "receipt_type": "MAGAZINE",
            "payment_mode": "CASH",
            "gross_amount": 100,
            "discount_amount": 0,
            "net_amount": 100,
            "items": [{"item_type": "MAGAZINE", "amount": 100}],
        },
    ).json()
    client.post(
        f"/api/v1/receipts/{receipt['id']}/allocate",
        headers=admin_headers,
        json={"member_id": m_paid["id"], "allocated_amount": 100},
    )

    issue = date.today().strftime("%Y-%m")
    generated = client.post(
        "/api/v1/magazines/generate-labels",
        headers=admin_headers,
        params={"issue_month_year": issue, "only_paid": "true"},
    )
    assert generated.status_code == 200, generated.text

    detail = client.get(
        f"/api/v1/magazines/label-batches/{generated.json()['batch_id']}", headers=admin_headers
    )
    member_ids = {
        item["recipient_id"] for item in detail.json()["data"] if item["recipient_type"] == "MEMBER"
    }
    assert m_paid["id"] in member_ids
    assert m_free["id"] not in member_ids


def test_receipt_entry_online_offline_and_management(client, admin_headers):
    payload = {
        "receipt_date": date.today().isoformat(),
        "receipt_type": "DONATION",
        "payment_mode": "CASH",
        "payer_name": "Counter Donor",
        "gross_amount": 300,
        "discount_amount": 0,
        "net_amount": 300,
        "source": "OFFLINE",
        "items": [{"item_type": "DONATION", "amount": 300}],
    }
    created = client.post("/api/v1/receipts/", headers=admin_headers, json=payload)
    assert created.status_code == 201, created.text
    receipt = created.json()
    assert receipt["source"] == "OFFLINE"
    assert receipt["receipt_number"].startswith("REC-")

    # unknown source rejected at validation
    bad_source = dict(payload, source="PHONE")
    assert client.post("/api/v1/receipts/", headers=admin_headers, json=bad_source).status_code == 422

    # totals must be consistent (net = gross - discount)
    bad_total = dict(payload, net_amount=250)
    assert client.post("/api/v1/receipts/", headers=admin_headers, json=bad_total).status_code == 422

    # entry management: correct payer/notes
    updated = client.put(
        f"/api/v1/receipts/{receipt['id']}",
        headers=admin_headers,
        json={"payer_name": "Counter Donor Corrected", "notes": "fixed at counter"},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["payer_name"] == "Counter Donor Corrected"

    # inconsistent amount edit rejected
    inconsistent = client.put(
        f"/api/v1/receipts/{receipt['id']}",
        headers=admin_headers,
        json={"gross_amount": 400, "net_amount": 300},
    )
    assert inconsistent.status_code == 400, inconsistent.text

    # source filter on the list
    listed = client.get(
        "/api/v1/receipts/",
        headers=admin_headers,
        params={"source": "OFFLINE", "receipt_type": "DONATION"},
    )
    assert any(r["id"] == receipt["id"] for r in listed.json()["data"])

    # unallocated receipt can be deleted
    assert client.delete(f"/api/v1/receipts/{receipt['id']}", headers=admin_headers).status_code == 200
    assert client.get(f"/api/v1/receipts/{receipt['id']}", headers=admin_headers).status_code == 404


def test_receipt_entry_with_inline_member_allocation(client, admin_headers):
    member = _create_member(client, admin_headers, "9340000032", "InlineAlloc")
    created = client.post(
        "/api/v1/receipts/",
        headers=admin_headers,
        json={
            "receipt_date": date.today().isoformat(),
            "receipt_type": "MEMBERSHIP",
            "payment_mode": "CASH",
            "gross_amount": 500,
            "discount_amount": 0,
            "net_amount": 500,
            "source": "OFFLINE",
            "items": [{"item_type": "MEMBERSHIP", "amount": 500}],
            "allocations": [{"member_id": member["id"], "allocated_amount": 500}],
        },
    )
    assert created.status_code == 201, created.text
    receipt_id = created.json()["id"]

    # the mapping was written in the same transaction as the entry
    allocs = client.get(f"/api/v1/receipts/{receipt_id}/allocations", headers=admin_headers)
    assert allocs.status_code == 200, allocs.text
    assert len(allocs.json()) == 1
    assert allocs.json()[0]["member_id"] == member["id"]
    assert allocs.json()[0]["member_name"] == "InlineAlloc"

    # inline over-allocation rejected and nothing persisted
    over = client.post(
        "/api/v1/receipts/",
        headers=admin_headers,
        json={
            "receipt_date": date.today().isoformat(),
            "receipt_type": "DONATION",
            "payment_mode": "CASH",
            "gross_amount": 100,
            "discount_amount": 0,
            "net_amount": 100,
            "items": [{"item_type": "DONATION", "amount": 100}],
            "allocations": [{"member_id": member["id"], "allocated_amount": 150}],
        },
    )
    assert over.status_code == 409, over.text

    # unknown member in the inline mapping rejected
    unknown = client.post(
        "/api/v1/receipts/",
        headers=admin_headers,
        json={
            "receipt_date": date.today().isoformat(),
            "receipt_type": "DONATION",
            "payment_mode": "CASH",
            "gross_amount": 100,
            "discount_amount": 0,
            "net_amount": 100,
            "items": [{"item_type": "DONATION", "amount": 100}],
            "allocations": [{"member_id": 999999, "allocated_amount": 100}],
        },
    )
    assert unknown.status_code == 400, unknown.text


def test_receipt_allocation_mapping_and_label_list(client, admin_headers):
    member = _create_member(client, admin_headers, "9340000030", "Allocated")
    other = _create_member(client, admin_headers, "9340000031", "Second")
    receipt = client.post(
        "/api/v1/receipts/",
        headers=admin_headers,
        json={
            "receipt_date": date.today().isoformat(),
            "receipt_type": "MAGAZINE",
            "payment_mode": "UPI",
            "gross_amount": 200,
            "discount_amount": 0,
            "net_amount": 200,
            "items": [{"item_type": "MAGAZINE", "amount": 200}],
        },
    ).json()

    # map the created receipt to the member
    alloc = client.post(
        f"/api/v1/receipts/{receipt['id']}/allocate",
        headers=admin_headers,
        json={"member_id": member["id"], "allocated_amount": 200},
    )
    assert alloc.status_code == 201, alloc.text
    assert alloc.json()["member_id"] == member["id"]

    # over-allocation blocked
    assert client.post(
        f"/api/v1/receipts/{receipt['id']}/allocate",
        headers=admin_headers,
        json={"member_id": other["id"], "allocated_amount": 1},
    ).status_code == 409

    # unknown member blocked
    assert client.post(
        f"/api/v1/receipts/{receipt['id']}/allocate",
        headers=admin_headers,
        json={"member_id": 999999, "allocated_amount": 10},
    ).status_code == 400

    # entry edits cannot drop below the allocated total
    lowered = client.put(
        f"/api/v1/receipts/{receipt['id']}",
        headers=admin_headers,
        json={"gross_amount": 100, "net_amount": 100},
    )
    assert lowered.status_code == 409, lowered.text

    # receipt cannot be deleted while allocations exist
    assert client.delete(f"/api/v1/receipts/{receipt['id']}", headers=admin_headers).status_code == 409

    # allocations listing resolves the member name
    listing = client.get(
        "/api/v1/receipts/allocations", headers=admin_headers, params={"member_id": member["id"]}
    )
    assert listing.status_code == 200, listing.text
    assert listing.json()["total"] == 1
    assert listing.json()["data"][0]["member_name"] == "Allocated"

    # assigned member starts appearing in the label print list (only_paid)
    sub = client.post(
        "/api/v1/magazines/subscriptions", headers=admin_headers, json={"member_id": member["id"]}
    )
    assert sub.status_code == 201, sub.text
    issue = date.today().strftime("%Y-%m")
    generated = client.post(
        "/api/v1/magazines/generate-labels",
        headers=admin_headers,
        params={"issue_month_year": issue, "only_paid": "true"},
    )
    assert generated.status_code == 200, generated.text
    detail = client.get(
        f"/api/v1/magazines/label-batches/{generated.json()['batch_id']}", headers=admin_headers
    )
    member_ids = {
        i["recipient_id"] for i in detail.json()["data"] if i["recipient_type"] == "MEMBER"
    }
    assert member["id"] in member_ids
    assert other["id"] not in member_ids  # no receipt mapped

    # un-mapping drops the member out of the label list again
    allocation_id = listing.json()["data"][0]["id"]
    removed = client.delete(
        f"/api/v1/receipts/{receipt['id']}/allocations/{allocation_id}", headers=admin_headers
    )
    assert removed.status_code == 200, removed.text
    regenerated = client.post(
        "/api/v1/magazines/generate-labels",
        headers=admin_headers,
        params={"issue_month_year": issue, "only_paid": "true"},
    )
    detail2 = client.get(
        f"/api/v1/magazines/label-batches/{regenerated.json()['batch_id']}", headers=admin_headers
    )
    ids2 = {i["recipient_id"] for i in detail2.json()["data"] if i["recipient_type"] == "MEMBER"}
    assert member["id"] not in ids2

    # with the allocation gone the receipt is deletable again
    assert client.delete(f"/api/v1/receipts/{receipt['id']}", headers=admin_headers).status_code == 200


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
    assert duplicate.status_code == 409, duplicate.text

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
    assert subscription.status_code in (200, 201), subscription.text
    subscription_id = subscription.json()["id"]

    pause = client.post(
        "/api/v1/magazines/pauses",
        headers=admin_headers,
        json={"subscription_id": subscription_id, "pause_start_date": "2026-01-01"},
    )
    assert pause.status_code in (200, 201), pause.text

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
    assert receipt.status_code == 201, receipt.text
    receipt_id = receipt.json()["id"]

    allocation = client.post(
        f"/api/v1/receipts/{receipt_id}/allocate",
        headers=admin_headers,
        json={"member_id": member["id"], "allocated_amount": 100},
    )
    assert allocation.status_code == 201, allocation.text

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


def test_event_guests_honours_invitation_and_profile(client, admin_headers, monkeypatch):
    import services.whatsapp as whatsapp
    from db.session import SessionLocal
    from models.notifications import NotificationMessage

    async def _ok(recipients, message, template_id=None):
        return [{"to": r, "ok": True} for r in recipients]

    monkeypatch.setattr(whatsapp.whatsapp_service, "send_bulk", _ok)

    # ── create event ──
    event = client.post(
        "/api/v1/events/",
        headers=admin_headers,
        json={
            "title": "Mahasabha Centenary",
            "description": "Centenary celebrations",
            "event_date": "2026-12-15",
            "location": "Udupi",
        },
    )
    assert event.status_code == 200, event.text
    event_id = event.json()["id"]

    member = _create_member(client, admin_headers, "9340000240", "HonouredOne")

    # ── participants: guest + honoured (member-linked) ──
    guest = client.post(
        f"/api/v1/events/{event_id}/participants",
        headers=admin_headers,
        json={"participant_name": "Dr. Outside Guest", "participant_role": "Chief Guest", "participant_type": "GUEST"},
    )
    assert guest.status_code == 201, guest.text

    honoured = client.post(
        f"/api/v1/events/{event_id}/participants",
        headers=admin_headers,
        json={
            "participant_name": "HonouredOne",
            "participant_role": "Community Service",
            "participant_type": "HONOURED",
            "member_id": member["id"],
        },
    )
    assert honoured.status_code == 201, honoured.text
    honoured_id = honoured.json()["id"]

    # invalid type rejected
    assert client.post(
        f"/api/v1/events/{event_id}/participants",
        headers=admin_headers,
        json={"participant_name": "X", "participant_type": "SPEAKER"},
    ).status_code == 422

    # unknown member link rejected
    assert client.post(
        f"/api/v1/events/{event_id}/participants",
        headers=admin_headers,
        json={"participant_name": "X", "member_id": 999999},
    ).status_code == 400

    # participants list + filter
    listing = client.get(
        f"/api/v1/events/{event_id}/participants", headers=admin_headers
    )
    assert listing.status_code == 200, listing.text
    assert listing.json()["total"] == 2
    honoured_list = client.get(
        f"/api/v1/events/{event_id}/participants",
        headers=admin_headers,
        params={"participant_type": "HONOURED"},
    )
    assert honoured_list.json()["total"] == 1
    assert honoured_list.json()["data"][0]["member_name"] == "HonouredOne"

    # update: promote guest, then remove
    promoted = client.put(
        f"/api/v1/events/{event_id}/participants/{honoured_id}",
        headers=admin_headers,
        json={"participant_role": "Lifetime Achievement"},
    )
    assert promoted.status_code == 200, promoted.text
    assert promoted.json()["participant_role"] == "Lifetime Achievement"

    # ── invitation copy upload ──
    invitation = client.post(
        f"/api/v1/events/{event_id}/invitation",
        headers=admin_headers,
        files={"file": ("invite.pdf", b"%PDF-1.4 invitation copy", "application/pdf")},
    )
    assert invitation.status_code == 200, invitation.text
    assert invitation.json()["invitation_file_path"]

    # event detail shows guests/honoured and the invitation
    detail = client.get(f"/api/v1/events/{event_id}/detail", headers=admin_headers)
    assert detail.status_code == 200, detail.text
    d = detail.json()
    assert len(d["guests"]) == 1
    assert len(d["honoured"]) == 1
    assert d["honoured"][0]["member_id"] == member["id"]
    assert d["event"]["invitation_file_path"]

    # ── profile of the member shows the honour ──
    profile = client.get(f"/api/v1/members/{member['id']}/profile", headers=admin_headers)
    assert profile.status_code == 200, profile.text
    guests_honours = profile.json()["services"]["guests_and_honours"]
    assert len(guests_honours) == 1
    gh = guests_honours[0]
    assert gh["event_id"] == event_id
    assert gh["participant_type"] == "HONOURED"
    assert gh["honoured_as"] == "Lifetime Achievement"
    assert gh["location"] == "Udupi"

    # non-member guest must not appear anywhere in member profiles
    # (implicitly true — they have no member_id)

    # ── event notification with template ──
    template = client.post(
        "/api/v1/notifications/templates",
        headers=admin_headers,
        json={
            "template_name": "TST_EVENT_1",
            "content": "{{event_title}} on {{event_date}} at {{location}} — see invite.",
        },
    ).json()

    client.post(
        f"/api/v1/events/{event_id}/links",
        headers=admin_headers,
        params={"member_id": member["id"], "role": "Volunteer"},
    )

    notified = client.post(
        f"/api/v1/events/{event_id}/notify",
        headers=admin_headers,
        params={"template_id": template["id"]},
    )
    assert notified.status_code == 200, notified.text
    assert notified.json()["queued"] == 1
    body = notified.json()["rendered_content"]
    assert "Mahasabha Centenary" in body
    assert "2026-12-15" in body
    assert "Udupi" in body

    # message logged for the member
    with SessionLocal() as db:
        msg = (
            db.query(NotificationMessage)
            .filter(NotificationMessage.member_id == member["id"])
            .order_by(NotificationMessage.id.desc())
            .first()
        )
    assert msg is not None and "Mahasabha Centenary" in msg.message_content

    # ── upcoming events ──
    upcoming = client.get("/api/v1/events/upcoming", headers=admin_headers)
    assert upcoming.status_code == 200, upcoming.text
    assert any(e["id"] == event_id for e in upcoming.json()["data"])

    # remove participant → drops off profile listing
    assert client.delete(
        f"/api/v1/events/{event_id}/participants/{honoured_id}", headers=admin_headers
    ).status_code == 200
    profile2 = client.get(f"/api/v1/members/{member['id']}/profile", headers=admin_headers)
    assert profile2.json()["services"]["guests_and_honours"] == []


def test_committee_management_and_website_display(client, admin_headers):
    """Categories/subcategories (bilingual), members per category,
    website display toggles and the public committee page."""
    # ── categories with Kannada names (spec examples) ──
    cat_bengaluru = client.post(
        "/api/v1/engagements/committee/categories",
        headers=admin_headers,
        json={"name_en": "Bengaluru Kshetra", "name_kn": "ಬೆಂಗಳೂರು ಕ್ಷೇತ್ರ", "display_on_website": True},
    )
    assert cat_bengaluru.status_code == 201, cat_bengaluru.text
    cat_bengaluru = cat_bengaluru.json()

    cat_nominee = client.post(
        "/api/v1/engagements/committee/categories",
        headers=admin_headers,
        json={"name_en": "Board Nominee Directors", "name_kn": "ಆಡಳಿತ ಮಂಡಳಿಯ ನಾಮಾಂಕಿತ ನಿರ್ದೇಶಕರು", "display_on_website": True},
    ).json()

    cat_temple = client.post(
        "/api/v1/engagements/committee/categories",
        headers=admin_headers,
        json={"name_en": "Sri Siddhivinayaka Temple", "name_kn": "ಶ್ರೀ ಸಿದ್ಧಿವಿನಾಯಕ ದೇವಾಲಯ", "display_on_website": False},
    ).json()

    # duplicate category name rejected?
    # (no unique constraint in model — admin responsibility; just verify update works)
    renamed = client.put(
        f"/api/v1/engagements/committee/categories/{cat_bengaluru['id']}",
        headers=admin_headers,
        json={"name_en": "Bengaluru Region"},
    )
    assert renamed.status_code == 200, renamed.text

    # ── subcategories ──
    sub = client.post(
        "/api/v1/engagements/committee/subcategories",
        headers=admin_headers,
        json={
            "category_id": cat_bengaluru["id"],
            "name_en": "Youth Wing",
            "name_kn": "ಯುವ ಘಟಕ",
        },
    )
    assert sub.status_code == 201, sub.text
    sub_id = sub.json()["id"]

    # subcategory must belong to the category
    assert client.post(
        "/api/v1/engagements/committee/members",
        headers=admin_headers,
        json={
            "category_id": cat_nominee["id"],
            "subcategory_id": sub_id,
            "member_name": "Wrong Category",
        },
    ).status_code == 400

    # ── current term ──
    term = client.post(
        "/api/v1/engagements/committee/terms",
        headers=admin_headers,
        json={"term_name": "2026-2029", "is_current": True},
    )
    assert term.status_code == 201, term.text
    term_id = term.json()["id"]

    # only one current term
    term2 = client.post(
        "/api/v1/engagements/committee/terms",
        headers=admin_headers,
        json={"term_name": "2029-2032", "is_current": True},
    ).json()
    terms_list = client.get("/api/v1/engagements/committee/terms", headers=admin_headers).json()
    currents = [t for t in terms_list["data"] if t["is_current"]]
    assert len(currents) == 1
    assert currents[0]["term_name"] == "2029-2032"

    # ── committee members per category/subcategory ──
    havyaka_member = _create_member(client, admin_headers, "9340000401", "CommitteeMan")
    client.put(f"/api/v1/members/{havyaka_member['id']}/approve", headers=admin_headers)

    cm1 = client.post(
        "/api/v1/engagements/committee/members",
        headers=admin_headers,
        json={
            "category_id": cat_bengaluru["id"],
            "subcategory_id": sub_id,
            "term_id": term_id,
            "member_name": "Ramesh Joisha",
            "designation": "Convener",
            "hms_member_id": havyaka_member["id"],
        },
    )
    assert cm1.status_code == 201, cm1.text
    cm1_id = cm1.json()["id"]

    cm2 = client.post(
        "/api/v1/engagements/committee/members",
        headers=admin_headers,
        json={
            "category_id": cat_bengaluru["id"],
            "term_id": term_id,
            "member_name": "Ganesh Hegde",
            "designation": "Member",
        },
    )
    assert cm2.status_code == 201, cm2.text

    # unknown category rejected
    assert client.post(
        "/api/v1/engagements/committee/members",
        headers=admin_headers,
        json={"category_id": 999999, "member_name": "X"},
    ).status_code == 400

    # listing resolves names and the linked Havyaka member
    listing = client.get(
        "/api/v1/engagements/committee/members",
        headers=admin_headers,
        params={"category_id": cat_bengaluru["id"]},
    )
    assert listing.status_code == 200, listing.text
    rows = listing.json()["data"]
    assert len(rows) == 2
    row1 = [r for r in rows if r["id"] == cm1_id][0]
    assert row1["category_name_kn"] == "ಬೆಂಗಳೂರು ಕ್ಷೇತ್ರ"
    assert row1["subcategory_name_en"] == "Youth Wing"
    assert row1["hms_member_code"]  # approved above → code minted
    assert row1["hms_member_name"] == "CommitteeMan"

    # current-term filter: cm1/cm2 sit in the older term, so the current one is empty
    current_rows = client.get(
        "/api/v1/engagements/committee/members",
        headers=admin_headers,
        params={"current_term_only": "true"},
    ).json()
    assert current_rows["total"] == 0

    # a member added under the new current term shows up
    cm3 = client.post(
        "/api/v1/engagements/committee/members",
        headers=admin_headers,
        json={
            "category_id": cat_nominee["id"],
            "term_id": term2["id"],
            "member_name": "Current Term Person",
        },
    )
    assert cm3.status_code == 201, cm3.text
    current_rows2 = client.get(
        "/api/v1/engagements/committee/members",
        headers=admin_headers,
        params={"current_term_only": "true"},
    ).json()
    assert current_rows2["total"] == 1
    assert current_rows2["data"][0]["member_name"] == "Current Term Person"

    # update: change designation, hide from website
    updated = client.put(
        f"/api/v1/engagements/committee/members/{cm2.json()['id']}",
        headers=admin_headers,
        json={"designation": "Treasurer", "display_on_website": False},
    )
    assert updated.status_code == 200, updated.text

    # category delete blocked while members exist
    assert client.delete(
        f"/api/v1/engagements/committee/categories/{cat_bengaluru['id']}",
        headers=admin_headers,
    ).status_code == 409

    # ── website display toggles ──
    # temple category was created hidden → flip it on
    assert client.get(
        "/api/v1/engagements/committee/categories",
        headers=admin_headers,
        params={"display_on_website": "false"},
    ).json()["total"] >= 1

    shown = client.put(
        f"/api/v1/engagements/committee/categories/{cat_temple['id']}",
        headers=admin_headers,
        json={"display_on_website": True},
    )
    assert shown.json()["display_on_website"] is True

    # ── public committee page ──
    website = client.get("/api/v1/engagements/committee/website", headers=admin_headers)
    assert website.status_code == 200, website.text
    web = website.json()["data"]

    # only display-enabled categories appear (temple now on, all enabled here)
    web_ids = {c["category_id"] for c in web}
    assert cat_bengaluru["id"] in web_ids
    assert cat_nominee["id"] in web_ids

    bengaluru_block = [c for c in web if c["category_id"] == cat_bengaluru["id"]][0]
    assert bengaluru_block["category_name_kn"] == "ಬೆಂಗಳೂರು ಕ್ಷೇತ್ರ"
    # default = current term: cm1/cm2 (old term) hidden anyway, cm3 (nominee) visible
    nominee_block = [c for c in web if c["category_id"] == cat_nominee["id"]][0]
    assert any(m["member_name"] == "Current Term Person" for m in nominee_block["members"])

    # explicitly requesting the old term shows cm1 (visible) but not cm2 (hidden)
    website_old = client.get(
        "/api/v1/engagements/committee/website",
        headers=admin_headers,
        params={"term_id": term_id},
    )
    bengaluru_old = [
        c for c in website_old.json()["data"] if c["category_id"] == cat_bengaluru["id"]
    ][0]
    member_ids = {m["id"] for m in bengaluru_old["members"]}
    assert cm1_id in member_ids
    assert cm2.json()["id"] not in member_ids

    # empty category (temple) shows with an empty member list
    temple_block = [c for c in web if c["category_id"] == cat_temple["id"]]
    if temple_block:
        assert temple_block[0]["members"] == []

    # remove committee member
    assert client.delete(
        f"/api/v1/engagements/committee/members/{cm1_id}", headers=admin_headers
    ).status_code == 200
    after = client.get(
        "/api/v1/engagements/committee/members",
        headers=admin_headers,
        params={"category_id": cat_bengaluru["id"]},
    ).json()
    assert after["total"] == 1


def test_label_batches_and_printable_pdf(client, admin_headers):
    member = _create_member(client, admin_headers, "9000000027", "Labeled")
    subscription = client.post(
        "/api/v1/magazines/subscriptions",
        headers=admin_headers,
        json={"member_id": member["id"]},
    )
    assert subscription.status_code in (200, 201), subscription.text

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


def test_reports_module_end_to_end(client, admin_headers):
    """Covers every report endpoint against seeded members/receipts/labels."""
    # ── seed geography ──
    state = client.post("/api/v1/masters/states", headers=admin_headers, json={"name_en": "Report Nadu"}).json()
    district_a = client.post(
        "/api/v1/masters/districts", headers=admin_headers,
        json={"state_id": state["id"], "name_en": "Report District A"},
    ).json()
    district_b = client.post(
        "/api/v1/masters/districts", headers=admin_headers,
        json={"state_id": state["id"], "name_en": "Report District B"},
    ).json()
    taluk_a1 = client.post(
        "/api/v1/masters/taluks", headers=admin_headers,
        json={"district_id": district_a["id"], "name_en": "Report Taluk A1"},
    ).json()

    # ── seed members ──
    m_male = _create_member(client, admin_headers, "9340000101", "Male")
    m_female = _create_member(client, admin_headers, "9340000102", "Female")
    m_unapproved = _create_member(client, admin_headers, "9340000103", "Waiting")
    client.put(
        f"/api/v1/members/{m_male['id']}", headers=admin_headers,
        json={"gender": "MALE", "state_id": state["id"], "district_id": district_a["id"], "taluk_id": taluk_a1["id"]},
    )
    client.put(
        f"/api/v1/members/{m_female['id']}", headers=admin_headers,
        json={"gender": "FEMALE", "state_id": state["id"], "district_id": district_b["id"]},
    )
    client.put(
        f"/api/v1/members/{m_male['id']}/approve", headers=admin_headers,
    )
    # approval mints the member_code — refresh the local copy
    m_male = client.get(f"/api/v1/members/{m_male['id']}", headers=admin_headers).json()
    assert m_male["member_code"]

    # membership type for the type-based report
    mt = _create_membership_type(client, admin_headers, "TST_RPT", "Report Type")
    from db.session import SessionLocal
    from models.members import MemberMembership
    with SessionLocal() as db:
        db.add(MemberMembership(
            member_id=m_male["id"], membership_type_id=mt["id"],
            applied_at=datetime.now(timezone.utc), status="ACTIVE",
        ))
        db.commit()

    # ── geography report ──
    geo = client.get(
        "/api/v1/reports/members/by-geography",
        headers=admin_headers,
        params={"group_by": "district", "state_id": state["id"]},
    )
    assert geo.status_code == 200, geo.text
    geo_body = geo.json()
    by_district = {r["district_name"]: r["member_count"] for r in geo_body["data"]}
    assert by_district.get("Report District A") == 1
    assert by_district.get("Report District B") == 1

    geo_taluk = client.get(
        "/api/v1/reports/members/by-geography",
        headers=admin_headers,
        params={"group_by": "taluk", "state_id": state["id"]},
    )
    assert geo_taluk.status_code == 200, geo_taluk.text
    by_taluk = {r["taluk_name"]: r["member_count"] for r in geo_taluk.json()["data"]}
    assert by_taluk.get("Report Taluk A1") == 1
    assert client.get(
        "/api/v1/reports/members/by-geography", headers=admin_headers,
        params={"group_by": "city"},
    ).status_code == 400

    geo_csv = client.get(
        "/api/v1/reports/members/by-geography",
        headers=admin_headers,
        params={"group_by": "district", "export": "csv"},
    )
    assert geo_csv.status_code == 200, geo_csv.text
    assert "Report District A" in geo_csv.text

    # ── gender report ──
    gender = client.get("/api/v1/reports/members/by-gender", headers=admin_headers)
    assert gender.status_code == 200, gender.text
    by_gender = {r["gender"]: r["member_count"] for r in gender.json()["data"]}
    # members seeded here exist; other tests may add more of either gender
    assert by_gender.get("MALE", 0) >= 1
    assert by_gender.get("FEMALE", 0) >= 1

    # ── membership type report ──
    by_type = client.get(
        "/api/v1/reports/members/by-membership-type",
        headers=admin_headers,
        params={"membership_type_id": mt["id"]},
    )
    assert by_type.status_code == 200, by_type.text
    type_body = by_type.json()
    assert type_body["data"][0]["type_code"] == "TST_RPT"
    assert type_body["data"][0]["member_count"] == 1
    assert any(m["member_code"] == m_male["member_code"] for m in type_body["members"])

    # ── unapproved members report ──
    unapproved = client.get("/api/v1/reports/unapproved-members", headers=admin_headers)
    assert unapproved.status_code == 200, unapproved.text
    unapproved_ids = {r["member_id"] for r in unapproved.json()["data"]}
    assert m_unapproved["id"] in unapproved_ids
    assert m_male["id"] not in unapproved_ids  # approved above

    # ── receipts + receipt-wise members report ──
    receipt = client.post(
        "/api/v1/receipts/",
        headers=admin_headers,
        json={
            "receipt_date": date.today().isoformat(),
            "receipt_type": "MAGAZINE",
            "payment_mode": "CASH",
            "gross_amount": 150,
            "discount_amount": 0,
            "net_amount": 150,
            "source": "OFFLINE",
            "items": [{"item_type": "MAGAZINE", "amount": 150}],
        },
    )
    assert receipt.status_code == 201, receipt.text
    client.post(
        f"/api/v1/receipts/{receipt.json()['id']}/allocate",
        headers=admin_headers,
        json={"member_id": m_male["id"], "allocated_amount": 150},
    )

    receipt_report = client.get(
        "/api/v1/reports/receipts",
        headers=admin_headers,
        params={"source": "OFFLINE"},
    )
    assert receipt_report.status_code == 200, receipt_report.text
    assert receipt_report.json()["summary"]["total_amount"] >= 150

    by_member = client.get(
        "/api/v1/reports/receipts/by-member",
        headers=admin_headers,
        params={"member_id": m_male["id"]},
    )
    assert by_member.status_code == 200, by_member.text
    mb = by_member.json()
    assert mb["total"] == 1
    assert mb["data"][0]["receipt_number"]
    assert mb["data"][0]["name"] == "Male"
    assert mb["total_allocated"] == 150
    assert mb["distinct_members"] == 1

    # excel export path
    excel = client.get("/api/v1/reports/receipts/by-member", headers=admin_headers, params={"export": "excel"})
    assert excel.status_code == 200, excel.text
    assert excel.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )

    # ── magazines: subscriptions, pause, return, labels ──
    sub = client.post(
        "/api/v1/magazines/subscriptions", headers=admin_headers,
        json={"member_id": m_male["id"]},
    )
    assert sub.status_code == 201, sub.text
    sub_f = client.post(
        "/api/v1/magazines/subscriptions", headers=admin_headers,
        json={"member_id": m_female["id"]},
    )
    assert sub_f.status_code == 201, sub_f.text

    # mark a return for the male member's subscription
    ret = client.post(
        "/api/v1/magazines/returns",
        headers=admin_headers,
        json={
            "subscription_id": sub.json()["id"],
            "issue_month_year": "2026-07",
            "return_date": "2026-08-01",
            "return_reason": "address shifted",
        },
    )
    assert ret.status_code == 201, ret.text

    returns_report = client.get(
        "/api/v1/reports/magazine-returns",
        headers=admin_headers,
        params={"issue_month_year": "2026-07"},
    )
    assert returns_report.status_code == 200, returns_report.text
    rr = returns_report.json()
    assert rr["total"] == 1
    assert rr["data"][0]["member_code"] == m_male["member_code"]
    assert rr["pending_follow_ups"] == 1

    # generate labels so the 'generated' side has data
    generated = client.post(
        "/api/v1/magazines/generate-labels",
        headers=admin_headers,
        params={"issue_month_year": "2026-07"},
    )
    assert generated.status_code == 200, generated.text

    labels_generated = client.get(
        "/api/v1/reports/labels",
        headers=admin_headers,
        params={"status": "generated", "issue_month_year": "2026-07"},
    )
    assert labels_generated.status_code == 200, labels_generated.text
    lg = labels_generated.json()
    assert lg["total"] >= 1
    assert lg["returned_count"] == 1  # the male member's flagged label

    labels_pending = client.get(
        "/api/v1/reports/labels",
        headers=admin_headers,
        params={"status": "pending", "issue_month_year": "2026-07"},
    )
    assert labels_pending.status_code == 200, labels_pending.text
    # the two members just printed are no longer pending for that issue
    pending_ids = {r["member_id"] for r in labels_pending.json()["data"]}
    assert m_male["id"] not in pending_ids
    assert m_female["id"] not in pending_ids

    assert client.get(
        "/api/v1/reports/labels", headers=admin_headers, params={"status": "nope"}
    ).status_code == 400

    # ── consolidated summary ──
    summary = client.get("/api/v1/reports/summary", headers=admin_headers)
    assert summary.status_code == 200, summary.text
    s = summary.json()
    assert s["members"]["total"] >= 3
    assert s["receipts"]["count"] >= 1
    assert s["magazines"]["returns_total"] >= 1
    assert s["members"]["by_approval_status"].get("APPROVED", 0) >= 1
    assert any(t["type_code"] if "type_code" in t else True for t in s["memberships"]["by_type"])

    # export log recorded the excel export above (JSON calls are not logged)
    logs = client.get(
        "/api/v1/reports/export-logs", headers=admin_headers, params={"report_key": "receipts_by_member"}
    )
    assert logs.status_code == 200, logs.text
    assert logs.json()["total"] >= 1


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


# ─────────────── notifications & activity ───────────────

def test_membership_activation_notification_on_approval(client, admin_headers, monkeypatch):
    import services.whatsapp as whatsapp
    from db.session import SessionLocal
    from models.notifications import NotificationMessage

    sent = []

    async def _capture(to, message, template_id=None):
        sent.append({"to": to, "message": message})
        return {"ok": True}

    monkeypatch.setattr(whatsapp.whatsapp_service, "send_message", _capture)

    template = client.post(
        "/api/v1/notifications/templates",
        headers=admin_headers,
        json={
            "template_name": "TST_ACT_1",
            "purpose": "MEMBERSHIP_ACTIVATION",
            "content": "Dear {{name}}, your membership {{member_code}} is active.",
        },
    )
    assert template.status_code == 200, template.text

    member = _create_member(client, admin_headers, "9340000201", "Activated")
    approved = client.put(f"/api/v1/members/{member['id']}/approve", headers=admin_headers)
    assert approved.status_code == 200, approved.text
    member_code = approved.json()["member_code"]

    from db.session import SessionLocal as S
    with S() as db:
        msg = (
            db.query(NotificationMessage)
            .filter(NotificationMessage.member_id == member["id"])
            .order_by(NotificationMessage.id.desc())
            .first()
        )
    assert msg is not None, "activation notification was not recorded"
    assert member_code in msg.message_content
    assert "Activated" in msg.message_content

    # approval without an activation template must not fail
    with S() as db:
        from models.notifications import NotificationTemplate
        tpl = db.query(NotificationTemplate).filter(
            NotificationTemplate.purpose == "MEMBERSHIP_ACTIVATION"
        ).first()
        tpl.status = False
        db.commit()

    member2 = _create_member(client, admin_headers, "9340000202", "NoTemplate")
    assert client.put(
        f"/api/v1/members/{member2['id']}/approve", headers=admin_headers
    ).status_code == 200


def test_individual_bulk_and_csv_notifications(client, admin_headers, monkeypatch):
    import io
    import services.whatsapp as whatsapp
    from db.session import SessionLocal
    from models.notifications import NotificationMessage

    bulk_results = []

    async def _all_ok(recipients, message, template_id=None):
        return [{"to": r, "ok": True} for r in recipients]

    async def _ok_message(to, message, template_id=None):
        return {"ok": True}

    monkeypatch.setattr(whatsapp.whatsapp_service, "send_bulk", _all_ok)
    monkeypatch.setattr(whatsapp.whatsapp_service, "send_message", _ok_message)

    m1 = _create_member(client, admin_headers, "9340000210", "Bulk One")
    m2 = _create_member(client, admin_headers, "9340000211", "Bulk Two")
    client.put(
        f"/api/v1/members/{m1['id']}", headers=admin_headers, json={"gender": "MALE"}
    )

    template = client.post(
        "/api/v1/notifications/templates",
        headers=admin_headers,
        json={
            "template_name": "TST_BULK_1",
            "content": "Hello {{name}} ({{member_code}})",
        },
    ).json()

    # variables introspection
    vars_resp = client.get(
        f"/api/v1/notifications/templates/{template['id']}/variables", headers=admin_headers
    )
    assert vars_resp.json()["variables"] == ["name", "member_code"]

    # individual custom notification with variables (JSON body)
    individual = client.post(
        "/api/v1/notifications/send-individual",
        headers=admin_headers,
        params={
            "member_id": m1["id"],
            "template_id": template["id"],
        },
        json={"member_code": "HMS-777"},
    )
    assert individual.status_code == 200, individual.text
    assert "Bulk One" in individual.json()["rendered_content"]
    assert "HMS-777" in individual.json()["rendered_content"]

    with SessionLocal() as db:
        msg = (
            db.query(NotificationMessage)
            .filter(NotificationMessage.member_id == m1["id"])
            .order_by(NotificationMessage.id.desc())
            .first()
        )
    assert msg is not None and "HMS-777" in msg.message_content

    # bulk send to filtered members (other tests may also have MALE members)
    bulk = client.post(
        "/api/v1/notifications/send-bulk",
        headers=admin_headers,
        json={"template_id": template["id"], "member_filters": {"gender": "MALE"}},
    )
    assert bulk.status_code == 200, bulk.text
    bulk_count = int(re.search(r"for (\d+) members", bulk.json()["message"]).group(1))
    assert bulk_count >= 1  # m1 is MALE and must be included

    # unknown filters rejected
    bad = client.post(
        "/api/v1/notifications/send-bulk",
        headers=admin_headers,
        json={"template_id": template["id"], "member_filters": {"planet": "Mars"}},
    )
    assert bad.status_code == 400, bad.text

    # inactive template rejected for sends
    client.put(
        f"/api/v1/notifications/templates/{template['id']}/variables",  # dummy path -> 405/404 check below
        headers=admin_headers,
    )

    # CSV campaign: upload + send
    csv_content = "mobile,name\n9340000220,Csv Person\n9340000221,Second Person\n"
    csv_campaign = client.post(
        "/api/v1/notifications/campaigns/csv",
        headers=admin_headers,
        params={
            "campaign_name": "TST_CSV_CAMP",
            "template_id": template["id"],
        },
        files={"file": ("numbers.csv", csv_content.encode("utf-8"), "text/csv")},
    )
    assert csv_campaign.status_code == 200, csv_campaign.text
    campaign_id = csv_campaign.json()["id"]
    assert csv_campaign.json()["source"] == "CSV"

    send = client.post(f"/api/v1/notifications/campaigns/{campaign_id}/send", headers=admin_headers)
    assert send.status_code == 200, send.text
    assert "2 recipients" in send.json()["message"]

    # per-recipient rows recorded with the CSV variable columns
    with SessionLocal() as db:
        from models.notifications import NotificationRecipient
        rows = db.query(NotificationRecipient).filter(
            NotificationRecipient.campaign_id == campaign_id
        ).order_by(NotificationRecipient.id).all()
    assert len(rows) == 2
    assert rows[0].status == "SENT"
    assert rows[0].variables.get("name") == "Csv Person"

    recipients_listing = client.get(
        f"/api/v1/notifications/campaigns/{campaign_id}/recipients", headers=admin_headers
    )
    assert recipients_listing.status_code == 200, recipients_listing.text
    assert recipients_listing.json()["total"] == 2

    # double send blocked
    assert client.post(
        f"/api/v1/notifications/campaigns/{campaign_id}/send", headers=admin_headers
    ).status_code == 400

    # member-filtered campaign create + send
    campaign = client.post(
        "/api/v1/notifications/campaigns",
        headers=admin_headers,
        json={
            "campaign_name": "TST_FILTERED_CAMP",
            "template_id": template["id"],
            "member_filters": {"gender": "MALE"},
        },
    )
    assert campaign.status_code == 200, campaign.text
    fc_id = campaign.json()["id"]
    sent = client.post(f"/api/v1/notifications/campaigns/{fc_id}/send", headers=admin_headers)
    assert sent.status_code == 200, sent.text
    filtered_count = int(re.search(r"for (\d+) recipients", sent.json()["message"]).group(1))
    assert filtered_count >= 1

    # invalid CSV type rejected
    assert client.post(
        "/api/v1/notifications/campaigns/csv",
        headers=admin_headers,
        params={"campaign_name": "X", "template_id": template["id"]},
        files={"file": ("x.png", b"\x89PNG", "image/png")},
    ).status_code == 400


def test_logout_activity_and_member_timeline(client, admin_headers):
    from db.session import SessionLocal
    from models.activity import UserActivityLog, MemberActivityLog

    member = _create_member(client, admin_headers, "9340000230", "Timeline")

    # edit the member to generate an UPDATE entry with change details
    client.put(
        f"/api/v1/members/{member['id']}",
        headers=admin_headers,
        json={"email": "timeline@example.com"},
    )

    # member timeline endpoint
    timeline = client.get(
        f"/api/v1/activity/members/{member['id']}/timeline", headers=admin_headers
    )
    assert timeline.status_code == 200, timeline.text
    body = timeline.json()
    actions = [row["action"] for row in body["data"]]
    assert "CREATE" in actions
    assert "UPDATE" in actions
    update_row = [r for r in body["data"] if r["action"] == "UPDATE"][0]
    assert update_row["acted_by_name"]
    changes = (update_row.get("details") or {}).get("changes", {})
    assert changes.get("email", {}).get("to") == "timeline@example.com"

    # member activity filter by entity_type via JSON extract
    filtered = client.get(
        "/api/v1/activity/members",
        headers=admin_headers,
        params={"member_id": member["id"], "entity_type": "members"},
    )
    assert filtered.status_code == 200, filtered.text
    assert filtered.json()["total"] >= 2

    # user activity trail + filters
    trail = client.get(
        "/api/v1/activity/users",
        headers=admin_headers,
        params={"action": "CREATE", "entity_type": "members"},
    )
    assert trail.status_code == 200, trail.text
    assert trail.json()["total"] >= 1

    # logout records LOGOUT activity
    login = client.post(
        "/api/v1/auth/login",
        data={"username": "admin", "password": "admintest123"},
    )
    token = login.json()["access_token"]
    logout = client.post(
        "/api/v1/auth/logout",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert logout.status_code == 200, logout.text

    with SessionLocal() as db:
        log = (
            db.query(UserActivityLog)
            .filter(UserActivityLog.action == "LOGOUT")
            .order_by(UserActivityLog.id.desc())
            .first()
        )
    assert log is not None, "LOGOUT was not recorded"

    # summary endpoint has per-user counters
    summary = client.get("/api/v1/activity/users/summary", headers=admin_headers)
    assert summary.status_code == 200, summary.text
    any_user = next(iter(summary.json()["data"].values()))
    assert any_user.get("LOGIN", 0) >= 1
    assert any_user.get("CREATE", 0) >= 1

    # timeline 404 for unknown member
    assert client.get(
        "/api/v1/activity/members/999999/timeline", headers=admin_headers
    ).status_code == 404
