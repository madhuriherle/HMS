from typing import Any, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from api import deps
from models.users import User
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

@router.post("/affiliations", response_model=schemas_engagements.Affiliation)
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

@router.post("/associates", response_model=schemas_engagements.Associate)
def create_associate(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("engagements.write")), name: str, organization: str = None, mobile: str = None, email: str = None, address: str = None, magazine_enabled: bool = True) -> Any:
    obj = Associate(name=name, organization=organization, mobile=mobile, email=email, address=address, magazine_enabled=magazine_enabled, created_by=current_user.id)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj

@router.put("/associates/{id}", response_model=schemas_engagements.Associate)
def update_associate(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("engagements.write")), id: int, magazine_enabled: Optional[bool] = None) -> Any:
    obj = db.query(Associate).filter(Associate.id == id).first()
    if not obj: raise HTTPException(404, "Associate not found")
    if magazine_enabled is not None: obj.magazine_enabled = magazine_enabled
    obj.updated_by = current_user.id
    db.commit()
    return obj

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

@router.post("/press-media", response_model=schemas_engagements.PressMedia)
def create_press_media(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("engagements.write")), organization_name: str, reporter_name: str = None, mobile: str = None, email: str = None, address: str = None, magazine_enabled: bool = True) -> Any:
    obj = PressMedia(organization_name=organization_name, reporter_name=reporter_name, mobile=mobile, email=email, address=address, magazine_enabled=magazine_enabled, created_by=current_user.id)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj

@router.put("/press-media/{id}", response_model=schemas_engagements.PressMedia)
def update_press_media(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("engagements.write")), id: int, magazine_enabled: Optional[bool] = None) -> Any:
    obj = db.query(PressMedia).filter(PressMedia.id == id).first()
    if not obj: raise HTTPException(404, "Press/Media not found")
    if magazine_enabled is not None: obj.magazine_enabled = magazine_enabled
    obj.updated_by = current_user.id
    db.commit()
    return obj

@router.delete("/press-media/{id}")
def delete_press_media(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("engagements.write")), id: int) -> Any:
    obj = db.query(PressMedia).filter(PressMedia.id == id).first()
    if not obj: raise HTTPException(404, "Press/Media not found")
    obj.is_deleted = True; obj.deleted_by = current_user.id
    db.commit()
    return {"message": "Deleted"}

# ─── COMMITTEE ────────────────────────────────────────────
@router.get("/committee/categories")
def read_committee_categories(db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user), page: int = 1, limit: int = 100) -> Any:
    return paginate(db.query(CommitteeCategory).filter(CommitteeCategory.is_deleted == False), page, limit)

@router.post("/committee/categories", response_model=schemas_engagements.CommitteeCategory)
def create_committee_category(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("engagements.write")), name_en: str, name_kn: str = None, display_on_website: bool = True) -> Any:
    obj = CommitteeCategory(name_en=name_en, name_kn=name_kn, display_on_website=display_on_website, created_by=current_user.id)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj

@router.put("/committee/categories/{id}", response_model=schemas_engagements.CommitteeCategory)
def update_committee_category(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("engagements.write")), id: int, display_on_website: Optional[bool] = None, name_en: Optional[str] = None) -> Any:
    obj = db.query(CommitteeCategory).filter(CommitteeCategory.id == id).first()
    if not obj: raise HTTPException(404, "Category not found")
    if display_on_website is not None: obj.display_on_website = display_on_website
    if name_en: obj.name_en = name_en
    obj.updated_by = current_user.id
    db.commit()
    return obj

@router.get("/committee/members")
def read_committee_members(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    category_id: Optional[int] = None,
    term_id: Optional[int] = None,
    page: int = 1, limit: int = 50
) -> Any:
    q = db.query(CommitteeMember).filter(CommitteeMember.is_deleted == False)
    if category_id: q = q.filter(CommitteeMember.category_id == category_id)
    if term_id: q = q.filter(CommitteeMember.term_id == term_id)
    return paginate(q, page, limit)

@router.post("/committee/members", response_model=schemas_engagements.CommitteeMember)
def create_committee_member(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("engagements.write")), category_id: int, member_name: str, designation: str = None, subcategory_id: int = None, term_id: int = None, hms_member_id: int = None, display_on_website: bool = True) -> Any:
    obj = CommitteeMember(category_id=category_id, subcategory_id=subcategory_id, term_id=term_id, member_name=member_name, designation=designation, display_on_website=display_on_website, created_by=current_user.id)
    db.add(obj)
    db.flush()
    if hms_member_id:
        link = CommitteeMemberLink(committee_member_id=obj.id, hms_member_id=hms_member_id, created_by=current_user.id)
        db.add(link)
    db.commit()
    db.refresh(obj)
    return obj

@router.get("/committee/terms")
def read_committee_terms(db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user), page: int = 1, limit: int = 100) -> Any:
    return paginate(db.query(CommitteeTerm).filter(CommitteeTerm.is_deleted == False), page, limit)

@router.post("/committee/terms", response_model=schemas_engagements.CommitteeTerm)
def create_committee_term(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("engagements.write")), term_name: str, start_date: str = None, end_date: str = None, is_current: bool = False) -> Any:
    if is_current:
        db.query(CommitteeTerm).filter(CommitteeTerm.is_current == True).update({"is_current": False})
    obj = CommitteeTerm(term_name=term_name, start_date=start_date, end_date=end_date, is_current=is_current, created_by=current_user.id)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj
