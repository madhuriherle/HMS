from typing import Any, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from api import deps
from models.users import User
from models.members import Member
from models.engagements import (
    Affiliation, AffiliationContact, AffiliationMagazineSetting,
    Associate, AssociateMagazineSetting,
    PressMedia, PressMediaMagazineSetting,
    CommitteeCategory, CommitteeSubcategory, CommitteeTerm,
    CommitteeMember, CommitteeMemberLink
)
from schemas import engagements as schemas_engagements
from crud import engagements as crud_engagements
from core.pagination import paginate

router = APIRouter()

# ─── AFFILIATIONS ────────────────────────────────────────────
@router.get("/affiliations")
def read_affiliations(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    magazine_enabled: Optional[bool] = None,
    page: int = 1, limit: int = 20
) -> Any:
    q = db.query(Affiliation).filter(Affiliation.is_deleted == False)
    if magazine_enabled is not None:
        q = q.filter(Affiliation.magazine_enabled == magazine_enabled)
    return paginate(q, page, limit)

@router.post("/affiliations", response_model=schemas_engagements.Affiliation, status_code=201)
def create_affiliation(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("engagements.write")), aff_in: schemas_engagements.AffiliationCreate) -> Any:
    return crud_engagements.affiliation.create(db=db, obj_in=aff_in, created_by=current_user.id)

@router.get("/affiliations/{id}", response_model=schemas_engagements.Affiliation)
def read_affiliation(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user), id: int) -> Any:
    obj = crud_engagements.affiliation.get(db, id)
    if not obj: raise HTTPException(404, "Affiliation not found")
    return obj

@router.put("/affiliations/{id}", response_model=schemas_engagements.Affiliation)
def update_affiliation(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("engagements.write")), id: int, aff_in: schemas_engagements.AffiliationUpdate) -> Any:
    obj = crud_engagements.affiliation.get(db, id)
    if not obj: raise HTTPException(404, "Affiliation not found")
    return crud_engagements.affiliation.update(db, db_obj=obj, obj_in=aff_in, updated_by=current_user.id)

@router.delete("/affiliations/{id}", response_model=schemas_engagements.Affiliation)
def delete_affiliation(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("engagements.write")), id: int) -> Any:
    return crud_engagements.affiliation.remove(db, id=id, deleted_by=current_user.id)

@router.get("/affiliations/{id}/contacts")
def read_affiliation_contacts(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user), id: int,
) -> Any:
    """All contact persons of an affiliate group."""
    affiliation = crud_engagements.affiliation.get(db, id)
    if not affiliation:
        raise HTTPException(404, "Affiliation not found")
    contacts = db.query(AffiliationContact).filter(
        AffiliationContact.affiliation_id == id,
        AffiliationContact.is_deleted == False,
    ).order_by(AffiliationContact.id).all()
    return {"total": len(contacts), "data": [
        {
            "id": c.id, "name": c.name, "mobile": c.mobile,
            "email": c.email, "designation": c.designation,
        } for c in contacts
    ]}

@router.post("/affiliations/{id}/contacts", response_model=schemas_engagements.AffiliationContact, status_code=201)
def add_affiliation_contact(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("engagements.write")),
    id: int, contact_in: schemas_engagements.AffiliationContactCreate,
) -> Any:
    """Add a contact person to an affiliate group."""
    affiliation = crud_engagements.affiliation.get(db, id)
    if not affiliation:
        raise HTTPException(404, "Affiliation not found")
    contact = AffiliationContact(
        affiliation_id=id,
        name=contact_in.name,
        mobile=contact_in.mobile,
        email=contact_in.email,
        designation=contact_in.designation,
        created_by=current_user.id,
    )
    db.add(contact)
    db.commit()
    db.refresh(contact)
    return contact

# ─── ASSOCIATES ────────────────────────────────────────────
@router.get("/associates")
def read_associates(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    magazine_enabled: Optional[bool] = None,
    page: int = 1, limit: int = 20
) -> Any:
    q = db.query(Associate).filter(Associate.is_deleted == False)
    if magazine_enabled is not None:
        q = q.filter(Associate.magazine_enabled == magazine_enabled)
    return paginate(q, page, limit)

@router.post("/associates", response_model=schemas_engagements.Associate, status_code=201)
def create_associate(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("engagements.write")), assoc_in: schemas_engagements.AssociateCreate) -> Any:
    """Register an associate engaged with the Mahasabha (not a member)."""
    return crud_engagements.associate.create(db=db, obj_in=assoc_in, created_by=current_user.id)

