import pytest
from datetime import date
from db.session import SessionLocal
from models.members import Member, MemberApprovalHistory, MemberProfileChangeRequest
from models.receipts import Receipt
from models.notifications import NotificationCampaign, NotificationTemplate
from models.masters import State, District, PostalCode

API = "/api/v1"


def test_notification_campaign_channel_and_filters_stored(client, admin_headers):
    # Ensure a notification template exists
    with SessionLocal() as db:
        tpl = db.query(NotificationTemplate).filter(NotificationTemplate.is_deleted == False).first()
        if not tpl:
            tpl = NotificationTemplate(
                template_name="General Announcement",
                content="Hello {{name}}",
                purpose="GENERAL",
                status=True,
            )
            db.add(tpl)
            db.commit()
            db.refresh(tpl)
        tpl_id = tpl.id

    payload = {
        "campaign_name": "Diwali Greeting Campaign",
        "channel": "WHATSAPP",
        "template_id": tpl_id,
        "filters": {"approval_status": "APPROVED"},
    }

    res = client.post(f"{API}/notifications/campaigns", headers=admin_headers, json=payload)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["channel"] == "WHATSAPP"
    assert data["member_filters"] == {"approval_status": "APPROVED"}

    # Verify directly in DB
    with SessionLocal() as db:
        campaign = db.query(NotificationCampaign).filter(NotificationCampaign.id == data["id"]).first()
        assert campaign is not None
        assert campaign.channel == "WHATSAPP"
        assert campaign.member_filters == {"approval_status": "APPROVED"}


def test_bulk_member_import_pincode_stored(client, admin_headers):
    with SessionLocal() as db:
        st = State(name_en="Karnataka", code="KA", status=True)
        db.add(st)
        db.flush()
        dist = District(name_en="Bengaluru Urban", state_id=st.id, status=True)
        db.add(dist)
        db.flush()
        pc = PostalCode(pincode="560001", post_office_name="GPO Bengaluru", state_id=st.id, district_id=dist.id, status=True)
        db.add(pc)
        db.commit()
        pc_id, st_id, dist_id = pc.id, st.id, dist.id

    import uuid
    uniq_num = f"BULK-{uuid.uuid4().hex[:6].upper()}"
    payload = {
        "members": [
            {
                "membership_number": uniq_num,
                "first_name_en": "Pincode",
                "last_name_en": "Tester",
                "mobile": "9998887771",
                "pincode": "560001",
            }
        ],
        "skip_duplicates": True,
    }

    res = client.post(f"{API}/members/bulk-import", headers=admin_headers, json=payload)
    assert res.status_code == 200, res.text
    assert res.json()["success_count"] == 1

    with SessionLocal() as db:
        m = db.query(Member).filter(Member.member_code == uniq_num).first()
        assert m is not None
        assert m.pincode_id == pc_id
        assert m.state_id == st_id
        assert m.district_id == dist_id


def test_member_approval_reason_stored(client, admin_headers):
    import uuid
    uniq_mobile = f"98{uuid.uuid4().int % 100000000:08d}"
    create_res = client.post(
        f"{API}/members/",
        headers=admin_headers,
        json={
            "first_name_en": "ApproveReason",
            "last_name_en": "Test",
            "mobile": uniq_mobile,
            "address_line1": "Test Address",
        },
    )
    assert create_res.status_code in (200, 201), create_res.text
    m_id = create_res.json()["id"]

    approve_res = client.put(
        f"{API}/members/{m_id}/approve",
        headers=admin_headers,
        params={"reason": "Approved via UI test verification"},
    )
    assert approve_res.status_code == 200, approve_res.text
    assert approve_res.json()["approval_status"] == "APPROVED"

    with SessionLocal() as db:
        history = (
            db.query(MemberApprovalHistory)
            .filter(MemberApprovalHistory.member_id == m_id, MemberApprovalHistory.action == "APPROVE")
            .order_by(MemberApprovalHistory.id.desc())
            .first()
        )
        assert history is not None
        assert history.reason == "Approved via UI test verification"


def test_receipt_deletion_reason_stored(client, admin_headers):
    import uuid
    r_num = f"DEL-{uuid.uuid4().hex[:6].upper()}"
    rec_res = client.post(
        f"{API}/receipts/",
        headers=admin_headers,
        json={
            "receipt_number": r_num,
            "receipt_date": "2026-04-15",
            "receipt_type": "DONATION",
            "payer_name": "Delete Reason Test",
            "payment_mode": "CASH",
            "gross_amount": 500,
            "net_amount": 500,
            "notes": "Initial notes",
            "items": [{"item_type": "DONATION", "description": "General", "amount": 500}],
        },
    )
    assert rec_res.status_code in (200, 201), rec_res.text
    r_id = rec_res.json()["id"]

    del_res = client.delete(
        f"{API}/receipts/{r_id}",
        headers=admin_headers,
        params={"reason": "Deleted via UI test verification"},
    )
    assert del_res.status_code == 200, del_res.text

    with SessionLocal() as db:
        r = db.query(Receipt).filter(Receipt.id == r_id).first()
        assert r is not None
        assert r.is_deleted is True
        assert "[Deleted: Deleted via UI test verification]" in (r.notes or "")


def test_member_change_request_magazine_fields(client, admin_headers):
    import uuid
    uniq_mobile = f"97{uuid.uuid4().int % 100000000:08d}"
    create_res = client.post(
        f"{API}/members/",
        headers=admin_headers,
        json={
            "first_name_en": "MagazineFields",
            "last_name_en": "Test",
            "mobile": uniq_mobile,
            "address_line1": "Initial Street",
        },
    )
    assert create_res.status_code in (200, 201), create_res.text
    m_id = create_res.json()["id"]

    client.put(f"{API}/members/{m_id}/approve", headers=admin_headers)

    req_payload = {
        "member_id": m_id,
        "source": "MEMBER_PORTAL",
        "new_values": {
            "magazine_delivery_address": "456 Publishing Road, Bengaluru",
            "magazine_kind": "PHYSICAL",
            "magazine_email": "subscriber@example.com",
        },
    }

    cr_res = client.post(f"{API}/members/profile-changes/", headers=admin_headers, json=req_payload)
    assert cr_res.status_code in (200, 201), cr_res.text
    cr_data = cr_res.json()
    assert cr_data["new_values"]["magazine_delivery_address"] == "456 Publishing Road, Bengaluru"
    assert cr_data["new_values"]["magazine_kind"] == "PHYSICAL"
    assert cr_data["new_values"]["magazine_email"] == "subscriber@example.com"
