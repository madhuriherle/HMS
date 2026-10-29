"""Import of the old register's members: membership number and old number, statuses, magazine, repeat runs."""
from datetime import datetime

from test_api import _create_membership_type
from test_frontend_contract import API, _sfx
from test_legacy_import import _register, _row


def test_members_import(client, admin_headers):
    from db.session import SessionLocal
    from models.members import Member, MemberMembership
    from models.magazines import MagazineSubscription
    from services import legacy_import

    s = _sfx()
    mt = _create_membership_type(client, admin_headers, "LM" + s[-5:], "Ajeeva")   # the register's AJEEVA finds this type by name
    rows = legacy_import.read_register(_register([
        _row(910001, "RAMA BHAT", CusNoOld=5, CusMobile="9876543299", CusGotra="KASHYAPA"),
        _row(910002, "SITA HEGDE", CusStatus="Expired"),
        _row(910003, "GOPAL RAO", DeleteMark="*"),
        _row(910004, ""),                                   # no name: skipped
        _row(910005, "LAKSHMI", CusMemberType="NOSUCH"),                # unknown type: skipped
    ]))
    db = SessionLocal()
    try:
        out = legacy_import.import_members(db, rows, 1, run_id="t" + s[-8:], file_name="MstMember.xlsx")
        assert out["created"] == 3 and out["skipped"] == 2 and out["deleted"] == 1 and out["expired"] == 1, out
        a = db.query(Member).filter(Member.membership_number == "910001").one()
        assert a.old_membership_number == "5" and a.legacy_ref_number is None and a.approval_status == "APPROVED" and a.registration_source == "MIGRATION"
        assert a.mobile == "9876543299"
        # the register has only a full name: keep it whole, do not split into first / middle / last
        assert (a.full_name_en, a.first_name_en, a.middle_name_en, a.last_name_en) == ("RAMA BHAT", "RAMA BHAT", None, None)
        b = db.query(Member).filter(Member.membership_number == "910002").one()
        assert b.old_membership_number is None and b.member_status == "INACTIVE" and "Expired" in (b.remarks or "")
        c = db.query(Member).filter(Member.membership_number == "910003").one()
        assert c.is_deleted is False and c.member_status == "INACTIVE" and "Marked deleted" in (c.remarks or "")   # kept as an inactive member
        assert db.query(MemberMembership).filter(MemberMembership.member_id == a.id).one().membership_type_id == mt["id"]
        # rows imported by an older run were split: the backfill puts the whole name back
        a.first_name_en, a.middle_name_en, a.last_name_en = "RAMA", None, "BHAT"
        db.commit()
        assert legacy_import.backfill_full_name(db)["updated"] >= 1
        db.refresh(a)
        assert (a.full_name_en, a.first_name_en, a.middle_name_en, a.last_name_en) == ("RAMA BHAT", "RAMA BHAT", None, None)
        # a second run adds nothing
        again = legacy_import.import_members(db, rows, 1, run_id="u" + s[-8:])
        assert again["created"] == 0
    finally:
        db.close()
    found = client.get(f"{API}/members/", headers=admin_headers, params={"search": "910001"})
    assert found.status_code == 200 and any((m.get("membership_number") or m.get("member_code")) == "910001" for m in found.json()["data"])


