"""The pincode master is rebuilt from the post office directory: village name, nearest post office, its pincode."""
from test_frontend_contract import _sfx


def test_seed_places_post_offices(client, admin_headers):
    from db.session import SessionLocal
    from models.masters import District, PostalCode, State, Taluk, Village
    from models.members import Member
    from services import pincode_seed

    assert pincode_seed.nice_name("Kota SO") == "Kota S.O" and pincode_seed.nice_name("Manur B.O") == "Manur B.O"
    db = SessionLocal()
    try:
        name = "SEED" + _sfx()[-6:]
        st = State(name_en=name, status=True)
        db.add(st)
        db.flush()
        d = District(state_id=st.id, name_en="Seedtown", status=True)
        db.add(d)
        db.flush()
        t1, t2 = Taluk(district_id=d.id, name_en="Brahmavara", status=True), Taluk(district_id=d.id, name_en="Elsewhere", status=True)
        db.add_all([t1, t2])
        db.flush()
        db.add_all([Village(state_id=st.id, district_id=d.id, taluk_id=t1.id, name_en="Kotathattu"),
                    Village(state_id=st.id, district_id=d.id, taluk_id=t2.id, name_en="Faraway")])
        old = PostalCode(pincode="576221", post_office_name="Kota S.O", state_id=st.id, district_id=d.id, taluk_id=t2.id, status=True)
        db.add(old)
        db.flush()
        m = Member(first_name_en="SeedMember", state_id=st.id, district_id=d.id, taluk_id=t2.id, pincode_id=old.id)
        db.add(m)
        db.commit()

        def row(office, pin, lat, lon):
            return {"officename": office, "pincode": pin, "district": "Seedtown", "statename": name, "latitude": lat, "longitude": lon}

        rows = [row("Kotathattu BO", "576221", "13.5219689", "74.6884700"), row("Kota SO", "576221", "13.5280000", "74.7052770"),
                row("Faraway BO", "576222", "13.0", "75.5"), row("Unknown BO", "576223", "NA", "NA")]
        import services.pincode_seed as ps
        ps.STATES = (name,)
        out = ps.seed(db, rows, apply=True)
        news = {p.post_office_name: p for p in db.query(PostalCode).filter(PostalCode.state_id == st.id, PostalCode.is_deleted == False).all()}  # noqa: E712
        assert news["Kotathattu B.O"].taluk_id == t1.id and news["Kotathattu B.O"].village_id
        assert news["Kota S.O"].taluk_id == t1.id and news["Kota S.O"].village_id is None      # not a village name: the nearest post office
        assert news["Faraway B.O"].taluk_id == t2.id
        assert news["Unknown B.O"].taluk_id is None and out["stats"]["no taluk (for the office)"] == 1
        db.refresh(old), db.refresh(m)
        assert old.is_deleted and m.pincode_id == news["Kota S.O"].id and m.taluk_id == t1.id    # the member follows the new row of the same name
    finally:
        db.close()
