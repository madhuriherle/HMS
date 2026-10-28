"""Replacing the location masters keeps every member and pincode attached to its place."""
from test_frontend_contract import API, _sfx


def test_replace_state_renames_in_place_and_keeps_links(client, admin_headers):
    from db.session import SessionLocal
    from models.masters import District, PostalCode, State, Taluk, Village
    from models.members import Member
    from services import location_replace

    s = _sfx()
    name = "TESTLAND" + s[-5:]
    db = SessionLocal()
    try:
        st = State(name_en=name, status=True)
        db.add(st)
        db.flush()
        d_old = District(state_id=st.id, name_en="BENGALURU", status=True)
        d_junk = District(state_id=st.id, name_en="test", status=True)
        db.add_all([d_old, d_junk])
        db.flush()
        t_north = Taluk(district_id=d_old.id, name_en="BANGALORE NORTH", status=True)
        t_hospet = Taluk(district_id=d_old.id, name_en="HOSPET", status=True)      # moves to a new district
        t_lost = Taluk(district_id=d_old.id, name_en="NO SUCH PLACE", status=True)   # no equivalent, but used
        t_unused = Taluk(district_id=d_old.id, name_en="UNUSED OLD", status=True)
        db.add_all([t_north, t_hospet, t_lost, t_unused])
        db.flush()
        pin = PostalCode(pincode="560001", post_office_name="Test PO", state_id=st.id, district_id=d_old.id, taluk_id=t_north.id, status=True)
        db.add(pin)
        m = Member(first_name_en="Loc", state_id=st.id, district_id=d_old.id, taluk_id=t_north.id)
        m2 = Member(first_name_en="Loc2", state_id=st.id, district_id=d_old.id, taluk_id=t_hospet.id)
        m3 = Member(first_name_en="Loc3", state_id=st.id, district_id=d_old.id, taluk_id=t_lost.id)
        db.add_all([m, m2, m3])
        db.commit()
        data = {
            "districts": [("1", "Bengaluru Urban", "ಬೆಂಗಳೂರು ನಗರ"), ("2", "Vijayanagara", "ವಿಜಯನಗರ")],
            "taluks": [("11", "Bengaluru North", "ಬೆಂಗಳೂರು ಉತ್ತರ", "Bengaluru Urban"), ("12", "Yelahanka", "ಯಲಹಂಕ", "Bengaluru Urban"),
                       ("21", "Hosapete", "ಹೊಸಪೇಟೆ", "Vijayanagara")],
            "villages": [("901", "Adagal", "", "Bengaluru Urban", "Bengaluru North"), ("902", "Nowhere", "", "Bengaluru Urban", "Not A Taluk")],
        }
        dry = location_replace.replace_state(db, name, data, 1, apply=False)
        assert db.query(District).filter(District.state_id == st.id, District.name_en == "Vijayanagara").count() == 0      # a dry run saves nothing
        report = location_replace.replace_state(db, name, data, 1, apply=True)
        for obj in (d_old, d_junk, t_north, t_hospet, t_lost, t_unused, pin, m, m2, m3):
            db.refresh(obj)
        # renamed in place: the same records, the new spelling, Kannada name and code
        assert d_old.name_en == "Bengaluru Urban" and d_old.name_kn and d_old.code == "1"
        assert t_north.name_en == "Bengaluru North" and t_north.name_kn and t_north.code == "11"
        assert d_junk.is_deleted is True
        # the moved taluk goes to its new district and takes its members with it
        new_d = db.query(District).filter(District.state_id == st.id, District.name_en == "Vijayanagara").one()
        assert t_hospet.name_en == "Hosapete" and t_hospet.district_id == new_d.id and m2.district_id == new_d.id and m2.taluk_id == t_hospet.id
        # links kept
        assert m.taluk_id == t_north.id and pin.taluk_id == t_north.id and m.district_id == d_old.id
        # a taluk with no equivalent that is used stays (inactive); an unused one goes; a new one is added
        assert t_lost.is_deleted is False and t_lost.status is False and m3.taluk_id == t_lost.id
        assert t_unused.is_deleted is True
        assert db.query(Taluk).filter(Taluk.district_id == d_old.id, Taluk.name_en == "Yelahanka", Taluk.is_deleted == False).count() == 1  # noqa: E712
        assert report["villages added"] == ["1"] and report["villages without a taluk in the master"] == ["1"]
        assert db.query(Village).filter(Village.taluk_id == t_north.id, Village.name_en == "Adagal").count() == 1
        # again: nothing changes
        again = location_replace.replace_state(db, name, data, 1, apply=True)
        assert again["villages added"] == ["0"] and "taluks added" not in again
    finally:
        db.close()