def test_guardian_relation_goes_to_guardian_name(client, admin_headers):
    from db.session import SessionLocal
    from models.members import Member
    from services import legacy_import

    s = _sfx()
    _create_membership_type(client, admin_headers, "LG" + s[-5:], "Ajeeva")
    rows = legacy_import.read_register(_register([
        _row(980001, "GUARDIAN G", CusRelation="G", CusNameFather="MANJUNATHA HEGDE"),
        _row(980002, "FATHER F", CusRelation="S/O", CusNameFather="RAMA BHAT"),
        _row(980003, "WIFE W", CusRelation="W/O", CusNameFather="GOPAL RAO"),
        _row(980004, "GUARDIAN BLANK", CusRelation="G"),
    ]))
    db = SessionLocal()
    try:
        out = legacy_import.import_members(db, rows, 1, run_id="g" + s[-8:], file_name="MstMember.xlsx")
        assert out["created"] == 4, out
        g = db.query(Member).filter(Member.membership_number == "980001").one()
        assert (g.guardian_name, g.father_husband_name) == ("MANJUNATHA HEGDE", None)
        f = db.query(Member).filter(Member.membership_number == "980002").one()
        assert (f.guardian_name, f.father_husband_name) == (None, "S/O RAMA BHAT")
        w = db.query(Member).filter(Member.membership_number == "980003").one()
        assert (w.guardian_name, w.father_husband_name) == (None, "W/O GOPAL RAO")
        blank = db.query(Member).filter(Member.membership_number == "980004").one()
        assert (blank.guardian_name, blank.father_husband_name) == (None, None)
        # rows imported before the guardian field existed carry the name in father_husband_name
        g.guardian_name, g.father_husband_name = None, "MANJUNATHA HEGDE"
        db.commit()
        moved = legacy_import.backfill_guardian_names(db, rows)
        assert moved["moved"] >= 1, moved
        db.refresh(g)
        assert (g.guardian_name, g.father_husband_name) == ("MANJUNATHA HEGDE", None)
        assert legacy_import.backfill_guardian_names(db, rows)["moved"] == 0
    finally:
        db.close()


def test_import_fetches_state_district_taluk_from_the_pincode(client, admin_headers):
    from db.session import SessionLocal
    from models.masters import District, PostalCode, State, Taluk
    from models.members import Member
    from services import legacy_import

    s = _sfx()
    _create_membership_type(client, admin_headers, "LP" + s[-5:], "Ajeeva")
    db = SessionLocal()
    try:
        st = State(name_en="State " + s, status=True)
        db.add(st)
        db.flush()
        d_pin = District(state_id=st.id, name_en="Pin District " + s, status=True)
        d_file = District(state_id=st.id, name_en="File District " + s, status=True)
        db.add_all([d_pin, d_file])
        db.flush()
        t_pin = Taluk(district_id=d_pin.id, name_en="Pin Taluk " + s, status=True)
        t_file = Taluk(district_id=d_file.id, name_en="File Taluk " + s, status=True)
        db.add_all([t_pin, t_file])
        db.commit()
        pc = PostalCode(pincode="6" + s[-5:], post_office_name="PO " + s, state_id=st.id, district_id=d_pin.id, taluk_id=t_pin.id, status=True)
        db.add(pc)
        db.commit()
        rows = legacy_import.read_register(_register([
            _row(930001, "PLACE CHECK", CusPinCode=pc.pincode, CusPost=pc.post_office_name, CusState=st.name_en,
                 CusDistrict=d_file.name_en, CusTaluk=t_file.name_en),
            _row(930002, "PIN IN POST", CusPinCode="0", CusPost=pc.pincode, CusState=st.name_en),
        ]))
        out = legacy_import.import_members(db, rows, 1, run_id="p" + s[-8:], file_name="MstMember.xlsx")
        assert out["created"] == 2, out
        m = db.query(Member).filter(Member.membership_number == "930001").one()
        # the pincode row says Pin District / Pin Taluk, the register says File District / File Taluk:
        # the database's pincode row wins
        assert (m.state_id, m.district_id, m.taluk_id) == (st.id, d_pin.id, t_pin.id)
        # a row whose pin and post are swapped (0 in the pin column) still finds the pincode from the post field
        swapped = db.query(Member).filter(Member.membership_number == "930002").one()
        assert (swapped.pincode_id, swapped.state_id, swapped.district_id, swapped.taluk_id) == (pc.id, st.id, d_pin.id, t_pin.id)
        assert swapped.post == pc.post_office_name and any("Pincode '0'" in w["warning"] for w in out["warning_list"])
    finally:
        db.close()