@router.put("/associates/{id}", response_model=schemas_engagements.Associate)
def update_associate(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("engagements.write")), id: int, assoc_in: schemas_engagements.AssociateUpdate) -> Any:
    """Update associate details, including the magazine delivery toggle."""
    obj = db.query(Associate).filter(Associate.id == id, Associate.is_deleted == False).first()
    if not obj: raise HTTPException(404, "Associate not found")
    return crud_engagements.associate.update(db, db_obj=obj, obj_in=assoc_in, updated_by=current_user.id)

@router.delete("/associates/{id}")
def delete_associate(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("engagements.write")), id: int) -> Any:
    obj = db.query(Associate).filter(Associate.id == id).first()
    if not obj: raise HTTPException(404, "Associate not found")
    obj.is_deleted = True; obj.deleted_by = current_user.id
    db.commit()
    return {"message": "Deleted"}

# ─── PRESS / MEDIA ────────────────────────────────────────────
@router.get("/press-media")
def read_press_media(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    magazine_enabled: Optional[bool] = None,
    page: int = 1, limit: int = 20
) -> Any:
    q = db.query(PressMedia).filter(PressMedia.is_deleted == False)
    if magazine_enabled is not None:
        q = q.filter(PressMedia.magazine_enabled == magazine_enabled)
    return paginate(q, page, limit)

@router.post("/press-media", response_model=schemas_engagements.PressMedia, status_code=201)
def create_press_media(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("engagements.write")), press_in: schemas_engagements.PressMediaCreate) -> Any:
    """Register a press/media house engaged with the Mahasabha."""
    return crud_engagements.press_media.create(db=db, obj_in=press_in, created_by=current_user.id)

@router.put("/press-media/{id}", response_model=schemas_engagements.PressMedia)
def update_press_media(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("engagements.write")), id: int, press_in: schemas_engagements.PressMediaUpdate) -> Any:
    """Update press/media details, including the magazine delivery toggle."""
    obj = db.query(PressMedia).filter(PressMedia.id == id, PressMedia.is_deleted == False).first()
    if not obj: raise HTTPException(404, "Press/Media not found")
    return crud_engagements.press_media.update(db, db_obj=obj, obj_in=press_in, updated_by=current_user.id)

@router.delete("/press-media/{id}")
def delete_press_media(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("engagements.write")), id: int) -> Any:
    obj = db.query(PressMedia).filter(PressMedia.id == id).first()
    if not obj: raise HTTPException(404, "Press/Media not found")
    obj.is_deleted = True; obj.deleted_by = current_user.id
    db.commit()
    return {"message": "Deleted"}

# ─── COMMITTEE ────────────────────────────────────────────
@router.get("/committee/categories")
def read_committee_categories(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    display_on_website: Optional[bool] = None,
    page: int = 1, limit: int = 100,
) -> Any:
    q = db.query(CommitteeCategory).filter(CommitteeCategory.is_deleted == False)
    if display_on_website is not None:
        q = q.filter(CommitteeCategory.display_on_website == display_on_website)
    return paginate(q.order_by(CommitteeCategory.id), page, limit)

@router.post("/committee/categories", response_model=schemas_engagements.CommitteeCategory, status_code=201)
def create_committee_category(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("engagements.write")),
    category_in: schemas_engagements.CommitteeCategoryCreate,
) -> Any:
    """Add a committee category, e.g. ಬೆಂಗಳೂರು ಕ್ಷೇತ್ರ, ಆಡಳಿತ ಮಂಡಳಿಯ
    ನಾಮಾಂಕಿತ ನಿರ್ದೇಶಕರು, ಶ್ರೀ ಸಿದ್ಧಿವಿನಾಯಕ ದೇವಾಲಯ (bilingual name)."""
    return crud_engagements.committee_category.create(db=db, obj_in=category_in, created_by=current_user.id)

@router.get("/committee/categories/{id}", response_model=schemas_engagements.CommitteeCategory)
def read_committee_category(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user), id: int) -> Any:
    obj = db.query(CommitteeCategory).filter(CommitteeCategory.id == id, CommitteeCategory.is_deleted == False).first()
    if not obj: raise HTTPException(404, "Category not found")
    return obj

@router.put("/committee/categories/{id}", response_model=schemas_engagements.CommitteeCategory)
def update_committee_category(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("engagements.write")),
    id: int, category_in: schemas_engagements.CommitteeCategoryUpdate,
) -> Any:
    """Rename a category or toggle its website display."""
    obj = db.query(CommitteeCategory).filter(CommitteeCategory.id == id, CommitteeCategory.is_deleted == False).first()
    if not obj: raise HTTPException(404, "Category not found")
    return crud_engagements.committee_category.update(db, db_obj=obj, obj_in=category_in, updated_by=current_user.id)

