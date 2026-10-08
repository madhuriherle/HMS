"""Single source of truth for the personal-master lookups that live on
Member (qualification, gotra, native place).

The other horoscope masters (nakshatra, rashi, masa, mithi, samvathsara) were
removed in migration 0014 — Mangalya/matrimony owns that data. Gotra stays: the
Sabha's own member register records it.

Shared by api/v1/endpoints/masters.py (the CRUD routes + delete in-use
guard) and api/v1/endpoints/members.py (create/update validation + profile
resolution) so adding, renaming or reclassifying one of these only means
editing PERSONAL_MASTERS here — nothing drifts between the two call sites.
"""

from dataclasses import dataclass
from typing import Optional, Type

from models.masters import (
    Qualification, NativePlace, Gotra,
)


@dataclass(frozen=True)
class PersonalMasterSpec:
    key: str                       # dict key in the profile's personal_masters block, e.g. "gotra"
    route_prefix: str              # masters.py URL prefix, e.g. "gotras"
    model: Type                    # SQLAlchemy model, e.g. Gothra
    member_field: str              # Member column holding the FK, e.g. "gotra_id"
    crud_attr: str                 # attribute name on crud.masters, e.g. "gothra"
    label: str                     # human label for error messages, e.g. "Gotra"
    uses_district: bool = False    # only NativePlace filters/validates by district
    text_field: Optional[str] = None  # free-text fallback column, e.g. "native_place_text"


PERSONAL_MASTERS = [
    PersonalMasterSpec("qualification", "qualifications", Qualification, "qualification_id", "qualification", "Qualification", text_field="qualification_text"),
    PersonalMasterSpec("gotra", "gotras", Gotra, "gotra_id", "gotra", "Gotra", text_field="gotra_text"),
    PersonalMasterSpec(
        "native_place", "native-places", NativePlace, "native_place_id", "native_place",
        "Native place", uses_district=True, text_field="native_place_text",
    ),
]

BY_PREFIX = {spec.route_prefix: spec for spec in PERSONAL_MASTERS}
BY_KEY = {spec.key: spec for spec in PERSONAL_MASTERS}