def test_receipts_import(client, admin_headers):
    from datetime import date
    from db.session import SessionLocal
    from models.members import Member
    from models.receipts import Receipt, ReceiptAllocation, ReceiptItem
    from services import legacy_import, membership_credit

    s = _sfx()
    # the Membership particular and the type the members get must exist
    _create_membership_type(client, admin_headers, "RM" + s[-5:], "Ajeeva")
    rows = legacy_import.read_register(_register([
        _row(920001, "ASHA A", [(5001, datetime(1990, 6, 1), 200), (None, datetime(1991, 7, 1), 0), (None, None, 200)],
             CusMemUpAmt2=0),
        _row(920002, "BHAT B", [(777, datetime(1985, 5, 1), 100)]),                       # shares receipt 777 ...
        _row(920003, "CHARAN C", [(777, datetime(1985, 5, 1), 100)]),                     # ... with this one
        _row(920004, "DEEPA D", [(9, datetime(1996, 5, 1), 400)], CusScholarAmt1=150, CusReceiptNote1="PATRIKA FUND"),
        _row(920005, "ESHA E", [(11, datetime(1927, 1, 1), 100)]),                         # wrong date: not imported
    ]))
    db = SessionLocal()
    try:
        from models.masters import Particular
        if not db.query(Particular).filter(Particular.name_en == "Membership", Particular.parent_id.is_(None), Particular.is_deleted == False).first():  # noqa: E712
            db.add(Particular(code="RT-" + s[-6:], name_en="Membership", status=True, pays_for_membership=True))
            db.commit()
        legacy_import.import_members(db, rows, 1, run_id="r" + s[-8:])
        out = legacy_import.import_receipts(db, rows, 1)
        assert out["ignored_undated"] == 1 and out["not_imported_other"] == 1, {k: v for k, v in out.items() if k != "plan"}
        assert out["created"] == 5 and out["shared"] == 0 and out["dummy"] == 1, {k: v for k, v in out.items() if k != "plan"}
        ids = {m.membership_number: m.id for m in db.query(Member).filter(Member.membership_number.in_(["920001", "920002", "920003", "920004"])).all()}
        # two records with the number 777 on one date: each is a receipt of its own, the first keeps 777, the next is 777/2
        for number in ("777", "777/2"):
            own = db.query(Receipt).filter(Receipt.receipt_number == number, Receipt.source == "OLD_REGISTER").one()
            assert float(own.net_amount) == 100 and own.receipt_status == "ASSIGNED" and own.is_old_receipt is False
            allocs = db.query(ReceiptAllocation).filter(ReceiptAllocation.receipt_id == own.id).all()
            assert [float(a.allocated_amount) for a in allocs] == [100.0]
        dummy = db.query(Receipt).join(ReceiptAllocation, ReceiptAllocation.receipt_id == Receipt.id).filter(
            ReceiptAllocation.member_id == ids["920001"], Receipt.is_old_receipt == True).one()  # noqa: E712
        assert dummy.receipt_number == "FY91-001" and float(dummy.net_amount) == 0 and dummy.receipt_date == date(1991, 7, 1)
        mixed = db.query(Receipt).filter(Receipt.receipt_number == "9").one()
        assert float(mixed.net_amount) == 550 and mixed.receipt_type == "MEMBERSHIP"
        names = {i.particular_name + "/" + (i.sub_particular_name or "") for i in db.query(ReceiptItem).filter(ReceiptItem.receipt_id == mixed.id).all()}
        assert names == {"Membership/", "Scholarship/General"}
        # only the membership money counts toward the member
        assert float(membership_credit.credit_ledger(db, ids["920004"])["total"]) == 400
        # a second run adds nothing
        assert legacy_import.import_receipts(db, rows, 1)["created"] == 0
    finally:
        db.close()


def test_receipts_import_gives_each_record_its_own_receipt_across_runs(client, admin_headers):
    from datetime import date
    from db.session import SessionLocal
    from models.masters import Particular
    from models.receipts import Receipt, ReceiptAllocation
    from services import legacy_import

    s = _sfx()
    _create_membership_type(client, admin_headers, "RN" + s[-5:], "Ajeeva")
    rows = legacy_import.read_register(_register([
        _row(930001, "FIRST F", [(888, datetime(1984, 5, 1), 100)]),
        _row(930002, "SECOND S", [(888, datetime(1984, 5, 1), 100)]),
    ]))
    db = SessionLocal()
    try:
        if not db.query(Particular).filter(Particular.name_en == "Membership", Particular.parent_id.is_(None), Particular.is_deleted == False).first():  # noqa: E712
            db.add(Particular(code="RT-" + s[-6:], name_en="Membership", status=True, pays_for_membership=True))
            db.commit()
        legacy_import.import_members(db, rows, 1, run_id="q" + s[-8:])
        assert legacy_import.import_receipts(db, rows[:1], 1)["created"] == 1          # the first member alone
        assert legacy_import.import_receipts(db, rows, 1)["created"] == 1              # the second has a receipt of their own: 888/2
        for number in ("888", "888/2"):
            r = db.query(Receipt).filter(Receipt.receipt_number == number, Receipt.receipt_date == date(1984, 5, 1)).one()
            assert float(r.net_amount) == 100
            assert db.query(ReceiptAllocation).filter(ReceiptAllocation.receipt_id == r.id).count() == 1
    finally:
        db.close()