@router.delete("/committee/categories/{id}")
def delete_committee_category(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("engagements.write")),
    id: int,
) -> Any:
    obj = db.query(CommitteeCategory).filter(CommitteeCategory.id == id, CommitteeCategory.is_deleted == False).first()
    if not obj: raise HTTPException(404, "Category not found")
    used = db.query(CommitteeMember).filter(
        CommitteeMember.category_id == id, CommitteeMember.is_deleted == False
    ).count()
    if used:
        raise HTTPException(409, f"Category has {used} committee member(s); move them first")
    obj.is_deleted = True
    obj.deleted_by = current_user.id
    db.commit()
    return {"message": "Category deleted"}

@router.get("/committee/subcategories")
def read_committee_subcategories(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    category_id: Optional[int] = None,
    page: int = 1, limit: int = 100,
) -> Any:
    q = db.query(CommitteeSubcategory).filter(CommitteeSubcategory.is_deleted == False)
    if category_id:
        q = q.filter(CommitteeSubcategory.category_id == category_id)
    return paginate(q.order_by(CommitteeSubcategory.id), page, limit)

@router.post("/committee/subcategories", response_model=schemas_engagements.CommitteeSubcategory, status_code=201)
def create_committee_subcategory(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("engagements.write")),
    sub_in: schemas_engagements.CommitteeSubcategoryCreate,
) -> Any:
    """Add a sub-category under a committee category."""
    category = db.query(CommitteeCategory).filter(
        CommitteeCategory.id == sub_in.category_id, CommitteeCategory.is_deleted == False
    ).first()
    if not category:
        raise HTTPException(400, "Unknown category_id")
    return crud_engagements.committee_subcategory.create(db=db, obj_in=sub_in, created_by=current_user.id)

@router.put("/committee/subcategories/{id}", response_model=schemas_engagements.CommitteeSubcategory)
def update_committee_subcategory(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("engagements.write")),
    id: int, sub_in: schemas_engagements.CommitteeSubcategoryUpdate,
) -> Any:
    obj = db.query(CommitteeSubcategory).filter(CommitteeSubcategory.id == id, CommitteeSubcategory.is_deleted == False).first()
    if not obj: raise HTTPException(404, "Sub-category not found")
    if sub_in.category_id:
        category = db.query(CommitteeCategory).filter(
            CommitteeCategory.id == sub_in.category_id, CommitteeCategory.is_deleted == False
        ).first()
        if not category:
            raise HTTPException(400, "Unknown category_id")
    return crud_engagements.committee_subcategory.update(db, db_obj=obj, obj_in=sub_in, updated_by=current_user.id)

@router.delete("/committee/subcategories/{id}")
def delete_committee_subcategory(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("engagements.write")),
    id: int,
) -> Any:
    obj = db.query(CommitteeSubcategory).filter(CommitteeSubcategory.id == id, CommitteeSubcategory.is_deleted == False).first()
    if not obj: raise HTTPException(404, "Sub-category not found")
    used = db.query(CommitteeMember).filter(
        CommitteeMember.subcategory_id == id, CommitteeMember.is_deleted == False
    ).count()
    if used:
        raise HTTPException(409, f"Sub-category has {used} committee member(s); move them first")
    obj.is_deleted = True
    obj.deleted_by = current_user.id
    db.commit()
    return {"message": "Sub-category deleted"}


