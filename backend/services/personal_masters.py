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
    Qualification, NativePlace, Gotra, NameTitle,
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
    member_text_field: Optional[str] = None  # a master the member keeps as plain text (name_title): blocks delete while used


PERSONAL_MASTERS = [
    PersonalMasterSpec("qualification", "qualifications", Qualification, "qualification_id", "qualification", "Qualification", text_field="qualification_text"),
    PersonalMasterSpec("gotra", "gotras", Gotra, "gotra_id", "gotra", "Gotra", text_field="gotra_text"),
    PersonalMasterSpec(
        "native_place", "native-places", NativePlace, "native_place_id", "native_place",
        "Native place", uses_district=True, text_field="native_place_text",
    ),
]

# Masters the member keeps as text, not as an id: they get the same routes but are not part of the profile's personal masters.
TEXT_MASTERS = [
    PersonalMasterSpec("name_title", "name-titles", NameTitle, None, "name_title", "Name title", member_text_field="name_title"),
]

BY_PREFIX = {spec.route_prefix: spec for spec in PERSONAL_MASTERS}
BY_KEY = {spec.key: spec for spec in PERSONAL_MASTERS}
