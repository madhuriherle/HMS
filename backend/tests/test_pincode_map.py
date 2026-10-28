"""A pincode points at the village its post office is named after, and takes that village's taluk."""
from test_frontend_contract import _sfx


def test_pincodes_follow_their_village(client, admin_headers):
    from db.session import SessionLocal
    from models.masters import District, PostalCode, State, Taluk, Village
    from models.members import Member
    from services import pincode_map

    assert pincode_map.post_office_key("Kukkujadka B.O") == "kukkujadka"
    assert pincode_map.post_office_key("Malleshwaram S.O") == "malleshwaram"
    assert pincode_map.post_office_key("Sulya H.O") == "sulya"
    db = SessionLocal()
    try:
        st = State(name_en="PM" + _sfx()[-6:], status=True)
        db.add(st)
        db.flush()
        d = District(state_id=st.id, name_en="Dist", status=True)
        db.add(d)
        db.flush()
        t_old, t_new, t_other = (Taluk(district_id=d.id, name_en=n, status=True) for n in ("Old", "New", "Other"))
        db.add_all([t_old, t_new, t_other])
        db.flush()
        db.add_all([Village(state_id=st.id, district_id=d.id, taluk_id=t_new.id, name_en="Kukkujadka"),
                    Village(state_id=st.id, district_id=d.id, taluk_id=t_old.id, name_en="Samename"),
                    Village(state_id=st.id, district_id=d.id, taluk_id=t_other.id, name_en="Samename"),
                    Village(state_id=st.id, district_id=d.id, taluk_id=t_other.id, name_en="Twice"),
                    Village(state_id=st.id, district_id=d.id, taluk_id=t_new.id, name_en="Twice")])
        a = PostalCode(pincode="574001", post_office_name="Kukkujadka B.O", state_id=st.id, district_id=d.id, taluk_id=t_old.id, status=True)
        b = PostalCode(pincode="574002", post_office_name="Samename B.O", state_id=st.id, district_id=d.id, taluk_id=t_old.id, status=True)
        c = PostalCode(pincode="574003", post_office_name="Twice B.O", state_id=st.id, district_id=d.id, taluk_id=t_old.id, status=True)
        e = PostalCode(pincode="574004", post_office_name="Nothing like it S.O", state_id=st.id, district_id=d.id, taluk_id=t_old.id, status=True)
        f = PostalCode(pincode="574001", post_office_name="Town S.O", state_id=st.id, district_id=d.id, taluk_id=t_other.id, status=True)   # same pincode as a
        db.add_all([a, b, c, e, f])
        db.flush()
        m = Member(first_name_en="PinMember", state_id=st.id, district_id=d.id, taluk_id=t_old.id, pincode_id=a.id)
        db.add(m)
        db.commit()
        out = pincode_map.map_pincodes(db, apply=False)
        db.refresh(a)
        assert a.village_id is None and a.taluk_id == t_old.id            # a dry run saves nothing
        out = pincode_map.map_pincodes(db, apply=True)
        for o in (a, b, c, e, m):
            db.refresh(o)
        assert a.village_id is not None and a.taluk_id == t_new.id and m.taluk_id == t_new.id      # one village: its taluk, members follow
        assert b.village_id is not None and b.taluk_id == t_old.id                                   # two villages, one in its taluk: keeps it
        assert c.village_id is None and c.taluk_id == t_old.id and ("574003", "Twice B.O", 2) in out["review"]   # ambiguous: left
        assert e.village_id is None and e.taluk_id == t_old.id                                       # no village of that name: left
        db.refresh(f)
        assert f.village_id is None and f.taluk_id == t_new.id                                       # unknown to the village list: follows its pincode
        again = pincode_map.map_pincodes(db, apply=True)
        assert again["pointed at a village (taluk changed)"] == 0
    finally:
        db.close()