def test_renumber_imported(client, admin_headers):
    """Members imported with CusNo taken as the old number are corrected: number = CusNo, old number = CusNoOld."""
    from db.session import SessionLocal
    from models.members import Member, MemberMembership
    from services import legacy_import

    s = _sfx()
    _create_membership_type(client, admin_headers, "RN" + s[-5:], "Ajeeva")
    rows = legacy_import.read_register(_register([_row(940001, "NITIN K", CusNoOld=7), _row(940002, "OMKAR L")]))
    db = SessionLocal()
    try:
        legacy_import.import_members(db, rows, 1, run_id="v" + s[-8:])
        for m in db.query(Member).filter(Member.membership_number.in_(["940001", "940002"])).all():   # put them back as the wrong import left them
            m.old_membership_number, m.membership_number, m.legacy_ref_number = m.membership_number, None, "9"
            db.query(MemberMembership).filter(MemberMembership.member_id == m.id).update({"membership_number": None})
        db.commit()
        out = legacy_import.renumber_imported(db, rows)
        assert out["members"] == 2 and out["with_old_number"] == 1, out
        a = db.query(Member).filter(Member.membership_number == "940001").one()
        b = db.query(Member).filter(Member.membership_number == "940002").one()
        assert a.old_membership_number == "7" and a.legacy_ref_number is None and b.old_membership_number is None
        assert db.query(MemberMembership).filter(MemberMembership.member_id == a.id).one().membership_number == "940001"
        try:
            legacy_import.renumber_imported(db, rows)
            raised = False
        except RuntimeError:
            raised = True
        assert raised          # a second run is refused
    finally:
        db.close()


def test_backfill_kannada(client, admin_headers):
    """The Unicode register's Kannada name replaces the old font's junk; a member with none loses the junk."""
    from db.session import SessionLocal
    from models.members import Member
    from services import legacy_import

    s = _sfx()
    _create_membership_type(client, admin_headers, "KN" + s[-5:], "Ajeeva")
    rows = legacy_import.read_register(_register([_row(950001, "ARUN K", CusNameKannada="ಅರುಣ್"), _row(950002, "BHAVYA M")]))
    db = SessionLocal()
    try:
        legacy_import.import_members(db, rows, 1, run_id="w" + s[-8:])
        for no, junk in (("950001", "²æÃ"), ("950002", "¦ðv")):
            db.query(Member).filter(Member.membership_number == no).update({"full_name_kn": junk})
        db.commit()
        out = legacy_import.backfill_kannada(db, rows)
        assert out["updated"] >= 1 and out["junk_cleared"] >= 1, out
        assert db.query(Member).filter(Member.membership_number == "950001").one().full_name_kn == "ಅರುಣ್"
        assert db.query(Member).filter(Member.membership_number == "950002").one().full_name_kn is None
        assert legacy_import.backfill_kannada(db, rows)["updated"] == 0      # a second run changes nothing
    finally:
        db.close()


