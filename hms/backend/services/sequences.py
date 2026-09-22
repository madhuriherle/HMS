from datetime import date

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models.system import NumberSequence


def generate_next_number(db: Session, sequence_type: str, prefix: str = None) -> str:
    """
    Thread-safe sequence number generator using DB row locking.
    e.g. generate_next_number(db, "RECEIPT", "REC") => "REC-20260921-000001"

    The first-ever call for a sequence_type creates the row inside a savepoint,
    so two concurrent requests racing to insert it resolve to one winner and one
    retry instead of a 500 (the loser rolls back only its own INSERT).
    """

    def _locked_row():
        return (
            db.query(NumberSequence)
            .filter(
                NumberSequence.sequence_type == sequence_type,
                NumberSequence.is_deleted == False,
            )
            .with_for_update()
            .first()
        )

    seq = _locked_row()

    if not seq:
        seq = NumberSequence(
            sequence_type=sequence_type,
            prefix=prefix or sequence_type[:3],
            current_value=0,
        )
        try:
            with db.begin_nested():  # SAVEPOINT — isolates this INSERT
                db.add(seq)
                db.flush()
        except IntegrityError:
            # Someone else created it between our SELECT and INSERT.
            db.expire(seq)
            seq = _locked_row()
            if not seq:
                raise

    seq.current_value += 1
    db.commit()
    db.refresh(seq)

    today = date.today().strftime("%Y%m%d")
    pfx = seq.prefix or prefix or sequence_type[:3]
    number = f"{pfx}-{today}-{str(seq.current_value).zfill(6)}"
    return number
