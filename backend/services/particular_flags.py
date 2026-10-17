"""What a particular says about itself, read when a receipt line is saved (not guessed from its name)."""
from typing import Optional

from sqlalchemy.orm import Session

from models.masters import Particular


def main_particular(db: Session, particular_id: Optional[int]) -> Optional[Particular]:
    """The main (top-level) particular of a line: a sub type climbs to the main particular it belongs to."""
    p = db.get(Particular, particular_id) if particular_id else None
    hops = 0
    while p is not None and p.parent_id and hops < 5:
        p = db.get(Particular, p.parent_id)
        hops += 1
    return p


def line_pays_for_membership(db: Session, particular_id: Optional[int], item_type: Optional[str]) -> bool:
    """Does this receipt line pay for a membership? The main particular's tick decides. A line with no particular on
    record (an old receipt, or the upgrade difference the system raises itself) is by its line type."""
    main = main_particular(db, particular_id)
    if main is not None:
        return bool(main.pays_for_membership)
    return (item_type or "").upper() in ("MEMBERSHIP", "TYPE_CHANGE")
