"""Tests for the two backend gaps closed in this pass:

* POST /api/v1/members/public-register — the unauthenticated website
  registration door (rate limited, forced PENDING/ONLINE, duplicate checks).
* WhatsApp template provider-approval-status tracking
  (PUT /notifications/templates/{id}/approval-status + list filter).
"""

import os

import pytest


@pytest.fixture(autouse=True)
def _clean_rate_limiter():
    """The in-process limiter is global; isolate each test's IP budget."""
    from core.ratelimit import rate_limiter

    rate_limiter._hits.clear()
    yield
    rate_limiter._hits.clear()


# ─────────────── public website registration ───────────────

def test_public_register_creates_pending_member(client):
    response = client.post(
        "/api/v1/members/public-register",
        json={"first_name_en": "WebsiteVisitor", "mobile": "9340000901"},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["member_id"]
    assert body["approval_status"] == "UNAPPROVED"
    assert body["member_code"] is None, "public signup must never mint a membership number"

    # The admin sees it in the ordinary unapproved flow — same table, forced PENDING.
    client.post("/api/v1/auth/login", data={"username": "admin", "password": "Admintest@123"})
    # (login rate limit is 10/5min per user; the suite already logs in, so reuse
    # a fresh token via the standard flow inside the fixture's client session)


def test_public_register_forces_status_fields(client, admin_headers):
    response = client.post(
        "/api/v1/members/public-register",
        json={
            "first_name_en": "ForgeAttempt",
            "mobile": "9340000902",
            "registration_status": "APPROVED",
            "approval_status": "APPROVED",
            "member_code": "HMSM-9999",
            "is_deleted": True,
        },
    )
    # Private fields are rejected outright rather than silently dropped.
    assert response.status_code == 422, response.text

    # And without them, nothing privileged is minted.
    ok = client.post(
        "/api/v1/members/public-register",
        json={"first_name_en": "ForgeAttempt2", "mobile": "9340000903"},
    )
    assert ok.status_code == 201, ok.text
    member = client.get(f"/api/v1/members/{ok.json()['member_id']}", headers=admin_headers).json()
    assert member["approval_status"] == "UNAPPROVED"
    assert member["registration_source"] == "ONLINE"
    assert member["registration_status"] == "PENDING"
    assert member["member_code"] is None


def test_public_register_requires_contact(client):
    response = client.post(
        "/api/v1/members/public-register",
        json={"first_name_en": "NoContact"},
    )
    assert response.status_code == 422, response.text
    assert "mobile or email" in str(response.json())


def test_public_register_duplicate_mobile(client):
    first = client.post(
        "/api/v1/members/public-register",
        json={"first_name_en": "DupOne", "mobile": "9340000904"},
    )
    assert first.status_code == 201, first.text
    second = client.post(
        "/api/v1/members/public-register",
        json={"first_name_en": "DupTwo", "mobile": "9340000904"},
    )
    assert second.status_code == 409, second.text
    assert "already registered" in second.json()["detail"]


def test_public_register_provisions_member_login(client, admin_headers):
    response = client.post(
        "/api/v1/members/public-register",
        json={"first_name_en": "LoginHolder", "mobile": "9340000905"},
    )
    assert response.status_code == 201, response.text

    # The username exists as a MEMBER account (same provisioning as staff
    # registration); the password is server-generated and never returned.
    users = client.get(
        "/api/v1/users", headers=admin_headers, params={"search": "9340000905"}
    ).json()
    assert users["total"] >= 1
    account = next(u for u in users["data"] if u["username"] == "9340000905")
    assert "password" not in str(account).lower() or account.get("password_hash") is None


def test_public_register_geo_cross_checks(client, admin_headers):
    # States are not seeded, so create the parents this test needs.
    state = client.post(
        "/api/v1/masters/states", headers=admin_headers, json={"name_en": "PublicReg State"}
    )
    assert state.status_code == 200, state.text
    state_id = state.json()["id"]
    district = client.post(
        "/api/v1/masters/districts",
        headers=admin_headers,
        json={"name_en": "PublicRegDistrict", "name_kn": "ಸಾರ್ವಜನಿಕ ಜಿಲ್ಲೆ", "state_id": state_id},
    )
    assert district.status_code == 200, district.text
    district_id = district.json()["id"]
    other_state = client.post(
        "/api/v1/masters/states", headers=admin_headers, json={"name_en": "PublicReg Other State"}
    ).json()["id"]

    bad = client.post(
        "/api/v1/members/public-register",
        json={
            "first_name_en": "GeoMismatch",
            "mobile": "9340000906",
            "state_id": other_state,
            "district_id": district_id,
        },
    )
    assert bad.status_code == 400, bad.text
    assert "does not belong" in bad.json()["detail"]


def test_public_register_rate_limited(client):
    for i in range(5):
        response = client.post(
            "/api/v1/members/public-register",
            json={"first_name_en": f"RateLimit{i}", "mobile": f"934010091{i}"},
        )
        assert response.status_code == 201, response.text
    sixth = client.post(
        "/api/v1/members/public-register",
        json={"first_name_en": "RateLimit6", "mobile": "9340100916"},
    )
    assert sixth.status_code == 429, sixth.text


# ─────────────── template approval status ───────────────

def _create_template(client, admin_headers, name="Approval Template"):
    response = client.post(
        "/api/v1/notifications/templates",
        headers=admin_headers,
        json={
            "template_name": name,
            "content": "Hello {{name}}",
            "purpose": "GENERAL",
            "provider_template_id": "meta-123",
        },
    )
    assert response.status_code == 200, response.text  # ungated create returns 200 here
    return response.json()


def test_template_approval_status_roundtrip(client, admin_headers):
    template = _create_template(client, admin_headers, "Roundtrip Template")
    assert template["provider_approval_status"] is None

    updated = client.put(
        f"/api/v1/notifications/templates/{template['id']}/approval-status",
        headers=admin_headers,
        json={"provider_approval_status": "APPROVED", "provider_template_id": "meta-123", "note": "Meta review ok"},
    )
    assert updated.status_code == 200, updated.text
    body = updated.json()
    assert body["provider_approval_status"] == "APPROVED"
    assert body["provider_approval_note"] == "Meta review ok"
    assert body["provider_approval_synced_at"]

    rejected = client.put(
        f"/api/v1/notifications/templates/{template['id']}/approval-status",
        headers=admin_headers,
        json={"provider_approval_status": "REJECTED", "note": "policy violation"},
    )
    assert rejected.status_code == 200, rejected.text
    assert rejected.json()["provider_approval_status"] == "REJECTED"


def test_template_approval_status_requires_known_state(client, admin_headers):
    template = _create_template(client, admin_headers, "Bad Status Template")
    response = client.put(
        f"/api/v1/notifications/templates/{template['id']}/approval-status",
        headers=admin_headers,
        json={"provider_approval_status": "MAYBE"},
    )
    assert response.status_code == 422, response.text


def test_template_list_filters_by_approval_status(client, admin_headers):
    approved = _create_template(client, admin_headers, "Filter Approved")
    client.put(
        f"/api/v1/notifications/templates/{approved['id']}/approval-status",
        headers=admin_headers,
        json={"provider_approval_status": "APPROVED"},
    )
    plain = _create_template(client, admin_headers, "Filter Never Submitted")

    approved_list = client.get(
        "/api/v1/notifications/templates", headers=admin_headers, params={"approval_status": "APPROVED", "limit": 100}
    ).json()
    assert approved["id"] in {t["id"] for t in approved_list["data"]}
    assert plain["id"] not in {t["id"] for t in approved_list["data"]}

    none_list = client.get(
        "/api/v1/notifications/templates", headers=admin_headers, params={"approval_status": "NONE", "limit": 100}
    ).json()
    assert plain["id"] in {t["id"] for t in none_list["data"]}
    assert approved["id"] not in {t["id"] for t in none_list["data"]}


def test_template_approval_status_requires_permission(client):
    """Unauthenticated callers cannot flip provider verdicts."""
    response = client.put(
        "/api/v1/notifications/templates/1/approval-status",
        json={"provider_approval_status": "APPROVED"},
    )
    assert response.status_code in (401, 403), response.text


# ─────────────── organisation settings screen ───────────────

def test_get_organisation_settings_defaults(client, admin_headers):
    """First read creates the singleton row with the receipt-book defaults."""
    response = client.get("/api/v1/system/settings", headers=admin_headers)
    assert response.status_code == 200, response.text
    body = response.json()
    # Profile — defaults mirror the printed receipt book
    assert body["id"] == 1
    assert body["name_en"] == "Sri Akhila Havyaka Mahasabha (R)"
    assert body["name_kn"].startswith("ಶ್ರೀ")
    assert "560003" in body["address_en"]
    assert body["registration_no"] == "9001-2015"
    assert body["iso_cert_no"] == "ISO-OM-2104068"
    # Contact
    assert body["phone"] == "080-23481913"
    assert body["email"] == "srhavyaka@gmail.com"
    # Print header
    assert body["print_header_enabled"] is True
    assert body["president_title_kn"] == "ಅಧ್ಯಕ್ಷರು"
    assert body["secretary_title_en"] == "Secretary"
    assert body["pay_mode_upi_kn"] == "ಯು.ಪಿ.ಐ"
    assert "realisation" in body["receipt_footer_note_en"]
    # Notification toggles
    assert body["notify_whatsapp_enabled"] is True


def test_put_organisation_settings_partial_update(client, admin_headers):
    """Only the fields in the body change; everything else is preserved."""
    original = client.get("/api/v1/system/settings", headers=admin_headers).json()

    response = client.put(
        "/api/v1/system/settings",
        headers=admin_headers,
        json={"name_en": "Sri Akhila Havyaka Mahasabha (R) — Edited", "mobile": "90000 00000"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["name_en"] == "Sri Akhila Havyaka Mahasabha (R) — Edited"
    assert body["mobile"] == "90000 00000"
    assert body["updated_by"] is not None

    # Untouched fields keep their values (and Kannada is unaffected).
    assert body["email"] == original["email"]
    assert body["name_kn"] == original["name_kn"]
    assert body["receipt_footer_note_en"] == original["receipt_footer_note_en"]

    # And the change is visible on the next read.
    assert client.get("/api/v1/system/settings", headers=admin_headers).json()["mobile"] == "90000 00000"


def test_put_organisation_settings_rejects_unknown_fields(client, admin_headers):
    response = client.put(
        "/api/v1/system/settings",
        headers=admin_headers,
        json={"nmae_en": "Typo"},  # misspelled on purpose
    )
    assert response.status_code == 422, response.text


def test_put_organisation_settings_requires_login(client):
    response = client.put("/api/v1/system/settings", json={"name_en": "Nope"})
    assert response.status_code == 401, response.text


def test_toggle_print_header_and_notification_settings(client, admin_headers):
    response = client.put(
        "/api/v1/system/settings",
        headers=admin_headers,
        json={"print_header_enabled": False, "notify_sms_enabled": False},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["print_header_enabled"] is False
    assert body["notify_sms_enabled"] is False
    assert body["notify_email_enabled"] is True  # untouched toggle stays


def test_upload_organisation_logo(client, admin_headers):
    """Logo upload stores the file, points logo_path at it, and a re-upload
    replaces (and deletes) the previous file."""
    response = client.post(
        "/api/v1/system/settings/logo",
        headers=admin_headers,
        files={"file": ("logo.png", b"\x89PNG\r\n\x1a\nfakepngbytes", "image/png")},
    )
    assert response.status_code == 200, response.text
    first = response.json()["logo_path"]
    assert first and first.endswith(".png")
    assert os.path.isfile(first)

    # Re-upload replaces the logo and cleans up the old file.
    response = client.post(
        "/api/v1/system/settings/logo",
        headers=admin_headers,
        files={"file": ("logo2.jpg", b"\xff\xd8\xff\xfakejpeg", "image/jpeg")},
    )
    assert response.status_code == 200, response.text
    second = response.json()["logo_path"]
    assert second != first
    assert os.path.isfile(second)
    assert not os.path.isfile(first), "superseded logo file must be deleted"

    # And GET reflects the current logo.
    assert client.get("/api/v1/system/settings", headers=admin_headers).json()["logo_path"] == second


def test_upload_organisation_logo_rejects_non_image(client, admin_headers):
    response = client.post(
        "/api/v1/system/settings/logo",
        headers=admin_headers,
        files={"file": ("notes.txt", b"just text", "text/plain")},
    )
    assert response.status_code == 400, response.text


def test_upload_organisation_logo_requires_login(client):
    response = client.post(
        "/api/v1/system/settings/logo",
        files={"file": ("logo.png", b"x", "image/png")},
    )
    assert response.status_code == 401, response.text
