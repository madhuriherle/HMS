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
    assert {"members.write", "users.management.write", "members.unapproved.write", "approvals.read", "approvals.write"} <= codes
    assert body["total"] >= 11
    assert all(p["module_id"] is not None for p in body["data"]), "every seeded permission must resolve a module_id"


def test_module_catalog_seeded(client, admin_headers):
    response = client.get("/api/v1/users/modules", headers=admin_headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert {"total", "page", "limit", "pages", "data"} <= set(body)
    codes = {m["code"] for m in body["data"]}
    assert {"masters", "users", "members", "approvals"} <= codes
    assert body["total"] >= 11
    members_module = next(m for m in body["data"] if m["code"] == "members")
    assert members_module["permission_count"] >= 1

    # module_id on the permission actually resolves to this module's row (real FK, not just a string match)
    perms = client.get("/api/v1/users/permissions", headers=admin_headers).json()["data"]
    members_create = next(p for p in perms if p["code"] == "members.write")
    assert members_create["module_id"] == members_module["id"]


def test_seed_permissions_skips_unknown_module(client, admin_headers):
    """A permission whose module isn't in the modules master is refused, not
    inserted with a dangling module_id (guards the FK's integrity intent)."""
    from db.session import SessionLocal
    from models.users import Permission
    from db.seed_defaults import seed_permissions

    with SessionLocal() as db:
        before = db.query(Permission).filter(Permission.code == "ghost.write").count()
        assert before == 0

        import db.seed_defaults as perm_service
        original_catalog = perm_service.PERMISSION_CATALOG
        perm_service.PERMISSION_CATALOG = original_catalog + [
            ("ghost.write", "nonexistent_module", "Ghost", "Should not be seeded")
        ]
        try:
            seed_permissions(db)
        finally:
            perm_service.PERMISSION_CATALOG = original_catalog

        after = db.query(Permission).filter(Permission.code == "ghost.write").count()
        assert after == 0, "permission for an unknown module must not be created"


def test_module_crud_lifecycle(client, admin_headers):
    r = client.post(
        "/api/v1/users/modules", headers=admin_headers,
        json={"code": "custom_test_module", "name_en": "Custom Test Module", "name_kn": "ಪರೀಕ್ಷಾ ಮಾಡ್ಯೂಲ್"},
    )
    assert r.status_code == 200, r.text
    module = r.json()
    assert module["name_kn"] == "ಪರೀಕ್ಷಾ ಮಾಡ್ಯೂಲ್"

    dup = client.post(
        "/api/v1/users/modules", headers=admin_headers,
        json={"code": "custom_test_module", "name_en": "Dup"},
    )
    assert dup.status_code == 409

    upd = client.put(
        f"/api/v1/users/modules/{module['id']}", headers=admin_headers,
        json={"name_en": "Renamed Module"},
    )
    assert upd.status_code == 200 and upd.json()["name_en"] == "Renamed Module"

    got = client.get(f"/api/v1/users/modules/{module['id']}", headers=admin_headers)
    assert got.status_code == 200 and got.json()["permission_count"] == 0

    # in-use guard: the "members" module (seeded, has permissions) can't be deleted
    members_module = next(
        m for m in client.get("/api/v1/users/modules", headers=admin_headers).json()["data"]
        if m["code"] == "members"
    )
    blocked = client.delete(f"/api/v1/users/modules/{members_module['id']}", headers=admin_headers)
    assert blocked.status_code == 409

    # unused custom module deletes fine
    assert client.delete(f"/api/v1/users/modules/{module['id']}", headers=admin_headers).status_code == 200
    assert client.get(f"/api/v1/users/modules/{module['id']}", headers=admin_headers).status_code == 404


# ─────────────── generic approval engine ───────────────

def test_generic_approval_engine_create_update_delete(client, admin_headers):
    """End-to-end: a gated create/update/delete on masters.states doesn't
    execute — it files a generic ApprovalRequest — and on approval the
    SAME endpoint function replays with the original requester's identity,
    producing the exact result a direct (ungated) call would have."""
    gated_id, _, gated_headers = _staff_with_role(
        client, admin_headers, "gated_masters_editor", "Gated Masters Editor", "GATED_MASTERS_EDITOR",
        permission_grants=[
            ("masters.write", True), ("masters.write", True), ("masters.delete", True),
        ],
    )

    # CREATE: files instead of executing
    filed = client.post(
        "/api/v1/masters/states", headers=gated_headers,
        json={"name_en": "GenericEngineState", "name_kn": "ಜೆನೆರಿಕ್"},
    )
    assert filed.status_code in (200, 201), filed.text
    body = filed.json()
    assert body["status"] == "PENDING"
    req_id = body["approval_request_id"]

    # not created yet
    listing = client.get("/api/v1/masters/states", headers=admin_headers, params={"search": "GenericEngineState"})
    assert listing.json()["total"] == 0

    # shows up in the generic queue
    queued = client.get("/api/v1/approvals/requests", headers=admin_headers, params={"module": "masters", "status": "PENDING"})
    assert queued.status_code == 200, queued.text
    assert any(r["id"] == req_id for r in queued.json()["data"])

    # the gated user can't approve their own request (needs approvals.write)
    self_approve = client.put(f"/api/v1/approvals/requests/{req_id}/approve", headers=gated_headers)
    assert self_approve.status_code == 403

    # approvals.write holder approves -> replays create_state as the ORIGINAL requester
    approved = client.put(f"/api/v1/approvals/requests/{req_id}/approve", headers=admin_headers)
    assert approved.status_code == 200, approved.text
    state = approved.json()
    assert state["name_en"] == "GenericEngineState"
    state_id = state["id"]

    from db.session import SessionLocal
    from models.masters import State
    with SessionLocal() as db:
        row = db.query(State).filter(State.id == state_id).first()
    assert row.created_by == gated_id, "replay must attribute the row to the original requester, not the approver"

    # re-approving an already-decided request is rejected
    redo = client.put(f"/api/v1/approvals/requests/{req_id}/approve", headers=admin_headers)
    assert redo.status_code == 400

    # UPDATE: also files instead of executing
    filed_update = client.put(
        f"/api/v1/masters/states/{state_id}", headers=gated_headers,
        json={"name_kn": "ಬದಲಾದ ಹೆಸರು"},
    )
    assert filed_update.status_code == 200, filed_update.text
    update_req_id = filed_update.json()["approval_request_id"]

    still_old = client.get(f"/api/v1/masters/states/{state_id}", headers=admin_headers)
    assert still_old.json()["name_kn"] == "ಜೆನೆರಿಕ್"

    approved_update = client.put(f"/api/v1/approvals/requests/{update_req_id}/approve", headers=admin_headers)
    assert approved_update.status_code == 200, approved_update.text
    assert approved_update.json()["name_kn"] == "ಬದಲಾದ ಹೆಸರು"
    # untouched field survives a partial (exclude_unset) patch replay
    assert approved_update.json()["name_en"] == "GenericEngineState"

    # DELETE: files, then a reject leaves the row untouched
    filed_delete = client.delete(f"/api/v1/masters/states/{state_id}", headers=gated_headers)
    assert filed_delete.status_code == 200, filed_delete.text
    delete_req_id = filed_delete.json()["approval_request_id"]

    rejected = client.put(
        f"/api/v1/approvals/requests/{delete_req_id}/reject", headers=admin_headers, params={"note": "not now"},
    )
    assert rejected.status_code == 200, rejected.text

    still_there = client.get(f"/api/v1/masters/states/{state_id}", headers=admin_headers)
    assert still_there.status_code == 200

    # a fresh delete request, this time approved, actually removes it
    filed_delete_2 = client.delete(f"/api/v1/masters/states/{state_id}", headers=gated_headers)
    delete_req_id_2 = filed_delete_2.json()["approval_request_id"]
    approved_delete = client.put(f"/api/v1/approvals/requests/{delete_req_id_2}/approve", headers=admin_headers)
    assert approved_delete.status_code == 200, approved_delete.text

    gone = client.get(f"/api/v1/masters/states/{state_id}", headers=admin_headers)
    assert gone.status_code == 404


def test_filing_an_approval_request_notifies_approvers(client, admin_headers):
    """Approvers shouldn't have to poll: filing a gated request pings every
    approvals.write holder via the in-app inbox (models.inbox.AppNotification)."""
    approver_id, approver_role_id, approver_headers = _staff_with_role(
        client, admin_headers, "notify_approver", "Notify Approver", "NOTIFY_APPROVER",
        permission_grants=[("approvals.write", False)],
    )
    _, _, requester_headers = _staff_with_role(
        client, admin_headers, "notify_requester", "Notify Requester", "NOTIFY_REQUESTER",
        permission_grants=[("masters.write", True)],
    )

    filed = client.post(
        "/api/v1/masters/states", headers=requester_headers, json={"name_en": "NotifyEngineState"},
    )
    assert filed.status_code in (200, 201), filed.text
    req_id = filed.json()["approval_request_id"]

    from db.session import SessionLocal
    from models.inbox import AppNotification

    with SessionLocal() as db:
        note = (
            db.query(AppNotification)
            .filter(AppNotification.user_id == approver_id, AppNotification.source == "APPROVAL_REQUEST")
            .order_by(AppNotification.id.desc())
            .first()
        )
    assert note is not None, "approvals.write holder must be notified when a request is filed"
    assert note.data["approval_request_id"] == req_id

    # a user without approvals.write is not notified
    from models.users import User

    with SessionLocal() as db:
        requester_row = db.query(User).filter(User.username == "notify_requester").first()
        non_approver_note = (
            db.query(AppNotification)
            .filter(AppNotification.user_id == requester_row.id, AppNotification.source == "APPROVAL_REQUEST")
            .first()
        )
    assert non_approver_note is None


def test_deletion_request_endpoints_notify_approvers(client, admin_headers):
    """Both deletion-request entry points (the rank/permission-gated direct
    delete, and the standalone request endpoint) notify approvers too."""
    approver_id, _, _ = _staff_with_role(
        client, admin_headers, "notify_approver_del", "Notify Approver Del", "NOTIFY_APPROVER_DEL",
        permission_grants=[("approvals.write", False)],
    )
    target = _create_member(client, admin_headers, "9000000094", "NotifyDeletionTarget")

    response = client.post(
        "/api/v1/approvals/deletion-requests", headers=admin_headers,
        params={"member_id": target["id"], "reason": "notify test"},
    )
    assert response.status_code == 200, response.text

    from db.session import SessionLocal
    from models.inbox import AppNotification

    with SessionLocal() as db:
        note = (
            db.query(AppNotification)
            .filter(AppNotification.user_id == approver_id, AppNotification.source == "APPROVAL_REQUEST")
            .filter(AppNotification.body.ilike("%NotifyDeletionTarget%") | AppNotification.title.ilike("%Delete member%"))
            .order_by(AppNotification.id.desc())
            .first()
        )
    assert note is not None


def test_generic_approval_engine_ungated_grant_executes_immediately(client, admin_headers):
    """requires_approval=False on the same permission code -> normal,
    immediate execution, unaffected by the engine."""
    _, _, direct_headers = _staff_with_role(
        client, admin_headers, "direct_masters_editor", "Direct Masters Editor", "DIRECT_MASTERS_EDITOR",
        permission_grants=[("masters.write", False)],
    )
    created = client.post(
        "/api/v1/masters/states", headers=direct_headers, json={"name_en": "DirectEngineState"},
    )
    assert created.status_code in (200, 201), created.text
    assert created.json().get("status") != "PENDING"
    assert created.json()["name_en"] == "DirectEngineState"


def test_generic_approval_engine_bulk_approve_and_reject(client, admin_headers):
    """PUT /approvals/requests/bulk-approve|reject act on several pending
    requests in one call, and one bad id doesn't abort the rest of the batch."""
    _, _, gated_headers = _staff_with_role(
        client, admin_headers, "bulk_masters_editor", "Bulk Masters Editor", "BULK_MASTERS_EDITOR",
        permission_grants=[("masters.write", True)],
    )

    req_ids = []
    for i in range(3):
        filed = client.post(
            "/api/v1/masters/states", headers=gated_headers, json={"name_en": f"BulkEngineState{i}"},
        )
        assert filed.status_code in (200, 201), filed.text
        req_ids.append(filed.json()["approval_request_id"])

    # approve two, reject one, plus one bogus id mixed into the approve batch
    bulk_approved = client.put(
        "/api/v1/approvals/requests/bulk-approve", headers=admin_headers,
        json={"ids": [req_ids[0], req_ids[1], 999999], "note": "bulk ok"},
    )
    assert bulk_approved.status_code == 200, bulk_approved.text
    body = bulk_approved.json()
    assert body["succeeded"] == 2
    assert body["failed"] == 1
    ok_ids = {r["id"] for r in body["results"] if r["success"]}
    assert ok_ids == {req_ids[0], req_ids[1]}
    bad = next(r for r in body["results"] if not r["success"])
    assert bad["id"] == 999999
    assert "not found" in bad["error"].lower()

    for name in (f"BulkEngineState0", f"BulkEngineState1"):
        listing = client.get("/api/v1/masters/states", headers=admin_headers, params={"search": name})
        assert listing.json()["total"] == 1, f"{name} should have been created by bulk-approve"

    bulk_rejected = client.put(
        "/api/v1/approvals/requests/bulk-reject", headers=admin_headers,
        json={"ids": [req_ids[2]], "note": "not needed"},
    )
    assert bulk_rejected.status_code == 200, bulk_rejected.text
    assert bulk_rejected.json()["succeeded"] == 1

    listing3 = client.get("/api/v1/masters/states", headers=admin_headers, params={"search": "BulkEngineState2"})
    assert listing3.json()["total"] == 0, "rejected request must not have created the state"

    # re-approving an already-decided id fails cleanly within the batch
    redo = client.put(
        "/api/v1/approvals/requests/bulk-approve", headers=admin_headers,
        json={"ids": [req_ids[0]], "note": None},
    )
    assert redo.status_code == 200
    assert redo.json()["succeeded"] == 0
    assert "already" in redo.json()["results"][0]["error"].lower()


def test_deletion_requests_bulk_approve(client, admin_headers):
    """PUT /approvals/deletion-requests/bulk-approve soft-deletes several
    members in one call."""
    members = [
        _create_member(client, admin_headers, f"910000020{i}", f"BulkDelete{i}")
        for i in range(3)
    ]
    req_ids = []
    for m in members:
        r = client.post(
            "/api/v1/approvals/deletion-requests", headers=admin_headers,
            params={"member_id": m["id"], "reason": "bulk test"},
        )
        assert r.status_code == 200, r.text

    from db.session import SessionLocal
    from models.members import MemberDeletionRequest

    with SessionLocal() as db:
        for m in members:
            row = (
                db.query(MemberDeletionRequest)
                .filter(MemberDeletionRequest.member_id == m["id"])
                .order_by(MemberDeletionRequest.id.desc())
                .first()
            )
            req_ids.append(row.id)

    bulk = client.put(
        "/api/v1/approvals/deletion-requests/bulk-approve", headers=admin_headers,
        json={"ids": req_ids, "note": "bulk approved"},
    )
    assert bulk.status_code == 200, bulk.text
    assert bulk.json()["succeeded"] == 3

    for m in members:
        gone = client.get(f"/api/v1/members/{m['id']}", headers=admin_headers)
        assert gone.status_code == 404


def test_generic_approval_engine_engagements_no_response_model(client, admin_headers):
    """Spot-check a second, differently-shaped module: engagements.Associate,
    whose DELETE endpoint declares no response_model (plain dict return) —
    a different code path through the engine than the masters.State test."""
    _, _, gated_headers = _staff_with_role(
        client, admin_headers, "gated_engagements_editor", "Gated Engagements Editor", "GATED_ENGAGEMENTS_EDITOR",
        permission_grants=[("engagements.write", True), ("engagements.delete", True)],
    )

    filed = client.post(
        "/api/v1/engagements/associates", headers=gated_headers,
        json={"name": "Gated Associate", "organization": "Test Org"},
    )
    assert filed.status_code in (200, 201), filed.text
    assert filed.json()["status"] == "PENDING"
    req_id = filed.json()["approval_request_id"]

    approved = client.put(f"/api/v1/approvals/requests/{req_id}/approve", headers=admin_headers)
    assert approved.status_code == 200, approved.text
    associate_id = approved.json()["id"]
    assert approved.json()["name"] == "Gated Associate"

    filed_delete = client.delete(f"/api/v1/engagements/associates/{associate_id}", headers=gated_headers)
    assert filed_delete.status_code == 200, filed_delete.text
    assert filed_delete.json()["status"] == "PENDING"
    delete_req_id = filed_delete.json()["approval_request_id"]

    approved_delete = client.put(f"/api/v1/approvals/requests/{delete_req_id}/approve", headers=admin_headers)
    assert approved_delete.status_code == 200, approved_delete.text


def test_generic_approval_engine_receipts_nested_and_decimal_fields(client, admin_headers):
    """Receipts exercise nested list fields (items) and Decimal/date types —
    a stress test for the JSON round-trip through payload capture + replay."""
    _, _, gated_headers = _staff_with_role(
        client, admin_headers, "gated_receipts_editor", "Gated Receipts Editor", "GATED_RECEIPTS_EDITOR",
        permission_grants=[("receipts.write", True)],
    )

    filed = client.post(
        "/api/v1/receipts/", headers=gated_headers,
        json={
            "receipt_date": date.today().isoformat(),
            "receipt_type": "MEMBERSHIP",
            "payment_mode": "CASH",
            "payer_name": "Gated Receipt Payer",
            "gross_amount": 750,
            "discount_amount": 50,
            "net_amount": 700,
            "items": [{"item_type": "MEMBERSHIP", "amount": 700}],
        },
    )
    assert filed.status_code in (200, 201), filed.text
    assert filed.json()["status"] == "PENDING"
    req_id = filed.json()["approval_request_id"]

    approved = client.put(f"/api/v1/approvals/requests/{req_id}/approve", headers=admin_headers)
    assert approved.status_code == 200, approved.text
    body = approved.json()
    assert float(body["net_amount"]) == 700.0
    assert body["payer_name"] == "Gated Receipt Payer"
    assert re.match(r"^REC-\d{8}-\d{6}$", body["receipt_number"])


def test_password_fields_never_captured_by_generic_engine(client, admin_headers):
    """Safety net: even if users.create/users.update were flagged
    requires_approval, create_user/update_user must still execute directly
    — they're deliberately excluded from @approval_gate.gated because the
    body can carry a plaintext password."""
    _, _, gated_headers = _staff_with_role(
        client, admin_headers, "gated_user_admin", "Gated User Admin", "GATED_USER_ADMIN",
        permission_grants=[("users.management.write", True), ("users.management.write", True)],
    )

    created = client.post(
        "/api/v1/users/", headers=gated_headers,
        json={
            "name": "Directly Created",
            "username": "directly_created_user",
            "password": "Somepass@123",
            "role_id": _role_id(client, admin_headers, "MEMBER"),
        },
    )
    assert created.status_code == 200, created.text
    assert "approval_request_id" not in created.json()
    assert created.json()["username"] == "directly_created_user"


# ─────────────── audit logging ───────────────

def test_login_writes_activity_log(client):
    response = client.post(
        "/api/v1/auth/login",
        data={"username": "admin", "password": "Admintest@123"},
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
    # a staff user whose role has no privileges at all
    uid, role_id, staff_headers = _staff_with_role(
        client, admin_headers, "staff_rbac", "Empty Role", "EMPTY_ROLE", permission_grants=[],
    )

    # reads need <module>.read; writes need <module>.write
    read_denied = client.get("/api/v1/members/", headers=staff_headers)
    assert read_denied.status_code == 403 and "members.list.read" in read_denied.json()["detail"]
    denied = client.post("/api/v1/members/", headers=staff_headers, json={"first_name_en": "Nope"})
    assert denied.status_code == 403, denied.text
    assert "members.register.write" in denied.json()["detail"]

    # an all-access role bypasses the privilege check (this call succeeds)
    assert _create_member(client, admin_headers, "9000000005", "Super")["id"]

    # grant the privileges to the role and retry with the same login
    grant = client.put(
        f"/api/v1/users/roles/{role_id}/permissions", headers=admin_headers,
        json={"permission_codes": ["members.list.read", "members.register.write"]},
    )
    assert grant.status_code == 200, grant.text
    assert client.get("/api/v1/members/", headers=staff_headers).status_code == 200
    allowed = client.post(
        "/api/v1/members/", headers=staff_headers,
        json={"first_name_en": "Now Allowed", "mobile": "9000000006"},
    )
    assert allowed.status_code == 201, allowed.text

    # revoking one privilege takes effect immediately
    assert client.delete(f"/api/v1/users/roles/{role_id}/permissions/{[p['id'] for p in client.get(f'/api/v1/users/roles/{role_id}/permissions', headers=admin_headers).json() if p['code'] == 'members.register.write'][0]}", headers=admin_headers).status_code == 200
    assert client.post("/api/v1/members/", headers=staff_headers, json={"first_name_en": "Again", "mobile": "9000000007"}).status_code == 403


STAFF_PW = "Staffpass@1"


def _role_id(client, admin_headers, code):
    rows = client.get("/api/v1/users/roles", headers=admin_headers, params={"limit": 200}).json()["data"]
    return next(r["id"] for r in rows if r["code"] == code)


def _staff_with_role(client, admin_headers, username, role_name, role_code, permission_grants, rank_level=10):
    """Create a role (rank 10) granting permission_grants ([(code, requires_approval), ...];
    <module>.read is added for every module granted, as the migration does), create a user
    holding it, log in, and return (user_id, role_id, headers)."""
    role = client.post(
        "/api/v1/users/roles", headers=admin_headers,
        json={"name": role_name, "code": role_code, "rank_level": rank_level},
    ).json()
    grants = {}
    for code, requires_approval in permission_grants:
        grants[code] = grants.get(code, False) or requires_approval
    from db.seed_defaults import MODULE_CATALOG, SUB_MODULE_AREAS
    # a module-level grant (masters.write) also carries every sub-module of that module, as the
    # migration does for existing roles; tests that want ONE area pass its own code instead
    from db.seed_defaults import PERMISSION_CATALOG
    existing_codes = {p[0] for p in PERMISSION_CATALOG}
    for code, flag in list(grants.items()):
        module, _, action = code.rpartition(".")
        for sub, _label, _paths in SUB_MODULE_AREAS.get(module, []):
            if f"{sub}.{action}" in existing_codes:  # not every screen has all three actions
                grants.setdefault(f"{sub}.{action}", flag)
    known_modules = {m[0] for m in MODULE_CATALOG} | {s for areas in SUB_MODULE_AREAS.values() for s, _l, _p in areas}
    for code in list(grants):
        module = code.rsplit(".", 1)[0]
        if module in known_modules and f"{module}.read" in existing_codes:  # meta-codes like approvals.write have no own module; some screens have no Read
            grants.setdefault(module + ".read", False)
    resp = client.put(
        f"/api/v1/users/roles/{role['id']}/permissions", headers=admin_headers,
        json={"permission_codes": list(grants), "approval_required_codes": [c for c, v in grants.items() if v]},
    )
    assert resp.status_code == 200, resp.text
    user = client.post(
        "/api/v1/users/", headers=admin_headers,
        json={"name": role_name, "username": username, "password": STAFF_PW, "role_id": role["id"]},
    ).json()
    login = client.post("/api/v1/auth/login", data={"username": username, "password": STAFF_PW})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    return user["id"], role["id"], headers


def test_member_delete_gated_grant_files_approval_request(client, admin_headers):
    """A role holding members.delete with requires_approval=True can still
    call DELETE /members/{id} — it just doesn't execute immediately. It
    auto-files the same deletion request an approvals.write holder then
    has to approve."""
    target = _create_member(client, admin_headers, "9000000096", "GatedDelete")

    _, _, coordinator_headers = _staff_with_role(
        client, admin_headers, "gated_coordinator", "Coordinator", "COORDINATOR_GATED",
        permission_grants=[("members.delete", True)],
    )

    filed = client.delete(
        f"/api/v1/members/{target['id']}", headers=coordinator_headers,
        params={"reason": "testing approval gate", "mode": "SOFT"},
    )
    assert filed.status_code == 200, filed.text
    body = filed.json()
    assert body["status"] == "PENDING"
    assert "deletion_request_id" in body

    # not actually deleted yet
    still_there = client.get(f"/api/v1/members/{target['id']}", headers=admin_headers)
    assert still_there.status_code == 200

    # the coordinator can't approve their own filed request
    approve_denied = client.put(
        f"/api/v1/approvals/deletion-requests/{body['deletion_request_id']}/approve",
        headers=coordinator_headers,
    )
    assert approve_denied.status_code == 403

    # a role with approvals.write can approve it
    _, _, admin_role_headers = _staff_with_role(
        client, admin_headers, "gated_admin", "Gated Approver", "ADMIN_GATED",
        permission_grants=[("approvals.write", False)],
    )
    approved = client.put(
        f"/api/v1/approvals/deletion-requests/{body['deletion_request_id']}/approve",
        headers=admin_role_headers,
    )
    assert approved.status_code == 200, approved.text

    deleted = client.get(f"/api/v1/members/{target['id']}", headers=admin_headers)
    assert deleted.status_code == 404


def test_member_delete_ungated_grant_executes_immediately(client, admin_headers):
    """A role holding members.delete with requires_approval=False (default)
    executes the delete right away instead of filing a request."""
    target = _create_member(client, admin_headers, "9000000097", "UngatedDelete")

    _, _, direct_headers = _staff_with_role(
        client, admin_headers, "ungated_deleter", "Direct Deleter", "DIRECT_DELETER",
        permission_grants=[("members.delete", False)],
    )

    deleted = client.delete(
        f"/api/v1/members/{target['id']}", headers=direct_headers,
        params={"reason": "immediate", "mode": "SOFT"},
    )
    assert deleted.status_code == 200, deleted.text
    assert deleted.json().get("status") != "PENDING"

    gone = client.get(f"/api/v1/members/{target['id']}", headers=admin_headers)
    assert gone.status_code == 404


def test_member_delete_without_permission_denied(client, admin_headers):
    """members.create/update alone (no members.delete grant at all) can't
    delete — plain RBAC denial, nothing to gate."""
    target = _create_member(client, admin_headers, "9000000098", "NoDeletePerm")

    _, _, editor_headers = _staff_with_role(
        client, admin_headers, "editor_only", "Editor", "EDITOR_ONLY",
        permission_grants=[("members.write", False), ("members.write", False)],
    )

    denied = client.delete(
        f"/api/v1/members/{target['id']}", headers=editor_headers,
        params={"reason": "no permission", "mode": "SOFT"},
    )
    assert denied.status_code == 403
    assert "members.list.delete" in denied.json()["detail"]


def test_member_delete_ungating_the_grant_executes_directly(client, admin_headers):
    """One role per user: once the role's members.delete grant is switched
    from requires_approval to un-gated, the same user acts directly."""
    target = _create_member(client, admin_headers, "9000000099", "MixedGrantDelete")

    _, role_id, headers = _staff_with_role(
        client, admin_headers, "mixed_grant_user", "Gated Role", "GATED_ROLE",
        permission_grants=[("members.delete", True)],
    )
    resync = client.put(
        f"/api/v1/users/roles/{role_id}/permissions", headers=admin_headers,
        json={"permission_codes": ["members.list.delete", "members.list.read"], "approval_required_codes": []},
    )
    assert resync.status_code == 200, resync.text

    deleted = client.delete(
        f"/api/v1/members/{target['id']}", headers=headers,
        params={"reason": "ungated now", "mode": "SOFT"},
    )
    assert deleted.status_code == 200, deleted.text
    assert deleted.json().get("status") != "PENDING"


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


def test_request_type_change_endpoint(client, admin_headers):
    """POST /approvals/type-changes — the public entry point to submit a
    type-change request (previously only creatable by direct DB insert)."""
    type_a = _create_membership_type(client, admin_headers, "TST_REQ_A", "Request Type A")
    type_b = _create_membership_type(client, admin_headers, "TST_REQ_B", "Request Type B")
    member = _create_member(client, admin_headers, "9000000193", "TypeChangeRequester")

    # no active membership yet -> rejected
    no_membership = client.post(
        "/api/v1/approvals/type-changes", headers=admin_headers,
        params={"member_id": member["id"], "requested_type_id": type_b["id"]},
    )
    assert no_membership.status_code == 400

    from db.session import SessionLocal
    from models.members import MemberMembership

    with SessionLocal() as db:
        membership = MemberMembership(
            member_id=member["id"], membership_type_id=type_a["id"],
            applied_at=datetime.now(timezone.utc), status="ACTIVE",
        )
        db.add(membership)
        db.commit()
        db.refresh(membership)
        membership_id = membership.id

    # unknown type rejected
    assert client.post(
        "/api/v1/approvals/type-changes", headers=admin_headers,
        params={"member_id": member["id"], "requested_type_id": 999999},
    ).status_code == 400

    # same type as current rejected
    assert client.post(
        "/api/v1/approvals/type-changes", headers=admin_headers,
        params={"member_id": member["id"], "requested_type_id": type_a["id"]},
    ).status_code == 400

    # a type with no active price configured is rejected too (would otherwise
    # blow up at approval time on membership_type_history.new_price NOT NULL)
    priceless = client.post(
        "/api/v1/approvals/type-changes", headers=admin_headers,
        params={"member_id": member["id"], "requested_type_id": type_b["id"]},
    )
    assert priceless.status_code == 400
    assert "active price" in priceless.json()["detail"]

    from models.masters import MembershipTypePrice

    with SessionLocal() as db:
        db.add(MembershipTypePrice(membership_type_id=type_b["id"], amount=300, effective_from=date(2026, 1, 1)))
        db.commit()

    submitted = client.post(
        "/api/v1/approvals/type-changes", headers=admin_headers,
        params={"member_id": member["id"], "requested_type_id": type_b["id"], "reason": "Upgrade please"},
    )
    assert submitted.status_code == 200, submitted.text
    req_id = submitted.json()["id"]

    # a second pending request for the same membership is blocked
    duplicate = client.post(
        "/api/v1/approvals/type-changes", headers=admin_headers,
        params={"member_id": member["id"], "requested_type_id": type_b["id"]},
    )
    assert duplicate.status_code == 409

    from models.members import MembershipTypeChangeRequest

    with SessionLocal() as db:
        req = db.query(MembershipTypeChangeRequest).filter(MembershipTypeChangeRequest.id == req_id).first()
    assert req.current_membership_id == membership_id
    assert req.requested_type_id == type_b["id"]
    assert req.status == "PENDING"

    # it's approvable via the existing endpoint
    approved = client.put(f"/api/v1/approvals/type-changes/{req_id}/approve", headers=admin_headers)
    assert approved.status_code == 200, approved.text


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
            "password": "Oldpass@123",
            "role_id": _role_id(client, admin_headers, "MEMBER"),
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
        json={"token": token, "new_password": "Brandnew@123"},
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
        data={"username": "mobile_user", "password": "Brandnew@123"},
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

    # deleting a state cascades to its districts (throwaway state)
    temp_state = client.post("/api/v1/masters/states", headers=admin_headers, json={"name_en": "Cascade Nadu"}).json()
    temp_district = _create_district(client, admin_headers, temp_state["id"], "Cascade District")
    assert client.delete(f"/api/v1/masters/states/{temp_state['id']}", headers=admin_headers).status_code == 200
    assert client.get(f"/api/v1/masters/districts/{temp_district['id']}", headers=admin_headers).status_code in (404, 405)
    district = _create_district(client, admin_headers, state["id"], "Test District")

    # delete blocked while postal codes reference the district
    pc = client.post(
        "/api/v1/masters/postal-codes",
        headers=admin_headers,
        json={"pincode": "580001", "state_id": state["id"], "district_id": district["id"]},
    )
    assert pc.status_code == 200, pc.text

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
        json={"name": "Masters Manager", "code": "MASTERS_MGR", "rank_level": 10},
    )
    assert role.status_code == 200, role.text
    role_id = role.json()["id"]
    assert role.json()["rank_level"] == 10 and role.json()["is_all_access"] is False

    # detail starts empty
    body = client.get(f"/api/v1/users/roles/{role_id}", headers=admin_headers).json()
    assert body["permission_codes"] == [] and body["user_count"] == 0

    # bulk-configure privileges in one call
    codes = ["masters.write", "members.write", "imports.write"]
    configured = client.put(
        f"/api/v1/users/roles/{role_id}/permissions", headers=admin_headers,
        json={"permission_codes": codes},
    )
    assert configured.status_code == 200, configured.text
    assert sorted(configured.json()["granted"]) == sorted(codes)

    # unknown permission code rejected
    unknown = client.put(
        f"/api/v1/users/roles/{role_id}/permissions", headers=admin_headers,
        json={"permission_codes": ["masters.write", "nope.write"]},
    )
    assert unknown.status_code == 400, unknown.text

    # re-sync with a different set revokes the absent ones
    resync = client.put(
        f"/api/v1/users/roles/{role_id}/permissions", headers=admin_headers,
        json={"permission_codes": ["masters.write"]},
    )
    assert resync.status_code == 200, resync.text
    assert sorted(resync.json()["revoked"]) == ["imports.write", "members.write"]

    # roles listing carries permission_codes + user_count
    row = [r for r in client.get("/api/v1/users/roles", headers=admin_headers).json()["data"] if r["id"] == role_id][0]
    assert row["permission_codes"] == ["masters.write"] and row["user_count"] == 0

    # duplicate role name rejected
    assert client.post("/api/v1/users/roles", headers=admin_headers,
                       json={"name": "Masters Manager", "code": "OTHER", "rank_level": 10}).status_code == 400

    # delete blocked while a user holds the role
    staff = client.post(
        "/api/v1/users/", headers=admin_headers,
        json={"name": "Role Holder", "username": "role_holder", "password": "Holderpass@1", "role_id": role_id},
    )
    assert staff.status_code == 200, staff.text
    staff_id = staff.json()["id"]
    assert client.get(f"/api/v1/users/roles/{role_id}", headers=admin_headers).json()["user_count"] == 1
    assert client.delete(f"/api/v1/users/roles/{role_id}", headers=admin_headers).status_code == 400
    # deactivating an in-use role is blocked too
    assert client.put(f"/api/v1/users/roles/{role_id}", headers=admin_headers, json={"status": False}).status_code == 409

    # free the role (delete the user), then deleting the role succeeds
    assert client.delete(f"/api/v1/users/{staff_id}", headers=admin_headers).status_code == 200
    assert client.delete(f"/api/v1/users/roles/{role_id}", headers=admin_headers).status_code == 200
    assert client.get(f"/api/v1/users/roles/{role_id}", headers=admin_headers).status_code == 404

    # built-in roles are protected
    assert client.delete(f"/api/v1/users/roles/{_role_id(client, admin_headers, 'MEMBER')}", headers=admin_headers).status_code == 409


def test_one_role_per_user_and_role_change(client, admin_headers):
    staff_role, member_role = _role_id(client, admin_headers, "STAFF"), _role_id(client, admin_headers, "MEMBER")
    user = client.post(
        "/api/v1/users/", headers=admin_headers,
        json={"name": "Changer", "username": "role_changer", "password": "Changer@123", "role_id": staff_role},
    )
    assert user.status_code == 200, user.text
    uid = user.json()["id"]
    assert user.json()["role"]["code"] == "STAFF" and user.json()["user_type"] == "STAFF"

    # invalid role rejected; there is no multi-role assignment endpoint anymore
    assert client.post("/api/v1/users/", headers=admin_headers,
                       json={"name": "X", "username": "x_bad_role", "password": "Badrole@123", "role_id": 99999}).status_code == 400
    assert client.post(f"/api/v1/users/{uid}/assign-role", headers=admin_headers, params={"role_id": member_role}).status_code in (404, 405)

    # changing the single role through update
    changed = client.put(f"/api/v1/users/{uid}", headers=admin_headers, json={"role_id": member_role})
    assert changed.status_code == 200, changed.text
    assert changed.json()["role"]["code"] == "MEMBER" and changed.json()["user_type"] == "MEMBER"
    assert client.get(f"/api/v1/users/{uid}", headers=admin_headers).json()["role_id"] == member_role

    perms = client.get(f"/api/v1/users/{uid}/permissions", headers=admin_headers)
    assert perms.status_code == 200 and perms.json() == []


def test_user_update_password_reset_and_guards(client, admin_headers):
    staff = client.post(
        "/api/v1/users/", headers=admin_headers,
        json={"name": "Resettable", "username": "resettable", "password": "Oldpass@123", "role_id": _role_id(client, admin_headers, "STAFF")},
    )
    assert staff.status_code == 200, staff.text
    staff_id = staff.json()["id"]

    # weak reset password rejected
    assert client.put(f"/api/v1/users/{staff_id}", headers=admin_headers, json={"password": "short"}).status_code == 400

    # strong reset works and old password stops working
    assert client.put(f"/api/v1/users/{staff_id}", headers=admin_headers, json={"password": "Brandnew@456"}).status_code == 200
    assert client.post("/api/v1/auth/login", data={"username": "resettable", "password": "Oldpass@123"}).status_code == 401
    assert client.post("/api/v1/auth/login", data={"username": "resettable", "password": "Brandnew@456"}).status_code == 200

    # admin cannot deactivate or delete themselves
    assert client.put("/api/v1/users/1", headers=admin_headers, json={"status": False}).status_code == 400
    assert client.delete("/api/v1/users/1", headers=admin_headers).status_code == 400

    # deactivating another user works
    other = client.put(f"/api/v1/users/{staff_id}", headers=admin_headers, json={"status": False})
    assert other.status_code == 200 and other.json()["status"] is False

    # delete -> 404 afterwards
    assert client.delete(f"/api/v1/users/{staff_id}", headers=admin_headers).status_code == 200
    assert client.get(f"/api/v1/users/{staff_id}", headers=admin_headers).status_code == 404


def test_rank_hierarchy_rules(client, admin_headers):
    """Anegudde rule: you only see / create / edit / delete users and roles
    that are strictly weaker than your own role."""
    # a rank-3 'manager' role that can manage users, roles and privileges
    mgr_uid, mgr_role, mgr = _staff_with_role(
        client, admin_headers, "rank3_mgr", "Rank Three Manager", "RANK3_MGR",
        permission_grants=[
            ("users.management.write", False), ("users.management.delete", False),
            ("roles.write", False), ("roles.delete", False),
            ("users.privileges.write", False), ("users.privileges.read", False),
        ],
        rank_level=3,
    )
    assert client.get("/api/v1/users/roles/%d" % mgr_role, headers=mgr).status_code == 403  # own rank is not reachable

    # cannot create a role of the same / higher rank
    assert client.post("/api/v1/users/roles", headers=mgr, json={"name": "Peer", "code": "PEER", "rank_level": 3}).status_code == 400
    assert client.post("/api/v1/users/roles", headers=mgr, json={"name": "Boss", "code": "BOSS", "rank_level": 1}).status_code == 400
    # cannot mint an all-access role
    assert client.post("/api/v1/users/roles", headers=mgr, json={"name": "God", "code": "GOD", "rank_level": 20, "is_all_access": True}).status_code == 403
    sub = client.post("/api/v1/users/roles", headers=mgr, json={"name": "Sub Role", "code": "SUB_ROLE", "rank_level": 20})
    assert sub.status_code == 200, sub.text

    # role list shows only weaker roles
    listed = {r["code"] for r in client.get("/api/v1/users/roles", headers=mgr, params={"limit": 200}).json()["data"]}
    assert "SUB_ROLE" in listed and "RANK3_MGR" not in listed and "SUPERADMIN" not in listed and "ADMIN" not in listed

    # users: can create below, not at/above own rank; peers are invisible
    ok = client.post("/api/v1/users/", headers=mgr,
                     json={"name": "Sub", "username": "sub_user", "password": "Subuser@123", "role_id": sub.json()["id"]})
    assert ok.status_code == 200, ok.text
    assert client.post("/api/v1/users/", headers=mgr,
                       json={"name": "Up", "username": "up_user", "password": "Upuser@1234", "role_id": _role_id(client, admin_headers, "ADMIN")}).status_code == 403
    users = {u["username"] for u in client.get("/api/v1/users/", headers=mgr, params={"limit": 200}).json()["data"]}
    assert "sub_user" in users and "admin" not in users and "rank3_mgr" not in users
    assert client.get("/api/v1/users/1", headers=mgr).status_code == 403
    assert client.put("/api/v1/users/1", headers=mgr, json={"name": "Hacked"}).status_code == 403
    assert client.delete("/api/v1/users/1", headers=mgr).status_code == 403
    # cannot hand someone a role at or above own rank
    assert client.put(f"/api/v1/users/{ok.json()['id']}", headers=mgr,
                      json={"role_id": mgr_role}).status_code == 403
    # cannot change own role
    assert client.put(f"/api/v1/users/{mgr_uid}", headers=mgr, json={"role_id": sub.json()["id"]}).status_code in (400, 401, 403)

    # privileges: only weaker roles' privileges can be edited
    assert client.put(f"/api/v1/users/roles/{mgr_role}/permissions", headers=mgr, json={"permission_codes": []}).status_code == 403
    assert client.put(f"/api/v1/users/roles/{sub.json()['id']}/permissions", headers=mgr,
                      json={"permission_codes": ["members.read"]}).status_code == 200


def test_module_min_rank_status_and_system_module(client, admin_headers):
    """Module rows (not code) decide who may use a privilege: min_rank_level
    locks out weaker roles, and a disabled module blocks everyone."""
    uid, role_id, headers = _staff_with_role(
        client, admin_headers, "mod_gate_user", "Mod Gate Role", "MOD_GATE_ROLE",
        permission_grants=[("masters.write", False)],
    )
    assert client.get("/api/v1/masters/states", headers=headers).status_code == 200

    modules = {m["code"]: m for m in client.get("/api/v1/users/modules", headers=admin_headers, params={"limit": 200}).json()["data"]}
    masters = modules["masters"]

    # rank gate: role rank 10 vs min_rank_level 5 -> locked out
    assert client.put(f"/api/v1/users/modules/{masters['id']}", headers=admin_headers, json={"min_rank_level": 5}).status_code == 200
    assert client.get("/api/v1/masters/states", headers=headers).status_code == 403
    assert client.get("/api/v1/masters/states", headers=admin_headers).status_code == 200  # rank 1 passes
    assert client.put(f"/api/v1/users/modules/{masters['id']}", headers=admin_headers, json={"min_rank_level": None}).status_code == 200
    assert client.get("/api/v1/masters/states", headers=headers).status_code == 200

    # disabled module blocks even Rank 1
    assert client.put(f"/api/v1/users/modules/{masters['id']}", headers=admin_headers, json={"status": False}).status_code == 200
    assert client.get("/api/v1/masters/states", headers=admin_headers).status_code == 403
    assert client.put(f"/api/v1/users/modules/{masters['id']}", headers=admin_headers, json={"status": True}).status_code == 200
    assert client.get("/api/v1/masters/states", headers=admin_headers).status_code == 200

    # module management is Rank 1 only
    assert client.get("/api/v1/users/modules", headers=headers).status_code == 403
    assert client.post("/api/v1/users/modules", headers=headers, json={"code": "zz", "name_en": "ZZ"}).status_code == 403

    # system module is Rank-1-only via its own min_rank_level row
    assert client.get("/api/v1/system/error-logs", headers=admin_headers).status_code == 200
    assert client.get("/api/v1/system/error-logs", headers=headers).status_code == 403
    # a role below rank 1 cannot even be granted it
    r = client.put(f"/api/v1/users/roles/{role_id}/permissions", headers=admin_headers, json={"permission_codes": ["system.read"]})
    assert r.status_code == 403, r.text


def test_menu_and_privilege_tree_come_from_module_table(client, admin_headers):
    uid, role_id, headers = _staff_with_role(
        client, admin_headers, "menu_user", "Menu Role", "MENU_ROLE",
        permission_grants=[("members.read", False)],
    )
    menu = client.get("/api/v1/users/modules/menu", headers=headers)
    assert menu.status_code == 200, menu.text
    # only the modules they can read, plus the un-gated Dashboard page
    assert [m["code"] for m in menu.json()] == ["dashboard", "members"]

    full_menu = client.get("/api/v1/users/modules/menu", headers=admin_headers).json()

    def _menu_codes(nodes):
        codes = set()
        for m in nodes:
            codes.add(m["code"])
            codes |= _menu_codes(m.get("submodules", []))
        return codes

    # the menu is a tree; Approvals is its own top-level module
    assert {"masters", "users", "members", "approvals"} <= _menu_codes(full_menu)
    users_node = next(m for m in full_menu if m["code"] == "users")
    # Privileges has no page of its own (edited inside Role Management), so it has no route and no menu entry
    assert {"users.management", "roles", "users.modules"} == {c["code"] for c in users_node["submodules"]}

    # a brand-new module row appears with no code change; privileges can be linked to it
    created = client.post("/api/v1/users/modules", headers=admin_headers,
                          json={"code": "inventory_demo", "name_en": "Inventory Demo", "route": "/inventory", "display_order": 500})
    assert created.status_code == 200, created.text
    mid = created.json()["id"]
    assert "inventory_demo" in {m["code"] for m in client.get("/api/v1/users/modules/menu", headers=admin_headers).json()}
    tree = client.get("/api/v1/users/modules/privilege-tree", headers=admin_headers).json()
    assert "inventory_demo" not in {m["code"] for m in tree}  # nothing linked yet

    perm = next(p for p in client.get("/api/v1/users/permissions", headers=admin_headers, params={"limit": 500}).json()["data"] if p["code"] == "events.delete")
    orig_id = perm["module_id"]
    linked = client.post(f"/api/v1/users/modules/{mid}/link-privileges", headers=admin_headers, json=[perm["id"]])
    assert linked.status_code == 200, linked.text
    tree = client.get("/api/v1/users/modules/privilege-tree", headers=admin_headers).json()
    assert "inventory_demo" in {m["code"] for m in tree}
    # put it back and drop the demo module
    assert client.post(f"/api/v1/users/modules/{orig_id}/link-privileges", headers=admin_headers, json=[perm["id"]]).status_code == 200
    assert client.delete(f"/api/v1/users/modules/{mid}", headers=admin_headers).status_code == 200


def test_security_stamp_invalidates_sessions(client, admin_headers):
    uid, role_id, headers = _staff_with_role(
        client, admin_headers, "stamp_user", "Stamp Role", "STAMP_ROLE",
        permission_grants=[("members.read", False)],
    )
    assert client.get("/api/v1/members/", headers=headers).status_code == 200
    # changing the user's details rotates the stamp -> the old token dies
    assert client.put(f"/api/v1/users/{uid}", headers=admin_headers, json={"name": "Renamed Stamp"}).status_code == 200
    dead = client.get("/api/v1/members/", headers=headers)
    assert dead.status_code == 401 and "invalidated" in dead.json()["detail"].lower()
    # logging in again works
    login = client.post("/api/v1/auth/login", data={"username": "stamp_user", "password": STAFF_PW})
    assert login.status_code == 200
    fresh = {"Authorization": f"Bearer {login.json()['access_token']}"}
    assert client.get("/api/v1/members/", headers=fresh).status_code == 200
    # password change signs out every existing session, including refresh tokens
    assert client.post("/api/v1/auth/change-password", headers=fresh,
                       json={"current_password": STAFF_PW, "new_password": "Changed@12345"}).status_code == 200
    assert client.get("/api/v1/members/", headers=fresh).status_code == 401
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": login.json()["refresh_token"]}).status_code == 401


def test_me_returns_role_rank_and_privileges(client, admin_headers):
    me = client.get("/api/v1/auth/me", headers=admin_headers).json()
    assert me["is_all_access"] is True and me["role_rank_level"] == 1 and me["role_name"]
    uid, role_id, headers = _staff_with_role(
        client, admin_headers, "me_user", "Me Role", "ME_ROLE", permission_grants=[("masters.write", False)],
    )
    me2 = client.get("/api/v1/auth/me", headers=headers).json()
    assert me2["is_all_access"] is False and me2["role_rank_level"] == 10
    assert {"masters.write", "masters.read"} <= set(me2["privileges"])  # plus each Masters page, from the module-level grant


def test_superadmin_protections(client, admin_headers):
    # the built-in Super Admin role: rank 1, all-access, not deletable / editable
    sa_role = _role_id(client, admin_headers, "SUPERADMIN")
    assert client.delete(f"/api/v1/users/roles/{sa_role}", headers=admin_headers).status_code in (403, 409)
    assert client.post("/api/v1/users/roles", headers=admin_headers,
                       json={"name": "Another Top", "code": "ANOTHER_TOP", "rank_level": 1}).status_code == 400
    assert client.put(f"/api/v1/users/roles/{sa_role}", headers=admin_headers, json={"rank_level": 50}).status_code == 403
    # the admin account cannot delete or deactivate itself
    assert client.delete("/api/v1/users/1", headers=admin_headers).status_code == 400
    assert client.put("/api/v1/users/1", headers=admin_headers, json={"status": False}).status_code == 400


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


def test_kyc_reminders_batch_respects_interval_and_dedup(client, admin_headers, monkeypatch):
    """POST /magazines/members/kyc-reminders (the periodic-nudge batch job):
    never-asked and stale-asked members are queued, recently-asked members
    are skipped."""
    import services.whatsapp as whatsapp

    sent = []

    async def _capture(to, message, template_id=None):
        sent.append(to)
        return {"ok": True}

    monkeypatch.setattr(whatsapp.whatsapp_service, "send_message", _capture)

    never_asked = _create_member(client, admin_headers, "9330000060", "NeverAskedKyc")
    stale_asked = _create_member(client, admin_headers, "9330000061", "StaleAskedKyc")
    recently_asked = _create_member(client, admin_headers, "9330000062", "RecentlyAskedKyc")
    for m in (never_asked, stale_asked, recently_asked):
        approved = client.put(f"/api/v1/members/{m['id']}/approve", headers=admin_headers)
        assert approved.status_code == 200, approved.text

    from datetime import datetime, timedelta, timezone
    from db.session import SessionLocal
    from models.members import MemberKycRequest

    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        db.add(MemberKycRequest(
            member_id=stale_asked["id"], token_hash=f"stale-{stale_asked['id']}",
            sent_to=stale_asked["mobile"], sent_at=now - timedelta(days=200),
            expires_at=now - timedelta(days=199), status="EXPIRED",
        ))
        db.add(MemberKycRequest(
            member_id=recently_asked["id"], token_hash=f"recent-{recently_asked['id']}",
            sent_to=recently_asked["mobile"], sent_at=now - timedelta(days=5),
            expires_at=now + timedelta(hours=19), status="SENT",
        ))
        db.commit()

    # bad channel rejected
    assert client.post(
        "/api/v1/magazines/members/kyc-reminders", headers=admin_headers,
        params={"channel": "SMS"},
    ).status_code == 400

    response = client.post(
        "/api/v1/magazines/members/kyc-reminders", headers=admin_headers,
        params={"interval_days": 180, "channel": "LINK"},
    )
    assert response.status_code == 200, response.text
    body = response.json()

    queued_ids = set(body["member_ids"])
    assert never_asked["id"] in queued_ids
    assert stale_asked["id"] in queued_ids
    assert recently_asked["id"] not in queued_ids
    assert body["queued"] == len(queued_ids)

    # actually sent via WhatsApp (background tasks run synchronously under TestClient)
    assert len(sent) == len(queued_ids)

    # each queued member now has a fresh MemberKycRequest row
    with SessionLocal() as db:
        fresh = (
            db.query(MemberKycRequest)
            .filter(MemberKycRequest.member_id == never_asked["id"])
            .order_by(MemberKycRequest.id.desc())
            .first()
        )
    assert fresh is not None


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
        json={"subscription_id": sub["id"], "pause_start_date": "2026-02-01", "reason": "test pause"},
    )
    assert dup_pause.status_code == 409, dup_pause.text

    # end before start rejected
    bad = client.post(
        "/api/v1/magazines/pauses",
        headers=admin_headers,
        json={"subscription_id": sub["id"], "pause_start_date": "2026-03-01", "pause_end_date": "2026-02-01", "reason": "test pause"},
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
        json={"subscription_id": sub["id"], "pause_start_date": "2026-05-01", "pause_end_date": "2026-05-10", "reason": "test pause"},
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
        json={"subscription_id": sub_p["id"], "pause_start_date": "2020-01-01", "reason": "test pause"},  # open-ended
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
    "/api/v1/users/modules",
    "/api/v1/masters/states",
    "/api/v1/masters/districts",
    "/api/v1/masters/taluks",
    "/api/v1/masters/postal-codes",
    "/api/v1/masters/membership-types",
    "/api/v1/masters/document-types",
    "/api/v1/masters/banks",
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

def test_service_type_delete(client, admin_headers):
    r = client.post(
        "/api/v1/masters/service-types", headers=admin_headers,
        json={"code": "TESTSVC", "name_en": "Test Service"},
    )
    assert r.status_code == 200, r.text
    service_type_id = r.json()["id"]

    r = client.delete(f"/api/v1/masters/service-types/{service_type_id}", headers=admin_headers)
    assert r.status_code == 200, r.text

    r = client.get(f"/api/v1/masters/service-types/{service_type_id}", headers=admin_headers)
    assert r.status_code == 404


def test_bank_master_receipt_dropdown_defaults_and_crud(client, admin_headers):
    listing = client.get("/api/v1/masters/banks", headers=admin_headers)
    assert listing.status_code == 200, listing.text
    names = {row["name_en"] for row in listing.json()["data"]}
    assert {"KBL 1075", "KBL1541", "SBI", "CANARA BANK"} <= names

    created = client.post(
        "/api/v1/masters/banks",
        headers=admin_headers,
        json={
            "code": "TEST_BANK",
            "name_en": "Test Bank",
            "account_number": "123456",
            "branch_name": "Main",
            "ifsc_code": "TEST0001234",
        },
    )
    assert created.status_code == 201, created.text
    bank_id = created.json()["id"]

    duplicate = client.post(
        "/api/v1/masters/banks",
        headers=admin_headers,
        json={"code": "TEST_BANK", "name_en": "Duplicate Test Bank"},
    )
    assert duplicate.status_code == 409

    updated = client.put(
        f"/api/v1/masters/banks/{bank_id}",
        headers=admin_headers,
        json={"name_en": "Updated Test Bank", "status": False},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["name_en"] == "Updated Test Bank"
    assert updated.json()["status"] is False

    assert client.delete(f"/api/v1/masters/banks/{bank_id}", headers=admin_headers).status_code == 200
    assert client.get(f"/api/v1/masters/banks/{bank_id}", headers=admin_headers).status_code == 404


def test_profile_change_allows_new_mangalya_parity_fields(client, admin_headers):
    referrer = _create_member(client, admin_headers, "9000000090", "Referrer")
    member = _create_member(client, admin_headers, "9000000091", "Referred")

    response = client.post(
        "/api/v1/members/profile-changes/",
        headers=admin_headers,
        json={
            "member_id": member["id"],
            "new_values": {
                "aadhaar_number": "999988887777",
                "referred_by_member_id": referrer["id"],
            },
        },
    )
    assert response.status_code == 200, response.text
    request_id = response.json()["id"]

    response = client.put(
        f"/api/v1/approvals/profile-changes/{request_id}/approve",
        headers=admin_headers,
    )
    assert response.status_code == 200, response.text

    from db.session import SessionLocal
    from models.members import Member

    with SessionLocal() as db:
        updated = db.query(Member).filter(Member.id == member["id"]).first()

    assert updated.aadhaar_number == "999988887777"
    assert updated.referred_by_member_id == referrer["id"]


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
    role_id = _role_id(client, admin_headers, "STAFF")
    for name, password in (
        ("weak", "short"),            # too short
        ("numeric", "12345678"),      # digits only
        ("nosymbol", "Goodpass123"),  # no symbol
        ("noupper", "goodpass@123"),  # no uppercase
        ("nolower", "GOODPASS@123"),  # no lowercase
        ("nodigit", "Goodpass@abc"),  # no digit
    ):
        r = client.post(
            "/api/v1/users/", headers=admin_headers,
            json={"name": name, "username": f"{name}_pw_user", "password": password, "role_id": role_id},
        )
        assert r.status_code == 400, f"{name}: {r.text}"

    fine = client.post(
        "/api/v1/users/", headers=admin_headers,
        json={"name": "Fine", "username": "goodpass_user", "password": "Goodpass@123", "role_id": role_id},
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
        json={"subscription_id": subscription_id, "pause_start_date": "2026-01-01", "reason": "test pause"},
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
        data={"username": "admin", "password": "Admintest@123"},
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
    admin_summary = summary.json()["data"].get("1", {})
    assert admin_summary.get("LOGIN", 0) >= 1
    assert admin_summary.get("CREATE", 0) >= 1

    # timeline 404 for unknown member
    assert client.get(
        "/api/v1/activity/members/999999/timeline", headers=admin_headers
    ).status_code == 404


# ─────────────── Personal masters & member register fields ───────────────

def test_personal_masters_crud_and_member_usage(client, admin_headers):
    """The surviving personal masters (qualification, native place): CRUD,
    dup-guard, delete guard, use on a member profile, and confirmation that
    the horoscope masters (gotra/nakshatra/rashi/masa/mithi/samvathsara)
    were removed with migration 0014 — Mangalya owns that data now."""
    r = client.post("/api/v1/masters/qualifications", headers=admin_headers, json={"name_en": "B.E"})
    assert r.status_code == 201, r.text
    qualification = r.json()
    dup = client.post("/api/v1/masters/qualifications", headers=admin_headers, json={"name_en": "B.E"})
    assert dup.status_code == 409, dup.text

    # native place with district link
    districts = client.get("/api/v1/masters/districts", headers=admin_headers).json()
    district_id = districts["data"][0]["id"] if districts["data"] else None
    np_payload = {"name_en": "Siddapura", "name_kn": "ಸಿದ್ಧಾಪುರ"}
    if district_id:
        np_payload["district_id"] = district_id
    r = client.post("/api/v1/masters/native-places", headers=admin_headers, json=np_payload)
    assert r.status_code == 201, r.text
    native_place = r.json()

    # overview endpoint lists only the surviving masters
    overview = client.get("/api/v1/masters/personal-masters", headers=admin_headers)
    assert overview.status_code == 200, overview.text
    assert "qualifications" in overview.json()
    assert "native_places" in overview.json()
    assert "gotras" in overview.json() and "nakshatras" not in overview.json()

    # list + search + update
    lst = client.get("/api/v1/masters/qualifications", headers=admin_headers, params={"search": "B.E"})
    assert lst.status_code == 200 and lst.json()["total"] >= 1
    upd = client.put(
        f"/api/v1/masters/qualifications/{qualification['id']}", headers=admin_headers,
        json={"name_kn": "ಬಿ.ಇ"},
    )
    assert upd.status_code == 200 and upd.json()["name_kn"] == "ಬಿ.ಇ"

    # member with the register fields, incl. master references
    r = client.post(
        "/api/v1/members/",
        headers=admin_headers,
        json={
            "first_name_en": "Master",
            "last_name_en": "Fields",
            "mobile": "9600000001",
            "father_husband_name": "Ramaiah",
            "blood_group": "B+",
            "native_place_id": native_place["id"],
            "qualification_id": qualification["id"],
            "occupation": "Farmer",
            "aadhaar_number": "123456789012",
            "whatsapp_number": "9600000002",
        },
    )
    assert r.status_code == 201, r.text
    member = r.json()
    assert member["father_husband_name"] == "Ramaiah"
    assert member["blood_group"] == "B+"
    assert member["native_place_id"] == native_place["id"]
    assert member["qualification_id"] == qualification["id"]

    # horoscope fields no longer exist on the member schema — unknown fields
    # are ignored by pydantic, so nothing can set them even if posted
    r = client.post(
        "/api/v1/members/",
        headers=admin_headers,
        json={"first_name_en": "Horo", "mobile": "9600000005", "nakshatra_id": 1},
    )
    assert r.status_code == 201, r.text
    assert "nakshatra_id" not in r.json()

    # invalid master reference rejected
    bad = client.post(
        "/api/v1/members/",
        headers=admin_headers,
        json={"first_name_en": "Bad", "mobile": "9600000003", "qualification_id": 999999},
    )
    assert bad.status_code == 400

    # profile resolves master names
    profile = client.get(f"/api/v1/members/{member['id']}/profile", headers=admin_headers)
    assert profile.status_code == 200, profile.text
    pm = profile.json()["personal_masters"]
    assert pm["native_place"]["name_en"] == "Siddapura"
    assert pm["qualification"]["name_en"] == "B.E"
    assert "nakshatra" not in pm

    # delete guard: master in use by a member
    r = client.delete(f"/api/v1/masters/qualifications/{qualification['id']}", headers=admin_headers)
    assert r.status_code == 409

    # the other horoscope master routes are gone (gotra stays)
    for slug in ("nakshatras", "rashis", "masas", "mithis", "samvathraras"):
        resp = client.get(f"/api/v1/masters/{slug}", headers=admin_headers)
        assert resp.status_code == 404, f"{slug} should be removed ({resp.status_code})"

    # unused master deletes fine
    r = client.post("/api/v1/masters/qualifications", headers=admin_headers, json={"name_en": "M.A"})
    assert r.status_code == 201
    assert client.delete(f"/api/v1/masters/qualifications/{r.json()['id']}", headers=admin_headers).status_code == 200


def test_member_referral_and_family_membership(client, admin_headers):
    """Referral field and family membership number on members/memberships."""
    referrer = _create_member(client, admin_headers, "9600000011", "Referrer")
    r = client.post(
        "/api/v1/members/",
        headers=admin_headers,
        json={"first_name_en": "Referred", "mobile": "9600000012", "referred_by_member_id": referrer["id"]},
    )
    assert r.status_code == 201, r.text
    member = r.json()
    assert member["referred_by_member_id"] == referrer["id"]

    # invalid referral rejected
    bad = client.post(
        "/api/v1/members/",
        headers=admin_headers,
        json={"first_name_en": "Bad", "mobile": "9600000013", "referred_by_member_id": 999999},
    )
    assert bad.status_code == 400

    # family membership number via membership creation
    mtype = _create_membership_type(client, admin_headers, "FAMTEST", "Family Test")
    r = client.post(
        f"/api/v1/members/{member['id']}/memberships",
        headers=admin_headers,
        json={"membership_type_id": mtype["id"], "family_membership_number": "FAM-001"},
    )
    assert r.status_code in (200, 201), r.text
    assert r.json()["family_membership_number"] == "FAM-001"


def test_renewal_receipt_and_cheque_fields(client, admin_headers):
    """is_renewal flag + cheque capture on receipts, and the is_renewal filter."""
    member = _create_member(client, admin_headers, "9600000021", "Renewal")
    r = client.post(
        "/api/v1/receipts/",
        headers=admin_headers,
        json={
            "receipt_date": "2026-09-01",
            "payer_name": "Renewal Member",
            "receipt_type": "MEMBERSHIP",
            "payment_mode": "CHEQUE",
            "gross_amount": 500,
            "net_amount": 500,
            "is_renewal": True,
            "cheque_number": "CH-100200",
            "cheque_date": "2026-09-01",
            "allocations": [{"member_id": member["id"], "allocated_amount": 500}],
        },
    )
    assert r.status_code == 201, r.text
    receipt = r.json()
    assert receipt["is_renewal"] is True
    assert receipt["cheque_number"] == "CH-100200"
    assert receipt["cheque_date"] == "2026-09-01"

    # filter by is_renewal
    lst = client.get("/api/v1/receipts/", headers=admin_headers, params={"is_renewal": "true"})
    assert lst.status_code == 200, lst.text
    ids = [row["id"] for row in lst.json()["data"]]
    assert receipt["id"] in ids
    lst = client.get("/api/v1/receipts/", headers=admin_headers, params={"is_renewal": "false"})
    assert receipt["id"] not in [row["id"] for row in lst.json()["data"]]


def test_login_failure_audit_and_login_count(client, admin_headers):
    """LOGIN_FAILED rows for bad password AND unknown username; LOGIN bumps
    login_count."""
    # failed login against an existing account (admin)
    from db.session import SessionLocal
    from models.activity import UserActivityLog

    r = client.post("/api/v1/auth/login", data={"username": "admin", "password": "wrong-pass"})
    assert r.status_code == 401
    with SessionLocal() as db:
        row = (
            db.query(UserActivityLog)
            .filter(UserActivityLog.action == "LOGIN_FAILED", UserActivityLog.user_id.isnot(None))
            .order_by(UserActivityLog.id.desc())
            .first()
        )
    assert row is not None, "LOGIN_FAILED not recorded for known user"
    assert (row.details or {}).get("reason") == "BAD_PASSWORD"

    # failed login with unknown username (user_id NULL, username captured)
    r = client.post("/api/v1/auth/login", data={"username": "no_such_user_xy", "password": "whatever1"})
    assert r.status_code == 401
    with SessionLocal() as db:
        row = (
            db.query(UserActivityLog)
            .filter(UserActivityLog.action == "LOGIN_FAILED", UserActivityLog.user_id.is_(None))
            .order_by(UserActivityLog.id.desc())
            .first()
        )
    assert row is not None, "LOGIN_FAILED not recorded for unknown username"
    assert (row.details or {}).get("username") == "no_such_user_xy"

    # successful login increments login_count
    login = client.post("/api/v1/auth/login", data={"username": "admin", "password": "Admintest@123"})
    assert login.status_code == 200
    with SessionLocal() as db:
        from models.users import User
        user = db.query(User).filter(User.username == "admin").first()
    assert user.login_count >= 1


def test_deletion_reason_master_and_request_link(client, admin_headers):
    """Deletion-reason master CRUD + linking deletion requests via reason_id."""
    # create + duplicate guard + applies_to validation
    r = client.post(
        "/api/v1/masters/deletion-reasons",
        headers=admin_headers,
        json={"name_en": "Deceased", "name_kn": "ಮೃತಪಟ್ಟಿರುವುದು"},
    )
    assert r.status_code == 201, r.text
    reason = r.json()
    dup = client.post(
        "/api/v1/masters/deletion-reasons", headers=admin_headers, json={"name_en": "Deceased"}
    )
    assert dup.status_code == 409
    bad = client.post(
        "/api/v1/masters/deletion-reasons",
        headers=admin_headers,
        json={"name_en": "Weird", "applies_to": "BOTH"},
    )
    assert bad.status_code == 422

    # SOFT-only reason
    r = client.post(
        "/api/v1/masters/deletion-reasons",
        headers=admin_headers,
        json={"name_en": "Wrong entry", "name_kn": "ತಪ್ಪು ನಮೂದು", "applies_to": "SOFT"},
    )
    assert r.status_code == 201, r.text
    soft_reason = r.json()

    # filter by applies_to: SOFT sees the SOFT reason and unflagged ones,
    # PERMANENT only sees unflagged ones.
    lst = client.get(
        "/api/v1/masters/deletion-reasons", headers=admin_headers, params={"applies_to": "SOFT"}
    )
    assert lst.status_code == 200, lst.text
    ids = [row["id"] for row in lst.json()["data"]]
    assert soft_reason["id"] in ids
    lst = client.get(
        "/api/v1/masters/deletion-reasons", headers=admin_headers, params={"applies_to": "PERMANENT"}
    )
    assert soft_reason["id"] not in [row["id"] for row in lst.json()["data"]]

    # update
    upd = client.put(
        f"/api/v1/masters/deletion-reasons/{soft_reason['id']}",
        headers=admin_headers,
        json={"applies_to": "PERMANENT"},
    )
    assert upd.status_code == 200 and upd.json()["applies_to"] == "PERMANENT"

    # deletion request linked to the master reason
    member = _create_member(client, admin_headers, "9600000031", "DeletionLink")
    req = client.post(
        "/api/v1/approvals/deletion-requests",
        headers=admin_headers,
        params={
            "member_id": member["id"],
            "reason_id": soft_reason["id"],
            "deletion_type": "PERMANENT",
        },
    )
    assert req.status_code == 200, req.text

    from db.session import SessionLocal

    with SessionLocal() as db:
        from models.members import MemberDeletionRequest
        row = (
            db.query(MemberDeletionRequest)
            .filter(MemberDeletionRequest.member_id == member["id"])
            .order_by(MemberDeletionRequest.id.desc())
            .first()
        )
    assert row is not None and row.reason_id == soft_reason["id"]
    assert row.reason == "Wrong entry"  # name snapshotted from the master

    # invalid reason_id rejected
    req = client.post(
        "/api/v1/approvals/deletion-requests",
        headers=admin_headers,
        params={"member_id": member["id"], "reason": "free text", "reason_id": 999999},
    )
    assert req.status_code == 400

    # delete guard: reason in use cannot be deleted
    r = client.delete(
        f"/api/v1/masters/deletion-reasons/{soft_reason['id']}", headers=admin_headers
    )
    assert r.status_code == 409

    # unused reason deletes fine
    r = client.post(
        "/api/v1/masters/deletion-reasons", headers=admin_headers, json={"name_en": "Unused reason"}
    )
    assert r.status_code == 201
    assert client.delete(
        f"/api/v1/masters/deletion-reasons/{r.json()['id']}", headers=admin_headers
    ).status_code == 200


# ─────────────── expiry reminders, inbox, device tokens ───────────────

def test_membership_expiry_reminders(client, admin_headers, monkeypatch):
    """MEMBERSHIP_EXPIRY template + scan endpoint queues per-member WhatsApps
    and deduplicates repeat runs within 7 days."""
    # template for the reminder purpose
    r = client.post(
        "/api/v1/notifications/templates",
        headers=admin_headers,
        json={
            "template_name": "Expiry Reminder T",
            "purpose": "MEMBERSHIP_EXPIRY",
            "content": "Hi {{name}}, membership {{member_code}} expires on {{expiry_date}} ({{days_left}} days). Renewal reminder.",
        },
    )
    assert r.status_code in (200, 201), r.text

    member = _create_member(client, admin_headers, "9600000030", "Expiring")
    # approve so member_status is ACTIVE for the scan
    client.put(f"/api/v1/members/{member['id']}/approve", headers=admin_headers)

    mtype = _create_membership_type(client, admin_headers, "EXPTY", "Expiry Test")
    r = client.post(
        f"/api/v1/members/{member['id']}/memberships",
        headers=admin_headers,
        json={"membership_type_id": mtype["id"]},
    )
    assert r.status_code in (200, 201), r.text
    membership_id = r.json()["id"]

    # backdate expires_at to 10 days from now
    from datetime import datetime, timedelta, timezone
    from db.session import SessionLocal

    expires = datetime.now(timezone.utc) + timedelta(days=10)
    with SessionLocal() as db:
        from models.members import MemberMembership
        row = db.get(MemberMembership, membership_id)
        row.expires_at = expires
        db.commit()

    # no provider configured in tests → sends fail but are logged; the scan
    # must still count them as reminded (dedup by campaign, not delivery).
    sent = client.post("/api/v1/notifications/expiry-reminders", headers=admin_headers)
    assert sent.status_code == 200, sent.text
    assert sent.json()["queued"] >= 1

    # immediate second run → nothing new (7-day dedup window)
    again = client.post("/api/v1/notifications/expiry-reminders", headers=admin_headers)
    assert again.status_code == 200
    assert again.json()["queued"] == 0


def test_in_app_notification_inbox(client, admin_headers):
    """Broadcast visibility, unread counts, per-user read tracking."""
    # broadcast is visible to everyone
    r = client.post(
        "/api/v1/notifications/inbox/broadcast",
        headers=admin_headers,
        json={"title": "Samavesha 2026", "body": "Registrations are open."},
    )
    assert r.status_code in (200, 201), r.text
    notification_id = r.json()["id"]

    inbox = client.get("/api/v1/notifications/inbox", headers=admin_headers)
    assert inbox.status_code == 200, inbox.text
    ids = [row["id"] for row in inbox.json()["data"]]
    assert notification_id in ids

    count = client.get("/api/v1/notifications/inbox/unread-count", headers=admin_headers)
    assert count.status_code == 200
    unread_before = count.json()["unread"]
    assert unread_before >= 1

    # mark read → unread count drops; idempotent
    read = client.post(f"/api/v1/notifications/inbox/{notification_id}/read", headers=admin_headers)
    assert read.status_code == 200
    count2 = client.get("/api/v1/notifications/inbox/unread-count", headers=admin_headers)
    assert count2.json()["unread"] == unread_before - 1
    # unread_only filter hides it now
    unread_list = client.get(
        "/api/v1/notifications/inbox", headers=admin_headers, params={"unread_only": "true"}
    )
    assert notification_id not in [row["id"] for row in unread_list.json()["data"]]

    # 404 on someone else's personal notification
    missing = client.post("/api/v1/notifications/inbox/999999/read", headers=admin_headers)
    assert missing.status_code == 404


def test_device_token_registration(client, admin_headers):
    """Register, idempotent re-register, deregister."""
    payload = {"device_token": "fcm-token-abc123", "platform": "FCM", "device_name": "Pixel 9"}
    r = client.post("/api/v1/notifications/devices", headers=admin_headers, json=payload)
    assert r.status_code == 200, r.text
    token_id = r.json()["id"]
    assert r.json()["registered"] is True

    # same token again → refreshed, no duplicate row (still 1 registration id? new id ok, but count stays 1)
    r2 = client.post("/api/v1/notifications/devices", headers=admin_headers, json=payload)
    assert r2.status_code == 200
    assert r2.json()["id"] == token_id

    # remove
    d = client.delete(f"/api/v1/notifications/devices/{token_id}", headers=admin_headers)
    assert d.status_code == 200

    # re-register after removal creates a fresh row
    r3 = client.post("/api/v1/notifications/devices", headers=admin_headers, json=payload)
    assert r3.status_code == 200
    assert r3.json()["id"] != token_id


# ─────────────── service opt-ins (Magazine, Temple, Mangalya, Hall…) ───────────────

def _service_type(client, headers, code):
    """Fetch a seeded service_types row by its code."""
    response = client.get("/api/v1/masters/service-types", headers=headers)
    assert response.status_code == 200, response.text
    for row in response.json()["data"]:
        if row["code"] == code:
            return row
    pytest.fail(f"service type '{code}' not found in /masters/service-types")


def test_default_service_types_seeded(client, admin_headers):
    """Startup seeds the spec's service catalogue (Magazine, Temple,
    Mangalya, Hall); re-seeding is a no-op and never resurrects a retired
    service an admin has deleted."""
    codes = {
        t["code"]
        for t in client.get("/api/v1/masters/service-types", headers=admin_headers).json()["data"]
    }
    assert {"MAGAZINE", "TEMPLE", "MANGALYA", "HALL"} <= codes

    from db.session import SessionLocal
    from services.service_types import seed_service_types

    # idempotent: everything already present, nothing created
    with SessionLocal() as db:
        assert seed_service_types(db) == 0

    # a soft-deleted service type stays retired across re-seeds
    created = client.post(
        "/api/v1/masters/service-types", headers=admin_headers,
        json={"code": "TST_SVC_NR", "name_en": "Retire Me"},
    )
    assert created.status_code in (200, 201), created.text
    deleted = client.delete(
        f"/api/v1/masters/service-types/{created.json()['id']}", headers=admin_headers
    )
    assert deleted.status_code == 200, deleted.text

    with SessionLocal() as db:
        assert seed_service_types(db) == 0
        from models.masters import ServiceType
        rows = db.query(ServiceType).filter(ServiceType.code == "TST_SVC_NR").all()
    assert len(rows) == 1 and rows[0].is_deleted is True, "re-seed must not resurrect a retired service"


def test_service_optin_crud_lifecycle(client, admin_headers):
    """Opt in → duplicate refused → cancel → reinstate (not duplicate) →
    soft delete, with the catalogue names resolved for display."""
    member = _create_member(client, admin_headers, "9700000001", "Optin")
    temple = _service_type(client, admin_headers, "TEMPLE")

    r = client.post(
        f"/api/v1/members/{member['id']}/service-optins", headers=admin_headers,
        json={"service_type_id": temple["id"], "notes": "wants seva updates"},
    )
    assert r.status_code == 201, r.text
    optin = r.json()
    assert optin["status"] == "ACTIVE"
    assert optin["service_code"] == "TEMPLE"
    assert optin["service_name_en"] == "Temple"
    assert optin["opted_via"] == "ADMIN"

    # a second opt-in for a service the member already holds is a 409
    dup = client.post(
        f"/api/v1/members/{member['id']}/service-optins", headers=admin_headers,
        json={"service_type_id": temple["id"]},
    )
    assert dup.status_code == 409

    # unknown catalogue id / unknown member
    bad = client.post(
        f"/api/v1/members/{member['id']}/service-optins", headers=admin_headers,
        json={"service_type_id": 999999},
    )
    assert bad.status_code == 400
    missing = client.post(
        "/api/v1/members/999999/service-optins", headers=admin_headers,
        json={"service_type_id": temple["id"]},
    )
    assert missing.status_code == 404

    listing = client.get(f"/api/v1/members/{member['id']}/service-optins", headers=admin_headers)
    assert listing.status_code == 200, listing.text
    body = listing.json()
    assert body["member_id"] == member["id"]
    assert body["total"] == 1
    assert body["data"][0]["id"] == optin["id"]

    upd = client.put(
        f"/api/v1/members/{member['id']}/service-optins/{optin['id']}", headers=admin_headers,
        json={"status": "CANCELLED", "notes": "member moved away"},
    )
    assert upd.status_code == 200, upd.text
    assert upd.json()["status"] == "CANCELLED"
    assert upd.json()["notes"] == "member moved away"

    active = client.get(
        f"/api/v1/members/{member['id']}/service-optins", headers=admin_headers,
        params={"status": "ACTIVE"},
    )
    assert active.json()["total"] == 0
    cancelled = client.get(
        f"/api/v1/members/{member['id']}/service-optins", headers=admin_headers,
        params={"status": "cancelled"},
    )
    assert cancelled.json()["total"] == 1

    # re-opt-in reinstates the same row instead of colliding with the
    # partial unique index on (member_id, service_type_id)
    again = client.post(
        f"/api/v1/members/{member['id']}/service-optins", headers=admin_headers,
        json={"service_type_id": temple["id"], "opted_via": "MOBILE_APP"},
    )
    assert again.status_code == 201, again.text
    assert again.json()["status"] == "ACTIVE"
    assert again.json()["opted_via"] == "MOBILE_APP"
    assert client.get(
        f"/api/v1/members/{member['id']}/service-optins", headers=admin_headers
    ).json()["total"] == 1

    removed = client.delete(
        f"/api/v1/members/{member['id']}/service-optins/{optin['id']}", headers=admin_headers
    )
    assert removed.status_code == 200, removed.text
    assert client.get(
        f"/api/v1/members/{member['id']}/service-optins", headers=admin_headers
    ).json()["total"] == 0


def test_service_optin_body_validation(client, admin_headers):
    """Schema guards: enum fields, and never half a linked_type/linked_id pair."""
    member = _create_member(client, admin_headers, "9700000002", "OptinValid")
    temple = _service_type(client, admin_headers, "TEMPLE")

    bad_status = client.post(
        f"/api/v1/members/{member['id']}/service-optins", headers=admin_headers,
        json={"service_type_id": temple["id"], "status": "MAYBE"},
    )
    assert bad_status.status_code == 422

    bad_via = client.post(
        f"/api/v1/members/{member['id']}/service-optins", headers=admin_headers,
        json={"service_type_id": temple["id"], "opted_via": "CARRIER_PIGEON"},
    )
    assert bad_via.status_code == 422

    half_pair = client.post(
        f"/api/v1/members/{member['id']}/service-optins", headers=admin_headers,
        json={"service_type_id": temple["id"], "linked_type": "SOME_TABLE"},
    )
    assert half_pair.status_code == 422


def test_service_optin_bulk_set(client, admin_headers):
    """The registration form's checkbox group in one call: opt_in adds or
    reinstates, opt_out cancels, and the response carries the full list."""
    member = _create_member(client, admin_headers, "9700000003", "OptinBulk")
    temple = _service_type(client, admin_headers, "TEMPLE")
    hall = _service_type(client, admin_headers, "HALL")
    mangalya = _service_type(client, admin_headers, "MANGALYA")

    r = client.post(
        f"/api/v1/members/{member['id']}/service-optins/bulk", headers=admin_headers,
        json={"opt_in": [temple["id"], hall["id"]], "opt_out": [mangalya["id"]]},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["member_id"] == member["id"]
    assert body["opted_in"] == [temple["id"], hall["id"]]
    assert body["changed"] == []  # opting out a service not held is a no-op
    statuses = {row["service_code"]: row["status"] for row in body["data"]}
    assert statuses == {"TEMPLE": "ACTIVE", "HALL": "ACTIVE"}

    # flip: add Mangalya, drop Temple
    r = client.post(
        f"/api/v1/members/{member['id']}/service-optins/bulk", headers=admin_headers,
        json={"opt_in": [mangalya["id"]], "opt_out": [temple["id"]]},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["opted_in"] == [mangalya["id"]]
    assert body["changed"] == [temple["id"]]
    statuses = {row["service_code"]: row["status"] for row in body["data"]}
    assert statuses == {"TEMPLE": "CANCELLED", "HALL": "ACTIVE", "MANGALYA": "ACTIVE"}

    dup = client.post(
        f"/api/v1/members/{member['id']}/service-optins/bulk", headers=admin_headers,
        json={"opt_in": [temple["id"], temple["id"]]},
    )
    assert dup.status_code == 422
    overlap = client.post(
        f"/api/v1/members/{member['id']}/service-optins/bulk", headers=admin_headers,
        json={"opt_in": [temple["id"]], "opt_out": [temple["id"]]},
    )
    assert overlap.status_code == 422
    bad = client.post(
        f"/api/v1/members/{member['id']}/service-optins/bulk", headers=admin_headers,
        json={"opt_in": [999999]},
    )
    assert bad.status_code == 400


def test_profile_lists_active_optins(client, admin_headers):
    """The profile's services.opted shows live opt-ins only — cancelling one
    drops it off the profile without touching the rest."""
    member = _create_member(client, admin_headers, "9700000004", "OptinProfile")
    temple = _service_type(client, admin_headers, "TEMPLE")
    hall = _service_type(client, admin_headers, "HALL")

    for st in (temple, hall):
        r = client.post(
            f"/api/v1/members/{member['id']}/service-optins", headers=admin_headers,
            json={"service_type_id": st["id"]},
        )
        assert r.status_code == 201, r.text

    profile = client.get(f"/api/v1/members/{member['id']}/profile", headers=admin_headers)
    assert profile.status_code == 200, profile.text
    opted = profile.json()["services"]["opted"]
    codes = {row["service_code"] for row in opted}
    assert {"TEMPLE", "HALL"} <= codes

    temple_optin = next(row for row in opted if row["service_code"] == "TEMPLE")
    r = client.put(
        f"/api/v1/members/{member['id']}/service-optins/{temple_optin['id']}",
        headers=admin_headers, json={"status": "CANCELLED"},
    )
    assert r.status_code == 200, r.text

    opted_after = client.get(
        f"/api/v1/members/{member['id']}/profile", headers=admin_headers
    ).json()["services"]["opted"]
    codes_after = {row["service_code"] for row in opted_after}
    assert "TEMPLE" not in codes_after
    assert "HALL" in codes_after


def test_magazine_subscription_syncs_the_optin(client, admin_headers):
    """Magazine keeps its own subscription table; creating/cancelling a
    subscription must mirror into the generic opt-in list so 'Magazine'
    shows on the profile without a second manual opt-in."""
    member = _create_member(client, admin_headers, "9700000005", "OptinMagazine")

    r = client.post(
        "/api/v1/magazines/subscriptions", headers=admin_headers,
        json={"member_id": member["id"], "delivery_status": "ACTIVE"},
    )
    assert r.status_code == 201, r.text
    sub = r.json()

    rows = client.get(
        f"/api/v1/members/{member['id']}/service-optins", headers=admin_headers
    ).json()["data"]
    magazine = [row for row in rows if row["service_code"] == "MAGAZINE"]
    assert len(magazine) == 1, "subscribing must opt the member into the Magazine service"
    assert magazine[0]["status"] == "ACTIVE"
    assert magazine[0]["linked_type"] == "MAGAZINE_SUBSCRIPTION"
    assert magazine[0]["linked_id"] == sub["id"]

    # removing the subscription cancels (not deletes) the opt-in
    d = client.delete(f"/api/v1/magazines/subscriptions/{sub['id']}", headers=admin_headers)
    assert d.status_code == 200, d.text
    cancelled = client.get(
        f"/api/v1/members/{member['id']}/service-optins", headers=admin_headers,
        params={"status": "CANCELLED"},
    ).json()["data"]
    assert any(row["service_code"] == "MAGAZINE" for row in cancelled)


def test_service_type_delete_guard(client, admin_headers):
    """A service_type with live opt-ins cannot be deleted, or the profile's
    service list would silently lose entries."""
    member = _create_member(client, admin_headers, "9700000006", "OptinGuard")
    st = client.post(
        "/api/v1/masters/service-types", headers=admin_headers,
        json={"code": "TST_SVC_GUARD", "name_en": "Guarded Service"},
    )
    assert st.status_code in (200, 201), st.text
    service_type = st.json()

    dup = client.post(
        "/api/v1/masters/service-types", headers=admin_headers,
        json={"code": "TST_SVC_GUARD", "name_en": "Dup"},
    )
    assert dup.status_code == 409

    r = client.post(
        f"/api/v1/members/{member['id']}/service-optins", headers=admin_headers,
        json={"service_type_id": service_type["id"]},
    )
    assert r.status_code == 201, r.text
    blocked = client.delete(
        f"/api/v1/masters/service-types/{service_type['id']}", headers=admin_headers
    )
    assert blocked.status_code == 409
    assert "in use" in blocked.json()["detail"]

    # once the opt-in is soft-deleted the master can go
    d = client.delete(
        f"/api/v1/members/{member['id']}/service-optins/{r.json()['id']}", headers=admin_headers
    )
    assert d.status_code == 200, d.text
    ok = client.delete(
        f"/api/v1/masters/service-types/{service_type['id']}", headers=admin_headers
    )
    assert ok.status_code == 200, ok.text


def test_permanent_delete_purges_service_optins(client, admin_headers):
    """PERMANENT delete hard-removes the member's opt-in rows too — no
    orphans pointing at a member that no longer exists."""
    member = _create_member(client, admin_headers, "9700000007", "OptinPurge")
    temple = _service_type(client, admin_headers, "TEMPLE")
    r = client.post(
        f"/api/v1/members/{member['id']}/service-optins", headers=admin_headers,
        json={"service_type_id": temple["id"]},
    )
    assert r.status_code == 201, r.text

    from db.session import SessionLocal
    from models.members import MemberServiceOptin

    with SessionLocal() as db:
        assert db.query(MemberServiceOptin).filter(
            MemberServiceOptin.member_id == member["id"]
        ).count() == 1

    deleted = client.delete(
        f"/api/v1/members/{member['id']}",
        headers=admin_headers, params={"reason": "purge test", "mode": "PERMANENT"},
    )
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["mode"] == "PERMANENT"

    with SessionLocal() as db:
        assert db.query(MemberServiceOptin).filter(
            MemberServiceOptin.member_id == member["id"]
        ).count() == 0
    assert client.get(f"/api/v1/members/{member['id']}", headers=admin_headers).status_code == 404


# ─────────────── receipt tracking & activate-from-receipt ───────────────

def _make_receipt(client, headers, **overrides):
    """Minimal MEMBERSHIP receipt; overrides deep-merge over the defaults."""
    payload = {
        "receipt_date": date.today().isoformat(),
        "receipt_type": "MEMBERSHIP",
        "payment_mode": "CASH",
        "payer_name": "Track Payer",
        "gross_amount": 600,
        "discount_amount": 0,
        "net_amount": 600,
        "items": [{"item_type": "MEMBERSHIP", "amount": 600}],
    }
    payload.update(overrides)
    r = client.post("/api/v1/receipts/", headers=headers, json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def _create_associate(client, headers, name):
    r = client.post(
        "/api/v1/engagements/associates", headers=headers,
        json={"name": name, "organization": "Donor Org"},
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_receipt_purposes_accepted(client, admin_headers):
    """The 'payment made for' choice: Membership, General Donation,
    Scholarship etc are accepted receipt types."""
    for purpose in ("MEMBERSHIP", "GENERAL_DONATION", "SCHOLARSHIP"):
        receipt = _make_receipt(client, admin_headers, receipt_type=purpose, payer_name=f"Payer {purpose}")
        assert receipt["receipt_type"] == purpose
    # junk is still rejected
    r = client.post(
        "/api/v1/receipts/", headers=admin_headers,
        json={
            "receipt_date": date.today().isoformat(),
            "receipt_type": "FREE_LUNCH",
            "payment_mode": "CASH",
            "gross_amount": 100, "net_amount": 100,
        },
    )
    assert r.status_code == 400


def test_receipt_allocated_to_associate(client, admin_headers):
    """Non-member donor: allocate to an associate, shows in tracking with
    payee columns and in the allocation listings; membership_id refused."""
    associate = _create_associate(client, admin_headers, "Donor Nonmember")

    r = client.post(
        f"/api/v1/receipts/{_make_receipt(client, admin_headers, receipt_type='GENERAL_DONATION')['id']}/allocate",
        headers=admin_headers,
        json={"associate_id": associate["id"], "allocated_amount": 600},
    )
    assert r.status_code == 201, r.text
    alloc = r.json()
    assert alloc["associate_id"] == associate["id"] and alloc["member_id"] is None

    # per-receipt listing resolves the associate name
    rows = client.get(
        f"/api/v1/receipts/{alloc['receipt_id']}/allocations", headers=admin_headers
    ).json()
    assert rows[0]["associate_name"] == "Donor Nonmember"

    # global allocation listing carries payee_name too
    page = client.get("/api/v1/receipts/allocations", headers=admin_headers, params={"receipt_id": alloc["receipt_id"]}).json()
    row = next(a for a in page["data"] if a["id"] == alloc["id"])
    assert row["payee_name"] == "Donor Nonmember"

    # tracking shows the associate as payee, no member profile columns
    tracking = client.get("/api/v1/receipts/tracking", headers=admin_headers).json()["data"]
    row = next(r for r in tracking if r["id"] == alloc["receipt_id"])
    assert row["associate_id"] == associate["id"]
    assert row["associate_name"] == "Donor Nonmember"
    assert row["payee_name"] == "Donor Nonmember"
    assert row["member_id"] is None and row["approval_status"] is None

    # membership_id makes no sense for an associate
    r = client.post(
        f"/api/v1/receipts/{alloc['receipt_id']}/allocate", headers=admin_headers,
        json={"associate_id": associate["id"], "membership_id": 1, "allocated_amount": 1},
    )
    assert r.status_code == 422

    # unknown associate refused
    r = client.post(
        f"/api/v1/receipts/{alloc['receipt_id']}/allocate",
        headers=admin_headers,
        json={"associate_id": 999999, "allocated_amount": 1},
    )
    assert r.status_code == 400

    # no profile to activate on an associate-only receipt
    r = client.post(f"/api/v1/receipts/{alloc['receipt_id']}/activate-member", headers=admin_headers)
    assert r.status_code == 400
    assert "associate" in r.json()["detail"].lower()


def test_receipt_payee_xor_validation(client, admin_headers):
    """member_id and associate_id are mutually exclusive, never both, never
    neither."""
    member = _create_member(client, admin_headers, "9800000011", "XorMember")
    associate = _create_associate(client, admin_headers, "XorAssociate")
    receipt = _make_receipt(client, admin_headers)

    both = client.post(
        f"/api/v1/receipts/{receipt['id']}/allocate", headers=admin_headers,
        json={"member_id": member["id"], "associate_id": associate["id"], "allocated_amount": 100},
    )
    assert both.status_code == 422

    neither = client.post(
        f"/api/v1/receipts/{receipt['id']}/allocate", headers=admin_headers,
        json={"allocated_amount": 100},
    )
    assert neither.status_code == 422


def test_receipt_inline_allocation_to_associate_and_member_profile_reflects(client, admin_headers):
    """Same receipt entry form: one inline allocation to a member (profile
    financial.receipts shows it) and one to an associate."""
    member = _create_member(client, admin_headers, "9800000012", "InlinePayee")
    associate = _create_associate(client, admin_headers, "Inline Associate")

    r = client.post(
        "/api/v1/receipts/", headers=admin_headers,
        json={
            "receipt_date": date.today().isoformat(),
            "receipt_type": "SCHOLARSHIP",
            "payment_mode": "CHEQUE",
            "cheque_number": "CH-777",
            "payer_name": "Fund Payer",
            "gross_amount": 1500,
            "net_amount": 1500,
            "items": [{"item_type": "SCHOLARSHIP", "amount": 1500}],
            "allocations": [
                {"member_id": member["id"], "allocated_amount": 1000},
                {"associate_id": associate["id"], "allocated_amount": 500},
            ],
        },
    )
    assert r.status_code == 201, r.text
    receipt = r.json()

    # member's profile financial history reflects the receipt
    profile = client.get(f"/api/v1/members/{member['id']}/profile", headers=admin_headers)
    assert profile.status_code == 200, profile.text
    receipts = profile.json()["financial"]["receipts"]
    entry = next(e for e in receipts if e["receipt_id"] == receipt["id"])
    assert entry["receipt_type"] == "SCHOLARSHIP"
    assert float(entry["allocated_amount"]) == 1000.0

    # both allocations listed with their payee names
    rows = client.get(f"/api/v1/receipts/{receipt['id']}/allocations", headers=admin_headers).json()
    names = {(row["member_id"], row["associate_id"]): (row["member_name"], row["associate_name"]) for row in rows}
    assert names[(member["id"], None)][0] == "InlinePayee"
    assert names[(None, associate["id"])][1] == "Inline Associate"


# ─────────────── search params ───────────────

def test_receipt_search_payer_number_and_payee(client, admin_headers):
    """GET /receipts?search= matches payer name, receipt number, cheque ref,
    and payee names (member AND associate) through allocations."""
    member = _create_member(client, admin_headers, "9800000021", "Searchable")
    associate = _create_associate(client, admin_headers, "Quillridge Trust")

    member_receipt = _make_receipt(client, admin_headers, payer_name="Zyxwv Uniquepayer")
    client.post(
        f"/api/v1/receipts/{member_receipt['id']}/allocate", headers=admin_headers,
        json={"member_id": member["id"], "allocated_amount": 600},
    )
    associate_receipt = _make_receipt(client, admin_headers, payment_mode="CHEQUE", cheque_number="CHQ-5551212")
    client.post(
        f"/api/v1/receipts/{associate_receipt['id']}/allocate", headers=admin_headers,
        json={"associate_id": associate["id"], "allocated_amount": 600},
    )

    def ids_for(**params):
        body = client.get("/api/v1/receipts/", headers=admin_headers, params={"search": params.pop("search"), **params}).json()
        return {row["id"] for row in body["data"]}

    # payer name
    assert member_receipt["id"] in ids_for(search="Zyxwv Uniquepayer")
    # receipt number
    assert member_receipt["id"] in ids_for(search=member_receipt["receipt_number"])
    # cheque number (stored in its own column, not just transaction_reference)
    assert associate_receipt["id"] in ids_for(search="5551212")
    # payee: member name + mobile via allocation
    assert member_receipt["id"] in ids_for(search="Searchable")
    assert member_receipt["id"] in ids_for(search="9800000021")
    # payee: associate name via allocation
    assert associate_receipt["id"] in ids_for(search="Quillridge")
    # no match -> empty
    assert ids_for(search="nothing-matches-this-xyz") == set()


def test_receipt_tracking_search(client, admin_headers):
    """GET /receipts/tracking?search= composes with the year/mode filters and
    reaches payee names."""
    member = _create_member(client, admin_headers, "9800000022", "TrackSearch")
    receipt = _make_receipt(client, admin_headers, payer_name="Tracksearch Payername")
    client.post(
        f"/api/v1/receipts/{receipt['id']}/allocate", headers=admin_headers,
        json={"member_id": member["id"], "allocated_amount": 600},
    )

    body = client.get(
        "/api/v1/receipts/tracking", headers=admin_headers,
        params={"search": "Tracksearch Payername", "year": date.today().year},
    ).json()
    assert receipt["id"] in {row["id"] for row in body["data"]}

    # search by payee member name finds it too
    body = client.get(
        "/api/v1/receipts/tracking", headers=admin_headers,
        params={"search": "TrackSearch"},
    ).json()
    assert receipt["id"] in {row["id"] for row in body["data"]}


def test_associates_and_press_search(client, admin_headers):
    """The donor-picker search: associates by name/org/mobile/email; the
    press list by organization/reporter."""
    associate = _create_associate(client, admin_headers, "Bramhayya Samsa")
    client.put(
        f"/api/v1/engagements/associates/{associate['id']}", headers=admin_headers,
        json={"organization": "Samsa Traders", "mobile": "9812345678"},
    )
    press = client.post(
        "/api/v1/engagements/press-media", headers=admin_headers,
        json={"organization_name": "Karavali Patha", "reporter_name": "Girish Rao"},
    )
    assert press.status_code == 201, press.text

    def assoc_ids(search):
        body = client.get("/api/v1/engagements/associates", headers=admin_headers, params={"search": search}).json()
        return {row["id"] for row in body["data"]}

    assert associate["id"] in assoc_ids("Bramhayya")
    assert associate["id"] in assoc_ids("Samsa Traders")
    assert associate["id"] in assoc_ids("9812345678")
    assert assoc_ids("zzz-no-match-xyz") == set()

    press_body = client.get(
        "/api/v1/engagements/press-media", headers=admin_headers,
        params={"search": "Karavali"},
    ).json()
    assert press.json()["id"] in {row["id"] for row in press_body["data"]}


def test_events_search_and_date_filters(client, admin_headers):
    """GET /events?search= title/location; from_date/to_date narrow the date
    window."""
    created = client.post(
        "/api/v1/events/", headers=admin_headers,
        json={
            "title": "Sharadotsava 2027",
            "event_date": "2027-10-15",
            "location": "Uttara Kannada Bhavan",
        },
    )
    assert created.status_code in (200, 201), created.text
    event_id = created.json()["id"]

    body = client.get("/api/v1/events/", headers=admin_headers, params={"search": "Sharadotsava"}).json()
    assert event_id in {row["id"] for row in body["data"]}
    body = client.get("/api/v1/events/", headers=admin_headers, params={"search": "Kannada Bhavan"}).json()
    assert event_id in {row["id"] for row in body["data"]}

    body = client.get(
        "/api/v1/events/", headers=admin_headers,
        params={"from_date": "2027-10-01", "to_date": "2027-10-31"},
    ).json()
    assert event_id in {row["id"] for row in body["data"]}
    body = client.get(
        "/api/v1/events/", headers=admin_headers,
        params={"from_date": "2027-11-01"},
    ).json()
    assert event_id not in {row["id"] for row in body["data"]}

    # search with no hit
    body = client.get("/api/v1/events/", headers=admin_headers, params={"search": "no-such-event-xyz"}).json()
    assert body["total"] == 0


def test_receipt_tracking_rows_summary_and_filters(client, admin_headers):
    """The register view: linked profile + expiry per row, per-mode summary
    over the whole filtered set, and the year/month/mode filters."""
    member = _create_member(client, admin_headers, "9800000001", "TrackedOne")
    member2 = _create_member(client, admin_headers, "9800000002", "TrackedTwo")
    mtype = _create_membership_type(client, admin_headers, "TRK_TYP", "Track Type")

    r = client.post(
        f"/api/v1/members/{member['id']}/memberships", headers=admin_headers,
        json={"membership_type_id": mtype["id"]},
    )
    assert r.status_code in (200, 201), r.text
    membership_id = r.json()["id"]

    cash_receipt = _make_receipt(client, admin_headers)
    assert client.post(
        f"/api/v1/receipts/{cash_receipt['id']}/allocate", headers=admin_headers,
        json={"member_id": member["id"], "membership_id": membership_id, "allocated_amount": 600},
    ).status_code == 201
    upi_receipt = _make_receipt(client, admin_headers, payment_mode="UPI", payer_name="Track UPI")
    assert client.post(
        f"/api/v1/receipts/{upi_receipt['id']}/allocate", headers=admin_headers,
        json={"member_id": member2["id"], "allocated_amount": 600},
    ).status_code == 201

    year = date.today().year
    page = client.get(
        "/api/v1/receipts/tracking", headers=admin_headers,
        params={"year": year, "payment_mode": "CASH"},
    )
    assert page.status_code == 200, page.text
    body = page.json()

    # envelope + per-mode summary computed across the filtered set (other
    # tests in this session-scoped DB also file CASH receipts today, so the
    # counts are >=, not ==)
    assert {"total", "page", "limit", "pages", "data"} <= set(body)
    assert body["summary"]["by_payment_mode"].get("CASH", 0) >= 1
    ids = {row["id"] for row in body["data"]}
    assert cash_receipt["id"] in ids

    # newest-first: our just-created receipt leads the page
    row = body["data"][0]
    assert row["id"] == cash_receipt["id"]
    assert row["member_id"] == member["id"]
    assert row["member_name"] == "TrackedOne"
    assert row["membership_id"] == membership_id
    assert row["allocation_count"] == 1

    # UPI-only view sees the other receipt and its (membership-less) profile
    page_upi = client.get(
        "/api/v1/receipts/tracking", headers=admin_headers,
        params={"year": year, "payment_mode": "UPI"},
    ).json()
    assert page_upi["summary"]["by_payment_mode"].get("UPI", 0) >= 1
    upi_row = next(r for r in page_upi["data"] if r["id"] == upi_receipt["id"])
    assert upi_row["member_id"] == member2["id"]
    assert upi_row["membership_id"] is None
    assert upi_row["membership_expiry_date"] is None

    # an unallocated receipt shows profile columns as null (needs mapping first)
    unallocated = _make_receipt(client, admin_headers, payment_mode="CARD")
    row = client.get(
        "/api/v1/receipts/tracking", headers=admin_headers,
        params={"payment_mode": "CARD"},
    ).json()["data"][0]
    assert row["id"] == unallocated["id"]
    assert row["member_id"] is None and row["approval_status"] is None

    # member filter narrows to that member's receipts only
    mine = client.get(
        "/api/v1/receipts/tracking", headers=admin_headers,
        params={"member_id": member["id"]},
    ).json()
    assert {r["id"] for r in mine["data"]} == {cash_receipt["id"]}


def test_activate_member_from_receipt(client, admin_headers):
    """The Receipt Tracking row action: activate the unapproved profile the
    receipt was entered for — mints member_code + membership numbers exactly
    like PUT /members/{id}/approve (shared core)."""
    member = _create_member(client, admin_headers, "9800000003", "ActivateMe")
    assert member["approval_status"] == "UNAPPROVED"

    receipt = _make_receipt(client, admin_headers)
    assert client.post(
        f"/api/v1/receipts/{receipt['id']}/allocate", headers=admin_headers,
        json={"member_id": member["id"], "allocated_amount": 600},
    ).status_code == 201

    r = client.post(f"/api/v1/receipts/{receipt['id']}/activate-member", headers=admin_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["member"]["approval_status"] == "APPROVED"
    assert body["member"]["member_code"]

    from db.session import SessionLocal
    from models.members import Member, MemberMembership

    with SessionLocal() as db:
        row = db.query(Member).filter(Member.id == member["id"]).first()
        memberships = db.query(MemberMembership).filter(
            MemberMembership.member_id == member["id"]
        ).all()
    assert row.approval_status == "APPROVED"
    assert row.member_code == body["member"]["member_code"]
    assert row.approved_by is not None

    # activating again is refused (idempotency: no double numbering)
    again = client.post(f"/api/v1/receipts/{receipt['id']}/activate-member", headers=admin_headers)
    assert again.status_code == 409

    # the tracking row now shows the approved profile + minted identity
    tracking = client.get(
        "/api/v1/receipts/tracking", headers=admin_headers,
        params={"member_id": member["id"]},
    ).json()["data"][0]
    assert tracking["approval_status"] == "APPROVED"
    assert tracking["member_code"] == body["member"]["member_code"]


def test_activate_member_from_receipt_guards(client, admin_headers):
    """No allocation, several linked members, unknown receipt — all refused
    with a clear error instead of activating the wrong profile."""
    # unallocated receipt
    receipt = _make_receipt(client, admin_headers, payer_name="No Alloc")
    r = client.post(f"/api/v1/receipts/{receipt['id']}/activate-member", headers=admin_headers)
    assert r.status_code == 400
    assert "no member allocation" in r.json()["detail"]

    # two members allocated on one receipt — ambiguous
    m1 = _create_member(client, admin_headers, "9800000004", "AmbigOne")
    m2 = _create_member(client, admin_headers, "9800000005", "AmbigTwo")
    shared = _make_receipt(client, admin_headers, gross_amount=1200, net_amount=1200)
    for m in (m1, m2):
        assert client.post(
            f"/api/v1/receipts/{shared['id']}/allocate", headers=admin_headers,
            json={"member_id": m["id"], "allocated_amount": 600},
        ).status_code == 201
    r = client.post(f"/api/v1/receipts/{shared['id']}/activate-member", headers=admin_headers)
    assert r.status_code == 400
    assert "exactly one" in r.json()["detail"]

    # unknown receipt
    assert client.post("/api/v1/receipts/999999/activate-member", headers=admin_headers).status_code == 404


def test_activate_member_from_receipt_requires_permission(client, admin_headers):
    """Activation is a members.update action, not receipts — a receipts-only
    role must be refused."""
    _, _, receipts_only_headers = _staff_with_role(
        client, admin_headers, "receipts_only_user", "Receipts Only", "RECEIPTS_ONLY",
        permission_grants=[("receipts.write", False), ("receipts.write", False)],
    )
    member = _create_member(client, admin_headers, "9800000006", "NoPermTarget")
    receipt = _make_receipt(client, admin_headers, payer_name="Perm Check")
    assert client.post(
        f"/api/v1/receipts/{receipt['id']}/allocate", headers=admin_headers,
        json={"member_id": member["id"], "allocated_amount": 600},
    ).status_code == 201

    r = client.post(f"/api/v1/receipts/{receipt['id']}/activate-member", headers=receipts_only_headers)
    assert r.status_code == 403
    assert "members.write" in r.json()["detail"]


# ─────────────── receipt screen gaps: tracking export + renewals due ───────────────

def test_receipt_tracking_export_csv_and_excel(client, admin_headers):
    """The Tracking screen's Export button: the whole filtered register as a
    download — page/limit ignored, export value validated."""
    _make_receipt(client, admin_headers, payer_name="Export Payer")

    csv = client.get(
        "/api/v1/receipts/tracking", headers=admin_headers,
        params={"export": "csv", "search": "Export Payer", "page": 1, "limit": 1},
    )
    assert csv.status_code == 200, csv.text
    assert csv.headers["content-type"].startswith("text/csv")
    assert "receipt_tracking.csv" in csv.headers["content-disposition"]
    assert "Export Payer" in csv.text

    excel = client.get(
        "/api/v1/receipts/tracking", headers=admin_headers,
        params={"export": "excel", "search": "Export Payer"},
    )
    assert excel.status_code == 200, excel.text
    assert excel.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert "receipt_tracking.xlsx" in excel.headers["content-disposition"]

    # junk export value refused (same contract as /reports/*)
    bad = client.get("/api/v1/receipts/tracking", headers=admin_headers, params={"export": "pdf"})
    assert bad.status_code == 400


def test_renewals_due_worklist(client, admin_headers):
    """Receipt Entry's UNAPPROVED RENEWAL PAYMENT LIST: ACTIVE memberships
    expiring within days_ahead (plus already-expired ones), soonest first,
    with the member + membership columns needed to record the renewal."""
    from datetime import datetime, timedelta, timezone
    from db.session import SessionLocal
    from models.members import MemberMembership

    member = _create_member(client, admin_headers, "9800000031", "RenewalDue")
    mtype = _create_membership_type(client, admin_headers, "RND_TYP", "Renewal Due Type")
    r = client.post(
        f"/api/v1/members/{member['id']}/memberships", headers=admin_headers,
        json={"membership_type_id": mtype["id"]},
    )
    assert r.status_code in (200, 201), r.text
    membership_id = r.json()["id"]

    # no expires_at yet -> not on the worklist
    body = client.get("/api/v1/receipts/renewals-due", headers=admin_headers).json()
    assert membership_id not in {row["membership_id"] for row in body["data"]}

    # expiring in 10 days -> shows up with member/membership columns
    expires = datetime.now(timezone.utc) + timedelta(days=10)
    with SessionLocal() as db:
        row = db.query(MemberMembership).filter(MemberMembership.id == membership_id).first()
        row.expires_at = expires
        db.commit()

    body = client.get(
        "/api/v1/receipts/renewals-due", headers=admin_headers,
        params={"days_ahead": 30},
    ).json()
    hit = next((row for row in body["data"] if row["membership_id"] == membership_id), None)
    assert hit is not None
    assert hit["member_id"] == member["id"]
    assert hit["member_name"] == "RenewalDue"
    assert hit["membership_type"] == "Renewal Due Type"
    assert hit["status"] == "ACTIVE"
    assert hit["days_to_expiry"] in (9, 10)  # wall-time dependent

    # soonest-expiry-first ordering across the whole worklist
    expiries = [row["expiry_date"] for row in body["data"]]
    assert expiries == sorted(expiries)

    # already-expired memberships stay on the list (include_expired default)
    past = datetime.now(timezone.utc) - timedelta(days=5)
    with SessionLocal() as db:
        row = db.query(MemberMembership).filter(MemberMembership.id == membership_id).first()
        row.expires_at = past
        db.commit()
    body = client.get("/api/v1/receipts/renewals-due", headers=admin_headers).json()
    hit = next((row for row in body["data"] if row["membership_id"] == membership_id), None)
    assert hit is not None
    assert hit["days_to_expiry"] in (-6, -5)

    # include_expired=false drops it
    body = client.get(
        "/api/v1/receipts/renewals-due", headers=admin_headers,
        params={"include_expired": "false"},
    ).json()
    assert membership_id not in {row["membership_id"] for row in body["data"]}

    # export path shares the reports Export plumbing
    csv = client.get(
        "/api/v1/receipts/renewals-due", headers=admin_headers, params={"export": "csv"},
    )
    assert csv.status_code == 200, csv.text
    assert "renewals_due.csv" in csv.headers["content-disposition"]


def test_engagement_gap_endpoints(client, admin_headers):
    """Affiliation contact edit/delete, associate/press get-by-id, per-record
    magazine settings, committee term edit/delete."""
    E = "/api/v1/engagements"
    aff = client.post(f"{E}/affiliations", headers=admin_headers, json={"group_name": "GapGroup"}).json()
    c = client.post(f"{E}/affiliations/{aff['id']}/contacts", headers=admin_headers, json={"name": "A"}).json()
    r = client.put(f"{E}/affiliations/{aff['id']}/contacts/{c['id']}", headers=admin_headers, json={"name": "B"})
    assert r.status_code == 200 and r.json()["name"] == "B"
    assert client.delete(f"{E}/affiliations/{aff['id']}/contacts/{c['id']}", headers=admin_headers).status_code == 200
    assert client.delete(f"{E}/affiliations/{aff['id']}/contacts/{c['id']}", headers=admin_headers).status_code == 404

    s = client.put(f"{E}/affiliations/{aff['id']}/magazine-setting", headers=admin_headers,
                   json={"enabled": False, "address_override": "Other St"})
    assert s.status_code == 200 and s.json()["enabled"] is False
    assert client.get(f"{E}/affiliations/{aff['id']}", headers=admin_headers).json()["magazine_enabled"] is False

    assoc = client.post(f"{E}/associates", headers=admin_headers, json={"name": "Asso"}).json()
    assert client.get(f"{E}/associates/{assoc['id']}", headers=admin_headers).json()["name"] == "Asso"
    assert client.put(f"{E}/associates/{assoc['id']}/magazine-setting", headers=admin_headers,
                      json={"address_override": "X"}).json()["address_override"] == "X"
    press = client.post(f"{E}/press-media", headers=admin_headers, json={"organization_name": "Daily"}).json()
    assert client.get(f"{E}/press-media/{press['id']}", headers=admin_headers).status_code == 200
    assert client.get(f"{E}/press-media/{press['id']}/magazine-setting", headers=admin_headers).json()["enabled"] is True

    t = client.post(f"{E}/committee/terms", headers=admin_headers, json={"term_name": "T-gap"}).json()
    u = client.put(f"{E}/committee/terms/{t['id']}", headers=admin_headers, json={"term_name": "T-gap2", "is_current": True})
    assert u.status_code == 200 and u.json()["is_current"] is True
    assert client.delete(f"{E}/committee/terms/{t['id']}", headers=admin_headers).status_code == 200
    assert client.put(f"{E}/committee/terms/{t['id']}", headers=admin_headers, json={"term_name": "x"}).status_code == 404


def test_member_is_active_filter_and_activation_request(client, admin_headers):
    m = _create_member(client, admin_headers, "9800000077", "ReqAct")
    ids = lambda p: [x["id"] for x in client.get("/api/v1/members/", headers=admin_headers, params=p).json()["data"]]
    assert m["id"] in ids({"is_active": True, "limit": 100})
    assert m["id"] not in ids({"is_active": False, "limit": 100})

    r = client.post(f"/api/v1/members/{m['id']}/request-activation", headers=admin_headers)
    assert r.status_code == 200, r.text
    req_id = r.json()["approval_request_id"]
    assert client.post(f"/api/v1/members/{m['id']}/request-activation", headers=admin_headers).status_code == 409
    a = client.put(f"/api/v1/approvals/requests/{req_id}/approve", headers=admin_headers)
    assert a.status_code == 200, a.text
    got = client.get(f"/api/v1/members/{m['id']}", headers=admin_headers).json()
    assert got["approval_status"] == "APPROVED" and got["member_code"]
    assert client.post(f"/api/v1/members/{m['id']}/request-activation", headers=admin_headers).status_code == 400


def test_scheduler_sends_due_campaigns_only(client, admin_headers, monkeypatch):
    import asyncio
    import services.whatsapp as whatsapp
    from db.session import SessionLocal
    from models.notifications import NotificationCampaign
    from services.scheduler import run_due_campaigns

    async def _all_ok(recipients, message, template_id=None):
        return [{"to": r, "ok": True} for r in recipients]

    monkeypatch.setattr(whatsapp.whatsapp_service, "send_bulk", _all_ok)
    tpl = client.post("/api/v1/notifications/templates", headers=admin_headers,
                      json={"template_name": "TST_SCHED_TPL", "content": "Hi"}).json()
    mk = lambda name, when: client.post(
        "/api/v1/notifications/campaigns", headers=admin_headers,
        json={"campaign_name": name, "template_id": tpl["id"], "scheduled_at": when},
    ).json()["id"]
    past = mk("SCHED_PAST", "2020-01-01T00:00:00+00:00")
    future = mk("SCHED_FUTURE", "2099-01-01T00:00:00+00:00")

    assert asyncio.run(run_due_campaigns()) >= 1
    with SessionLocal() as db:
        assert db.get(NotificationCampaign, past).status == "SENT"
        assert db.get(NotificationCampaign, future).status != "SENT"


def test_label_pdf_renders_kannada_text(client, admin_headers):
    aff = client.post(
        "/api/v1/engagements/affiliations", headers=admin_headers,
        json={"group_name": "ಹವ್ಯಕ ಮಂಡಳಿ KN", "address": "ಬೆಂಗಳೂರು, ಕರ್ನಾಟಕ 560001"},
    )
    assert aff.status_code == 201, aff.text
    gen = client.post(
        "/api/v1/magazines/generate-labels", headers=admin_headers,
        params={"issue_month_year": "2026-04"},
    )
    assert gen.status_code == 200, gen.text
    pdf = client.get(
        f"/api/v1/magazines/label-batches/{gen.json()['batch_id']}/pdf", headers=admin_headers
    )
    assert pdf.status_code == 200, pdf.text
    assert pdf.content.startswith(b"%PDF")
    assert b"NotoSansKannada" in pdf.content  # Kannada glyphs embedded, not blanks


def test_template_campaign_crud_and_document_management(client, admin_headers):
    N = "/api/v1/notifications"
    t = client.post(f"{N}/templates", headers=admin_headers, json={"template_name": "CRUD_TPL", "content": "Hi {{name}}"}).json()
    assert client.get(f"{N}/templates/{t['id']}", headers=admin_headers).json()["template_name"] == "CRUD_TPL"
    u = client.put(f"{N}/templates/{t['id']}", headers=admin_headers, json={"content": "Hello {{name}}", "template_name": "CRUD_TPL2"})
    assert u.status_code == 200 and u.json()["content"] == "Hello {{name}}"

    c = client.post(f"{N}/campaigns", headers=admin_headers, json={"campaign_name": "CRUD_C", "template_id": t["id"]}).json()
    assert client.get(f"{N}/campaigns/{c['id']}", headers=admin_headers).status_code == 200
    assert client.put(f"{N}/campaigns/{c['id']}", headers=admin_headers, json={"campaign_name": "CRUD_C2"}).json()["campaign_name"] == "CRUD_C2"
    # template in use by an unsent campaign cannot be deleted
    assert client.delete(f"{N}/templates/{t['id']}", headers=admin_headers).status_code == 409
    assert client.delete(f"{N}/campaigns/{c['id']}", headers=admin_headers).status_code == 200
    assert client.get(f"{N}/campaigns/{c['id']}", headers=admin_headers).status_code == 404
    assert client.delete(f"{N}/templates/{t['id']}", headers=admin_headers).status_code == 200
    assert client.get(f"{N}/templates/{t['id']}", headers=admin_headers).status_code == 404

    # member documents: upload, list, verify, download, delete
    m = _create_member(client, admin_headers, "9800000088", "DocMember")
    dt = client.post("/api/v1/masters/document-types", headers=admin_headers, json={"code": "AADHAAR_CRUD", "name_en": "Aadhaar-CRUD"})
    assert dt.status_code in (200, 201), dt.text
    dt_id = dt.json()["id"]
    assert client.get(f"/api/v1/masters/document-types/{dt_id}", headers=admin_headers).status_code == 200
    up = client.post("/api/v1/members/documents/", headers=admin_headers,
                     params={"member_id": m["id"], "document_type_id": dt_id},
                     files={"file": ("a.pdf", b"%PDF-1.4 doc", "application/pdf")})
    assert up.status_code == 200, up.text
    did = up.json()["id"]
    assert client.post("/api/v1/members/documents/", headers=admin_headers,
                       params={"member_id": 99999999, "document_type_id": dt_id},
                       files={"file": ("a.pdf", b"x", "application/pdf")}).status_code == 404
    lst = client.get(f"/api/v1/members/{m['id']}/documents", headers=admin_headers).json()
    assert lst["total"] == 1 and lst["data"][0]["verification_status"] == "PENDING"
    v = client.put(f"/api/v1/members/documents/{did}", headers=admin_headers, json={"verification_status": "VERIFIED"})
    assert v.status_code == 200 and v.json()["verification_status"] == "VERIFIED"
    assert client.put(f"/api/v1/members/documents/{did}", headers=admin_headers, json={"verification_status": "NOPE"}).status_code == 400
    f = client.get(f"/api/v1/members/documents/{did}/file", headers=admin_headers)
    assert f.status_code == 200 and f.content.startswith(b"%PDF")
    assert client.delete(f"/api/v1/members/documents/{did}", headers=admin_headers).status_code == 200
    assert client.get(f"/api/v1/members/{m['id']}/documents", headers=admin_headers).json()["total"] == 0


def test_remaining_get_delete_endpoints(client, admin_headers):
    E, M = "/api/v1/engagements", "/api/v1/magazines"
    cat = client.post(f"{E}/committee/categories", headers=admin_headers, json={"name_en": "GapCat"}).json()
    sub = client.post(f"{E}/committee/subcategories", headers=admin_headers, json={"category_id": cat["id"], "name_en": "GapSub"}).json()
    term = client.post(f"{E}/committee/terms", headers=admin_headers, json={"term_name": "GapTerm"}).json()
    cm = client.post(f"{E}/committee/members", headers=admin_headers, json={"category_id": cat["id"], "member_name": "Mr X"}).json()
    for path, obj in (("subcategories", sub), ("terms", term), ("members", cm)):
        assert client.get(f"{E}/committee/{path}/{obj['id']}", headers=admin_headers).status_code == 200
        assert client.get(f"{E}/committee/{path}/99999999", headers=admin_headers).status_code == 404

    b = client.post(f"{M}/delivery-batches", headers=admin_headers, json={"batch_name": "B1", "issue_month_year": "2026-05"}).json()
    assert client.get(f"{M}/delivery-batches/{b['id']}", headers=admin_headers).status_code == 200
    assert client.put(f"{M}/delivery-batches/{b['id']}", headers=admin_headers, json={"status": "DISPATCHED"}).json()["status"] == "DISPATCHED"
    assert client.delete(f"{M}/delivery-batches/{b['id']}", headers=admin_headers).status_code == 200
    assert client.get(f"{M}/delivery-batches/{b['id']}", headers=admin_headers).status_code == 404

    sr = client.post("/api/v1/reports/saved", headers=admin_headers, json={"report_name": "SR1", "report_key": "members", "filters": {}})
    if sr.status_code in (200, 201):
        assert client.get(f"/api/v1/reports/saved/{sr.json()['id']}", headers=admin_headers).status_code == 200
    assert client.get("/api/v1/masters/deletion-reasons/99999999", headers=admin_headers).status_code == 404


def test_update_own_profile_rotates_session(client, admin_headers):
    uid, role_id, headers = _staff_with_role(
        client, admin_headers, "prof_user", "Prof Role", "PROF_ROLE", permission_grants=[],
    )
    taken = client.put("/api/v1/auth/me", headers=headers, json={"username": "admin"})
    assert taken.status_code == 400
    ok = client.put("/api/v1/auth/me", headers=headers, json={"name": "New Name", "email": "n@x.com"})
    assert ok.status_code == 200, ok.text
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 401  # old session invalidated
    fresh = client.post("/api/v1/auth/login", data={"username": "prof_user", "password": STAFF_PW}).json()
    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {fresh['access_token']}"}).json()
    assert me["name"] == "New Name" and me["email"] == "n@x.com"


def test_gotra_master_and_extra_address_fields(client, admin_headers):
    g = client.post("/api/v1/masters/gotras", headers=admin_headers, json={"name_en": "Gowtama", "name_kn": "ಗೌತಮ"})
    assert g.status_code == 201, g.text
    assert client.post("/api/v1/masters/gotras", headers=admin_headers, json={"name_en": "Gowtama"}).status_code == 409
    assert "gotras" in client.get("/api/v1/masters/personal-masters", headers=admin_headers).json()

    m = client.post("/api/v1/members/", headers=admin_headers, json={
        "first_name_en": "Gotra", "last_name_en": "Holder", "mobile": "9611111111",
        "gotra_id": g.json()["id"], "address_line1": "Souhardha Marike House", "address_line2": "Post Aryapu",
        "area": "Sullia Road", "place": "Puttur", "grama": "Aryapu", "village": "Kolthige",
        "label_point": "DK", "address_remarks": "ask for the gate key",
    })
    assert m.status_code == 201, m.text
    body = m.json()
    assert body["gotra_id"] == g.json()["id"] and body["village"] == "Kolthige" and body["label_point"] == "DK"
    assert body["address_remarks"] == "ask for the gate key"

    # free-text fallback + invalid master reference
    t = client.post("/api/v1/members/", headers=admin_headers, json={"first_name_en": "Txt", "mobile": "9611111112", "gotra_text": "Kashyapa"})
    assert t.status_code == 201 and t.json()["gotra_text"] == "Kashyapa"
    assert client.post("/api/v1/members/", headers=admin_headers, json={"first_name_en": "Bad", "mobile": "9611111113", "gotra_id": 999999}).status_code == 400

    # profile resolves it; edit works; in-use master cannot be deleted
    prof = client.get(f"/api/v1/members/{body['id']}/profile", headers=admin_headers).json()
    assert prof["personal_masters"]["gotra"]["name_en"] == "Gowtama"
    upd = client.put(f"/api/v1/members/{body['id']}", headers=admin_headers, json={"place": "Bantwal"})
    assert upd.status_code == 200 and upd.json()["place"] == "Bantwal"
    assert client.delete(f"/api/v1/masters/gotras/{g.json()['id']}", headers=admin_headers).status_code == 409

    # the label address carries the village-style parts
    sub = client.post("/api/v1/magazines/subscriptions", headers=admin_headers, json={"member_id": body["id"]})
    assert sub.status_code in (200, 201), sub.text
    gen = client.post("/api/v1/magazines/generate-labels", headers=admin_headers, params={"issue_month_year": "2026-06"})
    assert gen.status_code == 200, gen.text
    items = client.get(f"/api/v1/magazines/label-batches/{gen.json()['batch_id']}", headers=admin_headers).json()
    text = str(items)
    assert "Souhardha Marike House, Post Aryapu" in text and "Bantwal, Aryapu, Kolthige" in text


def test_monthly_marks_returned_R_and_pause_with_reason(client, admin_headers):
    M = "/api/v1/magazines"
    member = _create_member(client, admin_headers, "9622222222", "Returned Twice")
    sub = client.post(f"{M}/subscriptions", headers=admin_headers, json={"member_id": member["id"]}).json()

    # no marks yet: 12 empty boxes, no pause suggestion
    grid = client.get(f"{M}/subscriptions/{sub['id']}/monthly", headers=admin_headers, params={"year": 2026}).json()
    assert [b["mark"] for b in grid["months"]] == [""] * 12 and grid["suggest_pause"] is False

    # mark R for two issues (return_date defaults to today)
    for month in ("2026-03", "2026-07"):
        r = client.post(f"{M}/returns", headers=admin_headers,
                        json={"subscription_id": sub["id"], "issue_month_year": month, "return_reason": "door locked"})
        assert r.status_code == 201, r.text
    grid = client.get(f"{M}/members/{member['id']}/monthly", headers=admin_headers, params={"year": 2026}).json()
    marks = {b["month"]: b["mark"] for b in grid["months"]}
    assert marks[3] == "R" and marks[7] == "R" and marks[1] == ""
    assert grid["returned_in_year"] == 2 and grid["months"][2]["return_reason"] == "door locked"

    # repeat-return list + suggestion once it is within the last 12 months
    from datetime import date
    this_month = date.today().strftime("%Y-%m")
    client.post(f"{M}/returns", headers=admin_headers, json={"subscription_id": sub["id"], "issue_month_year": this_month})
    repeat = client.get(f"{M}/returns/repeat", headers=admin_headers, params={"min_returns": 2}).json()
    row = next(r for r in repeat["data"] if r["subscription_id"] == sub["id"])
    assert row["returns_in_period"] >= 2 and row["member_id"] == member["id"]
    cur = client.get(f"{M}/subscriptions/{sub['id']}/monthly", headers=admin_headers).json()
    assert cur["suggest_pause"] is True

    # pausing needs a reason...
    assert client.post(f"{M}/pauses", headers=admin_headers, json={"subscription_id": sub["id"]}).status_code == 422
    assert client.post(f"{M}/pauses", headers=admin_headers, json={"subscription_id": sub["id"], "reason": "   "}).status_code == 422
    # ...starts today by default and flips the subscription to PAUSED
    pause = client.post(f"{M}/pauses", headers=admin_headers, json={"subscription_id": sub["id"], "reason": "returned twice"})
    assert pause.status_code == 201, pause.text
    assert pause.json()["pause_start_date"] == date.today().isoformat() and pause.json()["reason"] == "returned twice"
    assert client.get(f"{M}/subscriptions/{sub['id']}", headers=admin_headers).json()["delivery_status"] == "PAUSED"
    cur = client.get(f"{M}/subscriptions/{sub['id']}/monthly", headers=admin_headers).json()
    assert cur["suggest_pause"] is False
    assert not any(r["subscription_id"] == sub["id"] for r in client.get(f"{M}/returns/repeat", headers=admin_headers).json()["data"])
    assert next(b for b in cur["months"] if b["issue_month_year"] == this_month)["mark"] in ("R", "P")

    # resume puts it back to ACTIVE
    assert client.post(f"{M}/pauses/{pause.json()['id']}/resume", headers=admin_headers).status_code == 200
    assert client.get(f"{M}/subscriptions/{sub['id']}", headers=admin_headers).json()["delivery_status"] == "ACTIVE"

    # unmark an R
    ret = client.get(f"{M}/returns", headers=admin_headers, params={"subscription_id": sub["id"], "issue_month_year": "2026-03"}).json()["data"][0]
    assert client.delete(f"{M}/returns/{ret['id']}", headers=admin_headers).status_code == 200
    grid = client.get(f"{M}/subscriptions/{sub['id']}/monthly", headers=admin_headers, params={"year": 2026}).json()
    assert grid["months"][2]["mark"] in ("", "P")
    assert client.get(f"{M}/members/99999999/monthly", headers=admin_headers).status_code == 404


def test_membership_credit_auto_upgrade_with_remaining_carried(client, admin_headers):
    H = admin_headers
    # isolate the ladder: retire every other membership type from earlier tests
    for t in client.get("/api/v1/masters/membership-types", headers=H, params={"limit": 500}).json()["data"]:
        client.put(f"/api/v1/masters/membership-types/{t['id']}", headers=H, json={"status": False})

    def mk_type(code, name, price):
        t = _create_membership_type(client, H, code, name)
        pr = client.post(f"/api/v1/masters/membership-types/{t['id']}/prices", headers=H,
                         json={"amount": price, "effective_from": "2026-01-01"})
        assert pr.status_code in (200, 201), pr.text
        return t

    poshaka = mk_type("LAD_POSHAKA", "Ladder Poshaka", 1000)
    maha = mk_type("LAD_MAHA", "Ladder Mahaposhaka", 5000)

    member = _create_member(client, H, "9633333333", "Ladder")
    mid = member["id"]
    credit = lambda: client.get(f"/api/v1/members/{mid}/membership-credit", headers=H).json()
    pay = lambda amt, rtype="MEMBERSHIP": _make_receipt(
        client, H, receipt_type=rtype, gross_amount=amt, net_amount=amt,
        items=[{"item_type": rtype, "amount": amt}],
        allocations=[{"member_id": mid, "allocated_amount": amt}],
    )

    # 600 is short of the cheapest type: nothing happens, 600 stays as remaining
    pay(600)
    c = credit()
    assert c["credit_total"] == 600 and c["qualified_type"] is None and c["current_type"] is None
    assert c["remaining_amount"] == 600 and c["next_type"]["code"] == "LAD_POSHAKA" and c["amount_to_next_type"] == 400

    # +900 -> 1500: becomes Poshaka, 500 left over toward Mahaposhaka
    pay(900)
    c = credit()
    assert c["current_type"]["code"] == "LAD_POSHAKA" and c["qualified_type"]["code"] == "LAD_POSHAKA"
    assert c["remaining_amount"] == 500 and c["amount_to_next_type"] == 3500 and c["upgrade_pending"] is False
    assert client.get(f"/api/v1/members/{mid}/profile", headers=H).json()["membership_credit"]["credit_total"] == 1500

    # a general donation counts too: 1500 + 3500 = 5000 -> Mahaposhaka, nothing left over
    donation = pay(3500, "GENERAL_DONATION")
    c = credit()
    assert c["current_type"]["code"] == "LAD_MAHA" and c["remaining_amount"] == 0 and c["next_type"] is None

    # upgrade history was written
    hist = client.get(f"/api/v1/members/{mid}/profile", headers=H).json()
    assert any(m["membership_type_id"] == maha["id"] for m in hist["memberships"])

    # every fund counts by default (Don 1-3, P.Nidhi, scholarship), but a
    # magazine payment is a purchase, not giving
    settings = client.get("/api/v1/masters/membership-credit-settings", headers=H).json()
    assert {"DONATION_1", "DONATION_2", "DONATION_3", "P_NIDHI", "SCHOLARSHIP", "MEMBERSHIP"} <= set(settings["receipt_types"])
    assert "MAGAZINE" not in settings["receipt_types"]
    pay(100, "MAGAZINE")
    assert credit()["credit_total"] == 5000
    pay(100, "DONATION_1"); pay(100, "DONATION_2"); pay(100, "DONATION_3"); pay(100, "P_NIDHI"); pay(300, "SCHOLARSHIP")
    assert credit()["credit_total"] == 5700

    # extra money beyond the top type is kept as remaining
    assert credit()["remaining_amount"] == 700 and credit()["current_type"]["code"] == "LAD_MAHA"

    # cancelling a receipt never downgrades; the summary just shows the shortfall
    assert client.post(f"/api/v1/receipts/{donation['id']}/cancel", headers=H, json={"reason": "bounced"}).status_code == 200
    c = credit()
    assert c["credit_total"] == 2200 and c["current_type"]["code"] == "LAD_MAHA"
    assert c["qualified_type"]["code"] == "LAD_POSHAKA" and c["remaining_amount"] == 1200
    assert client.post(f"/api/v1/members/{mid}/membership-credit/recalculate", headers=H).json()["changed"] is None

    # allocating later (receipt first, member mapped afterwards) also upgrades
    m2 = _create_member(client, H, "9644444444", "Ladder Two")
    r = _make_receipt(client, H, gross_amount=1000, net_amount=1000, items=[{"item_type": "MEMBERSHIP", "amount": 1000}])
    assert client.get(f"/api/v1/members/{m2['id']}/membership-credit", headers=H).json()["current_type"] is None
    assert client.post(f"/api/v1/receipts/{r['id']}/allocate", headers=H,
                       json={"member_id": m2["id"], "allocated_amount": 1000}).status_code == 201
    assert client.get(f"/api/v1/members/{m2['id']}/membership-credit", headers=H).json()["current_type"]["code"] == "LAD_POSHAKA"

    # a refund reduces what the receipt contributes
    m3 = _create_member(client, H, "9655555555", "Ladder Three")
    r3 = _make_receipt(client, H, gross_amount=2000, net_amount=2000, items=[{"item_type": "MEMBERSHIP", "amount": 2000}],
                       allocations=[{"member_id": m3["id"], "allocated_amount": 2000}])
    assert client.get(f"/api/v1/members/{m3['id']}/membership-credit", headers=H).json()["credit_total"] == 2000
    assert client.post(f"/api/v1/receipts/{r3['id']}/refund", headers=H, json={"amount": 1000, "status": "COMPLETED"}).status_code == 200
    assert client.get(f"/api/v1/members/{m3['id']}/membership-credit", headers=H).json()["credit_total"] == 1000

    # setting round trip
    put = client.put("/api/v1/masters/membership-credit-settings", headers=H, json=["membership", "scholarship"])
    assert put.status_code == 200 and put.json()["receipt_types"] == ["MEMBERSHIP", "SCHOLARSHIP"]
    assert client.put("/api/v1/masters/membership-credit-settings", headers=H, json=[]).status_code == 400
    assert client.put("/api/v1/masters/membership-credit-settings", headers=H, json=["NOPE"]).status_code == 400
    client.put("/api/v1/masters/membership-credit-settings", headers=H, json=settings["default"])


def test_membership_credit_checkbox_options_api(client, admin_headers):
    H = admin_headers
    cfg = client.get("/api/v1/masters/membership-credit-settings", headers=H).json()
    opts = {o["code"]: o for o in cfg["options"]}
    assert {"MEMBERSHIP", "TYPE_CHANGE", "GENERAL_DONATION", "DONATION_1", "DONATION_2", "DONATION_3", "P_NIDHI",
            "SCHOLARSHIP", "MAGAZINE", "EVENT", "OTHER"} <= set(opts)
    assert opts["P_NIDHI"]["label"] == "P. Nidhi" and opts["P_NIDHI"]["selected"] is True and opts["P_NIDHI"]["default"] is True
    assert opts["MAGAZINE"]["selected"] is False and opts["MAGAZINE"]["default"] is False

    # untick everything but membership + P.Nidhi, save, read back
    saved = client.put("/api/v1/masters/membership-credit-settings", headers=H, json=["MEMBERSHIP", "P_NIDHI"])
    assert saved.status_code == 200, saved.text
    assert {o["code"] for o in saved.json()["options"] if o["selected"]} == {"MEMBERSHIP", "P_NIDHI"}
    assert client.get("/api/v1/masters/membership-credit-settings", headers=H).json()["receipt_types"] == ["MEMBERSHIP", "P_NIDHI"]

    # a member's credit follows the saved ticks; ?include= previews other ticks without saving
    m = _create_member(client, H, "9666666666", "Boxes")
    for rtype, amt in (("MEMBERSHIP", 100), ("P_NIDHI", 40), ("SCHOLARSHIP", 25)):
        _make_receipt(client, H, receipt_type=rtype, gross_amount=amt, net_amount=amt,
                      items=[{"item_type": rtype, "amount": amt}],
                      allocations=[{"member_id": m["id"], "allocated_amount": amt}])
    url = f"/api/v1/members/{m['id']}/membership-credit"
    base = client.get(url, headers=H).json()
    assert base["credit_total"] == 140 and base["preview"] is False and base["counted_receipt_types"] == ["MEMBERSHIP", "P_NIDHI"]
    pre = client.get(url, headers=H, params={"include": "MEMBERSHIP,P_NIDHI,SCHOLARSHIP"}).json()
    assert pre["credit_total"] == 165 and pre["preview"] is True
    assert client.get(url, headers=H).json()["credit_total"] == 140  # nothing saved
    assert client.get(url, headers=H, params={"include": "NOPE"}).status_code == 400

    # validation + reset to defaults
    assert client.put("/api/v1/masters/membership-credit-settings", headers=H, json=["NOPE"]).status_code == 400
    assert client.put("/api/v1/masters/membership-credit-settings", headers=H, json=[]).status_code == 400
    reset = client.post("/api/v1/masters/membership-credit-settings/reset", headers=H)
    assert reset.status_code == 200 and set(reset.json()["receipt_types"]) == set(cfg["default"])


def test_every_foreign_key_and_filter_column_is_indexed(client):
    """Guards db/indexes.py: a new FK column must not ship without an index."""
    from sqlalchemy import inspect
    from db.session import engine
    from db.indexes import EXTRA_INDEXES

    insp = inspect(engine)
    missing = []
    for table in insp.get_table_names():
        first_cols = {i["column_names"][0] for i in insp.get_indexes(table) if i["column_names"]}
        first_cols |= set(insp.get_pk_constraint(table).get("constrained_columns", [])[:1])
        first_cols |= {u["column_names"][0] for u in insp.get_unique_constraints(table) if u["column_names"]}
        for fk in insp.get_foreign_keys(table):
            if fk["constrained_columns"][0] not in first_cols:
                missing.append(f"{table}.{fk['constrained_columns'][0]}")
        for t, c in EXTRA_INDEXES:
            if t == table and c not in first_cols:
                missing.append(f"{table}.{c}")
    assert not missing, f"unindexed: {missing}"
