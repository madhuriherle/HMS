"""Old-font Kannada words are learned from the members and used for the applicants."""
from datetime import datetime

from test_legacy_members import _create_membership_type, _register, _row
from test_frontend_contract import _sfx


def test_kannada_words_for_applicants(client, admin_headers):
    from db.session import SessionLocal
    from models.masters import Particular
    from models.members import Member
    from services import legacy_import

    s = _sfx()
    _create_membership_type(client, admin_headers, "KW" + s[-5:], "Ajeeva")
    old = [{"CusNo": 1, "CusNameKannada": "AAA BBB"}, {"CusNo": 2, "CusNameKannada": "AAA CCC"}]
    uni = [{"CusNo": 1, "CusNameKannada": "ಅ ಬ"}, {"CusNo": 2, "CusNameKannada": "ಅ ಕ"}]
    words, conflicts = legacy_import.learn_kannada_words(old, uni)
    assert words == {"AAA": "ಅ", "BBB": "ಬ", "CCC": "ಕ"} and not conflicts
    rows = legacy_import.read_register(_register([
        _row(960001, "KNOWN ONE", CusNameKannada="AAA BBB"),
        _row(960002, "UNKNOWN TWO", CusNameKannada="AAA ZZZ"),
    ]))
    db = SessionLocal()
    try:
        if not db.query(Particular).filter(Particular.name_en == "Membership", Particular.parent_id.is_(None), Particular.is_deleted == False).first():  # noqa: E712
            db.add(Particular(code="RT-" + s[-6:], name_en="Membership", status=True, pays_for_membership=True))
            db.commit()
        legacy_import.import_members(db, rows, 1, run_id="k" + s[-8:], applicants=True)
        out = legacy_import.backfill_applicant_kannada(db, rows, words)
        assert out["converted"] == 1 and out["left_blank"] == 1 and out["left"][0]["unknown_words"] == ["ZZZ"]
        one = db.query(Member).filter(Member.legacy_ref_number == "960001").one()
        two = db.query(Member).filter(Member.legacy_ref_number == "960002").one()
        assert one.full_name_kn == "ಅ ಬ" and two.full_name_kn is None
    finally:
        db.close()