def test_upgrade_column_is_patrika_nidhi(client, admin_headers):
    """The upgrade column is Patrika Nidhi: Membership + upgrade is a Membership line and a Patrika Nidhi line; receipts made the old way are split."""
    from datetime import date
    from db.session import SessionLocal
    from models.receipts import Receipt, ReceiptItem
    from services import legacy_import

    s = _sfx()
    _create_membership_type(client, admin_headers, "ML" + s[-5:], "Ajeeva")
    rows = legacy_import.read_register(_register([
        _row(960001, "UMA U", [(7001, datetime(1999, 5, 1), 400)], CusMemUpAmt1=100),
        _row(960002, "VEENA V", [(7002, datetime(1999, 6, 1), 0)], CusMemUpAmt1=100),       # an upgrade amount alone
    ]))
    db = SessionLocal()

    def lines(number):
        rid = db.query(Receipt.id).filter(Receipt.receipt_number == number).scalar()
        return rid, sorted((i.particular_name, i.sub_particular_name or "", float(i.amount)) for i in
                           db.query(ReceiptItem).filter(ReceiptItem.receipt_id == rid, ReceiptItem.is_deleted == False))  # noqa: E712
    try:
        legacy_import.import_members(db, rows, 1, run_id="x" + s[-8:])
        legacy_import.import_receipts(db, rows, 1)
        rid, got = lines("7001")
        assert got == [("Donation", "Patrika Nidhi", 100.0), ("Membership", "", 400.0)], got
        alone, got2 = lines("7002")
        assert got2 == [("Donation", "Patrika Nidhi", 100.0)], got2
        assert db.query(Receipt.receipt_type).filter(Receipt.id == alone).scalar() == "GENERAL_DONATION"
        assert db.query(Receipt.receipt_type).filter(Receipt.id == rid).scalar() == "MEMBERSHIP"

        # a receipt made the old way (the upgrade inside the Membership line, or as an upgrade-only line) is split
        items = db.query(ReceiptItem).filter(ReceiptItem.receipt_id == rid, ReceiptItem.is_deleted == False).all()  # noqa: E712
        for i in items:
            if i.particular_name == "Donation":
                i.is_deleted = True
            else:
                i.amount, i.description = 500, "includes upgrade amount 100"
        for i in db.query(ReceiptItem).filter(ReceiptItem.receipt_id == alone, ReceiptItem.is_deleted == False):  # noqa: E712
            i.item_type, i.particular_name, i.sub_particular_name, i.sub_particular_id = "TYPE_CHANGE", "Membership", None, None
        db.query(Receipt).filter(Receipt.id == alone).update({"receipt_type": "MEMBERSHIP"})
        db.commit()
        out = legacy_import.split_upgrade_into_patrika(db, rows, 1)
        assert out["receipts_changed"] == 2 and out["amount_moved_to_patrika_nidhi"] == 200, out
        assert lines("7001")[1] == [("Donation", "Patrika Nidhi", 100.0), ("Membership", "", 400.0)]
        assert lines("7002")[1] == [("Donation", "Patrika Nidhi", 100.0)]
        assert db.query(Receipt.receipt_type).filter(Receipt.id == alone).scalar() == "GENERAL_DONATION"
        assert legacy_import.split_upgrade_into_patrika(db, rows, 1)["receipts_changed"] == 0      # a second run changes nothing

        # two lines of one particular on a receipt are still joined by merge_same_particular_lines
        first = db.query(ReceiptItem).filter(ReceiptItem.receipt_id == rid, ReceiptItem.particular_name == "Membership").first()
        db.add(ReceiptItem(receipt_id=rid, item_type="MEMBERSHIP", particular_id=first.particular_id, particular_name="Membership", amount=50, line_no=9,
                           pays_for_membership=True, created_by=1))
        db.commit()
        assert legacy_import.merge_same_particular_lines(db)["lines_removed"] >= 1
        assert lines("7001")[1] == [("Donation", "Patrika Nidhi", 100.0), ("Membership", "", 450.0)]
    finally:
        db.close()