def _resolve_committee_names(db: Session, members: list) -> list:
    """Attach category/subcategory/term names and the linked Havyaka member."""
    from models.members import Member as MemberModel

    category_ids = {m.category_id for m in members}
    sub_ids = {m.subcategory_id for m in members if m.subcategory_id}
    term_ids = {m.term_id for m in members if m.term_id}
    committee_member_ids = {m.id for m in members}

    cats = {
        c.id: c
        for c in db.query(CommitteeCategory).filter(CommitteeCategory.id.in_(category_ids or {0})).all()
    }
    subs = {
        s.id: s
        for s in db.query(CommitteeSubcategory).filter(CommitteeSubcategory.id.in_(sub_ids or {0})).all()
    }
    terms = {
        t.id: t
        for t in db.query(CommitteeTerm).filter(CommitteeTerm.id.in_(term_ids or {0})).all()
    }
    links = db.query(CommitteeMemberLink).filter(
        CommitteeMemberLink.committee_member_id.in_(committee_member_ids or {0}),
        CommitteeMemberLink.is_deleted == False,
    ).all()
    link_by_committee = {l.committee_member_id: l.hms_member_id for l in links}
    hms_ids = set(link_by_committee.values())
    hms_members = {
        m.id: m
        for m in db.query(MemberModel).filter(MemberModel.id.in_(hms_ids or {0})).all()
    }

    out = []
    for m in members:
        cat = cats.get(m.category_id)
        sub = subs.get(m.subcategory_id) if m.subcategory_id else None
        term = terms.get(m.term_id) if m.term_id else None
        hms = hms_members.get(link_by_committee.get(m.id))
        out.append({
            "id": m.id,
            "category_id": m.category_id,
            "category_name_en": cat.name_en if cat else None,
            "category_name_kn": cat.name_kn if cat else None,
            "subcategory_id": m.subcategory_id,
            "subcategory_name_en": sub.name_en if sub else None,
            "subcategory_name_kn": sub.name_kn if sub else None,
            "term_id": m.term_id,
            "term_name": term.term_name if term else None,
            "member_name": m.member_name,
            "designation": m.designation,
            "display_on_website": m.display_on_website,
            "hms_member_id": link_by_committee.get(m.id),
            "hms_member_code": hms.member_code if hms else None,
            "hms_member_name": (
                " ".join(p for p in (hms.first_name_en, hms.last_name_en) if p)
                if hms else None
            ),
        })
    return out


@router.get("/committee/members")
def read_committee_members(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    category_id: Optional[int] = None,
    subcategory_id: Optional[int] = None,
    term_id: Optional[int] = None,
    current_term_only: bool = False,
    page: int = 1, limit: int = 50,
) -> Any:
    """Committee members with category/subcategory/term names resolved."""
    q = db.query(CommitteeMember).filter(CommitteeMember.is_deleted == False)
    if category_id: q = q.filter(CommitteeMember.category_id == category_id)
    if subcategory_id: q = q.filter(CommitteeMember.subcategory_id == subcategory_id)
    if term_id:
        q = q.filter(CommitteeMember.term_id == term_id)
    elif current_term_only:
        current = db.query(CommitteeTerm).filter(
            CommitteeTerm.is_current == True, CommitteeTerm.is_deleted == False
        ).first()
        if current:
            q = q.filter(CommitteeMember.term_id == current.id)
        else:
            return {"total": 0, "page": 1, "limit": limit, "pages": 0, "data": []}
    members = q.order_by(CommitteeMember.category_id, CommitteeMember.id)
    page_data = paginate(members, page, limit)
    page_data["data"] = _resolve_committee_names(db, [
        m for m in db.query(CommitteeMember).filter(
            CommitteeMember.id.in_([r["id"] for r in page_data["data"]] or {0})
        ).order_by(CommitteeMember.category_id, CommitteeMember.id).all()
    ])
    return page_data

@router.post("/committee/members", response_model=schemas_engagements.CommitteeMember, status_code=201)
def create_committee_member(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("engagements.write")),
    member_in: schemas_engagements.CommitteeMemberCreate,
) -> Any:
    """Add a current committee member under a category (+ optional subcategory
    and term). When hms_member_id is given the member is linked to a registered
    Havyaka member."""
    category = db.query(CommitteeCategory).filter(
        CommitteeCategory.id == member_in.category_id, CommitteeCategory.is_deleted == False
    ).first()
    if not category:
        raise HTTPException(400, "Unknown category_id")
    if member_in.subcategory_id:
        sub = db.query(CommitteeSubcategory).filter(
            CommitteeSubcategory.id == member_in.subcategory_id,
            CommitteeSubcategory.category_id == member_in.category_id,
            CommitteeSubcategory.is_deleted == False,
        ).first()
        if not sub:
            raise HTTPException(400, "subcategory_id does not belong to category_id")
    obj = CommitteeMember(
        category_id=member_in.category_id,
        subcategory_id=member_in.subcategory_id,
        term_id=member_in.term_id,
        member_name=member_in.member_name,
        designation=member_in.designation,
        display_on_website=member_in.display_on_website,
        created_by=current_user.id,
    )
    db.add(obj)
    db.flush()
    if member_in.hms_member_id:
        member = db.query(Member).filter(
            Member.id == member_in.hms_member_id, Member.is_deleted == False
        ).first()
        if not member:
            raise HTTPException(400, f"Havyaka member {member_in.hms_member_id} not found")
        db.add(CommitteeMemberLink(
            committee_member_id=obj.id, hms_member_id=member_in.hms_member_id,
            created_by=current_user.id,
        ))
    db.commit()
    db.refresh(obj)
    return obj