def test_patrika_nidhi_receipts(client, admin_headers):
    """A register row noted PATRIKA FUND keeps its upgrade / donation money as Donation > Patrika Nidhi, not membership."""
    from datetime import date
    from db.session import SessionLocal
    from models.receipts import Receipt, ReceiptItem
    from services import legacy_import

    s = _sfx()
    _create_membership_type(client, admin_headers, "PN" + s[-5:], "Ajeeva")
    rows = legacy_import.read_register(_register([
        _row(970001, "PRATHAP P", [(8801, datetime(2009, 8, 5), 0)], CusMemUpAmt1=100, CusReceiptNote1="PATRIKA FUND"),
        _row(970002, "QUEEN Q", [(8802, datetime(2009, 9, 5), 400)], CusMemUpAmt1=100),
    ]))
    db = SessionLocal()
    try:
        legacy_import.import_members(db, rows, 1, run_id="y" + s[-8:])
        legacy_import.import_receipts(db, rows, 1)
        pat = db.query(Receipt).filter(Receipt.receipt_number == "8801", Receipt.receipt_date == date(2009, 8, 5)).one()
        lines = db.query(ReceiptItem).filter(ReceiptItem.receipt_id == pat.id, ReceiptItem.is_deleted == False).all()  # noqa: E712
        assert [(i.particular_name, i.sub_particular_name, float(i.amount), i.item_type) for i in lines] == [("Donation", "Patrika Nidhi", 100.0, "DONATION")]
        assert pat.receipt_type == "GENERAL_DONATION" and float(pat.net_amount) == 100
        normal = db.query(Receipt).filter(Receipt.receipt_number == "8802").one()
        assert sorted((i.particular_name, float(i.amount)) for i in db.query(ReceiptItem).filter(ReceiptItem.receipt_id == normal.id, ReceiptItem.is_deleted == False)) == [("Donation", 100.0), ("Membership", 400.0)]  # noqa: E712

        # a receipt imported the old way (the money as a membership upgrade line) is moved
        for i in lines:
            i.is_deleted = True
        db.add(ReceiptItem(receipt_id=pat.id, item_type="TYPE_CHANGE", particular_id=db.query(ReceiptItem.particular_id).filter(ReceiptItem.receipt_id == normal.id, ReceiptItem.particular_name == "Membership").scalar(),
                           particular_name="Membership", description="Upgrade amount (old register)", amount=100, line_no=1, pays_for_membership=True, created_by=1))
        pat.receipt_type = "MEMBERSHIP"
        db.commit()
        out = legacy_import.retag_patrika_receipts(db, rows, 1)
        assert out["receipts_changed"] == 1 and out["amount_moved_to_patrika_nidhi"] == 100, out
        lines = db.query(ReceiptItem).filter(ReceiptItem.receipt_id == pat.id, ReceiptItem.is_deleted == False).all()  # noqa: E712
        assert [(i.particular_name, i.sub_particular_name, float(i.amount)) for i in lines] == [("Donation", "Patrika Nidhi", 100.0)]
        db.refresh(pat)
        assert pat.receipt_type == "GENERAL_DONATION" and float(pat.net_amount) == 100
        assert legacy_import.retag_patrika_receipts(db, rows, 1)["receipts_changed"] == 0     # a second run changes nothing
    finally:
        db.close()


def test_magazine_no_stays_no_whatever_else_the_row_says(client, admin_headers):
    """CusMagazine = No means no magazine, even when the row is marked Online, has an email, is a Poshaka, or has receipts."""
    from db.session import SessionLocal
    from models.magazines import MagazineSubscription
    from models.members import Member
    from services import legacy_import

    s = _sfx()
    _create_membership_type(client, admin_headers, "MN" + s[-5:], "Ajeeva")
    rows = legacy_import.read_register(_register([
        _row(990001, "MAG NO ONLINE", CusMagazine="No", CusOnline="Online", CusEmail="no@example.com", CusReceiptNo1=77001, CusReceiptDate1=datetime(2025, 5, 1), CusMemAmt1=1000),
        _row(990002, "MAG NO PRINT", CusMagazine="No", CusOnline="Print"),
        _row(990003, "MAG YES ONLINE", CusMagazine="Yes", CusOnline="Online", CusEmail="yes@example.com"),
        _row(990004, "MAG YES PRINT", CusMagazine="Yes", CusOnline="Print"),
    ]))
    db = SessionLocal()
    try:
        assert legacy_import.import_members(db, rows, 1, run_id="m" + s[-8:], file_name="MstMember.xlsx")["created"] == 4
        got = {m.membership_number: m for m in db.query(Member).filter(Member.membership_number.in_(["990001", "990002", "990003", "990004"]))}
        for no in ("990001", "990002"):
            m = got[no]
            assert (m.magazine_needed, m.magazine_kind, m.magazine_email) == (False, None, None), no
            assert db.query(MagazineSubscription).filter(MagazineSubscription.member_id == m.id).count() == 0, no
        assert (got["990003"].magazine_needed, got["990003"].magazine_kind) == (True, "EMAIL")
        assert (got["990004"].magazine_needed, got["990004"].magazine_kind) == (True, "PHYSICAL")
    finally:
        db.close()


def test_upgrade_with_an_amrutha_mahotsava_note_goes_to_that_campaign(client, admin_headers):
    """The upgrade column is Patrika Nidhi, except an amount whose note names the 75-year Amrutha Mahotsava campaign (Donation > Amrutha Mahotsava Abhiyana)."""
    from db.session import SessionLocal
    from models.members import Member
    from models.receipts import Receipt, ReceiptItem
    from services import legacy_import

    s = _sfx()
    _create_membership_type(client, admin_headers, "AM" + s[-5:], "Ajeeva")
    day = datetime(2025, 6, 2)
    rows = legacy_import.read_register(_register([
        _row(995001, "CAMPAIGN ONE", CusReceiptNo1=88001, CusReceiptDate1=day, CusMemAmt1=1000, CusMemUpAmt1=100, CusReceiptNote1="Amruthamahosthava Abhiyana"),
        _row(995002, "CAMPAIGN TWO", CusReceiptNo1=88002, CusReceiptDate1=day, CusMemUpAmt1=100, CusReceiptNote1="A.M Office"),
        _row(995003, "PLAIN UPGRADE", CusReceiptNo1=88003, CusReceiptDate1=day, CusMemUpAmt1=100),
        _row(995004, "PATRIKA NOTE", CusReceiptNo1=88004, CusReceiptDate1=day, CusMemUpAmt1=100, CusReceiptNote1="PATRIKA FUND"),
        _row(995005, "LOCAL DRIVE", CusReceiptNo1=88005, CusReceiptDate1=day, CusMemUpAmt1=100, CusReceiptNote1="YELLAPURA ABHIYANA"),
    ]))
    db = SessionLocal()

    def lines(number):
        rec = db.query(Receipt).filter(Receipt.receipt_number == number).one()
        return sorted(((i.sub_particular_name, float(i.amount)) for i in db.query(ReceiptItem).filter(ReceiptItem.receipt_id == rec.id, ReceiptItem.is_deleted == False)), key=lambda x: str(x[0])), float(rec.net_amount)  # noqa: E712
    try:
        legacy_import.import_members(db, rows, 1, run_id="a" + s[-8:], file_name="MstMember.xlsx")
        legacy_import.import_receipts(db, rows, 1)
        assert lines("88001") == ([("Amrutha Mahotsava Abhiyana", 100.0), (None, 1000.0)], 1100.0)
        assert lines("88002") == ([("Amrutha Mahotsava Abhiyana", 100.0)], 100.0)
        assert lines("88003")[0] == [("Patrika Nidhi", 100.0)] and lines("88004")[0] == [("Patrika Nidhi", 100.0)]
        assert lines("88005")[0] == [("Amrutha Mahotsava Abhiyana", 100.0)]    # a local drive (Yellapura ...) is part of the campaign too
        # receipts imported before the rule: the helper moves the campaign amounts, once, and the totals stay
        for number in ("88001", "88002"):
            rec = db.query(Receipt).filter(Receipt.receipt_number == number).one()
            pat = db.query(ReceiptItem).filter(ReceiptItem.receipt_id == rec.id, ReceiptItem.sub_particular_name == "Amrutha Mahotsava Abhiyana").one()
            sub_pat = db.query(ReceiptItem.sub_particular_id).filter(ReceiptItem.sub_particular_name == "Patrika Nidhi").first()[0]
            pat.sub_particular_id, pat.sub_particular_name = sub_pat, "Patrika Nidhi"
        db.commit()
        out = legacy_import.retag_amrutha_receipts(db, rows, 1)
        assert out["receipts_changed"] == 2 and out["amount_moved_to_amrutha_mahotsava"] == 200.0, out
        assert lines("88001") == ([("Amrutha Mahotsava Abhiyana", 100.0), (None, 1000.0)], 1100.0)
        assert legacy_import.retag_amrutha_receipts(db, rows, 1)["receipts_changed"] == 0
    finally:
        db.close()