@router.put("/committee/members/{id}", response_model=schemas_engagements.CommitteeMember)
def update_committee_member(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("engagements.write")),
    id: int, member_in: schemas_engagements.CommitteeMemberUpdate,
) -> Any:
    obj = db.query(CommitteeMember).filter(CommitteeMember.id == id, CommitteeMember.is_deleted == False).first()
    if not obj: raise HTTPException(404, "Committee member not found")
    data = member_in.model_dump(exclude_unset=True)
    hms_member_id = data.pop("hms_member_id", None)
    if "category_id" in data and data["category_id"] != obj.category_id:
        category = db.query(CommitteeCategory).filter(
            CommitteeCategory.id == data["category_id"], CommitteeCategory.is_deleted == False
        ).first()
        if not category:
            raise HTTPException(400, "Unknown category_id")
    for field, value in data.items():
        setattr(obj, field, value)
    if hms_member_id is not None:
        link = db.query(CommitteeMemberLink).filter(
            CommitteeMemberLink.committee_member_id == id,
            CommitteeMemberLink.is_deleted == False,
        ).first()
        if hms_member_id == 0:
            if link:
                link.is_deleted = True
        else:
            member = db.query(Member).filter(
                Member.id == hms_member_id, Member.is_deleted == False
            ).first()
            if not member:
                raise HTTPException(400, f"Havyaka member {hms_member_id} not found")
            if link:
                link.hms_member_id = hms_member_id
            else:
                db.add(CommitteeMemberLink(
                    committee_member_id=id, hms_member_id=hms_member_id,
                    created_by=current_user.id,
                ))
    obj.updated_by = current_user.id
    db.commit()
    db.refresh(obj)
    return obj

@router.delete("/committee/members/{id}")
def delete_committee_member(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("engagements.write")),
    id: int,
) -> Any:
    obj = db.query(CommitteeMember).filter(CommitteeMember.id == id, CommitteeMember.is_deleted == False).first()
    if not obj: raise HTTPException(404, "Committee member not found")
    obj.is_deleted = True
    obj.deleted_by = current_user.id
    db.commit()
    return {"message": "Committee member removed"}

@router.get("/committee/terms")
def read_committee_terms(db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user), page: int = 1, limit: int = 100) -> Any:
    return paginate(db.query(CommitteeTerm).filter(CommitteeTerm.is_deleted == False).order_by(CommitteeTerm.id.desc()), page, limit)

@router.post("/committee/terms", response_model=schemas_engagements.CommitteeTerm, status_code=201)
def create_committee_term(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("engagements.write")), term_in: schemas_engagements.CommitteeTermCreate) -> Any:
    if term_in.is_current:
        db.query(CommitteeTerm).filter(CommitteeTerm.is_current == True).update({"is_current": False})
    return crud_engagements.committee_term.create(db=db, obj_in=term_in, created_by=current_user.id)


# ─── PUBLIC WEBSITE COMMITTEE PAGE ────────────────────────────
@router.get("/committee/website", include_in_schema=True)
def read_website_committee(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    term_id: Optional[int] = None,
) -> Any:
    """Website committee page: every display-enabled category with its
    display-enabled members (current term by default). No auth beyond login,
    no hidden categories leak."""
    term_id = term_id
    if term_id is None:
        current = db.query(CommitteeTerm).filter(
            CommitteeTerm.is_current == True, CommitteeTerm.is_deleted == False
        ).first()
        term_id = current.id if current else None

    categories = (
        db.query(CommitteeCategory)
        .filter(
            CommitteeCategory.is_deleted == False,
            CommitteeCategory.display_on_website == True,  # noqa: E712
        )
        .order_by(CommitteeCategory.id)
        .all()
    )

    data = []
    for cat in categories:
        q = db.query(CommitteeMember).filter(
            CommitteeMember.category_id == cat.id,
            CommitteeMember.is_deleted == False,
            CommitteeMember.display_on_website == True,  # noqa: E712
        )
        if term_id is not None:
            q = q.filter(CommitteeMember.term_id == term_id)
        members = q.order_by(CommitteeMember.id).all()
        data.append({
            "category_id": cat.id,
            "category_name_en": cat.name_en,
            "category_name_kn": cat.name_kn,
            "members": _resolve_committee_names(db, members),
        })
    return {"total": len(data), "data": data}
