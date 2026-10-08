
from typing import Any, Union

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from api import deps
from core.pagination import paginate
from crud import masters as crud_masters
from models.masters import DocumentType
from models.users import User
from schemas import masters as schemas_masters
from schemas.common import PendingApproval
from services import approval_gate

router = APIRouter()

# ─────────────── DOCUMENT TYPES ────────────────
@router.get("/document-types")
def read_document_types(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    page: int = 1,
    limit: int = 100,
) -> Any:
    return paginate(
        db.query(DocumentType).filter(DocumentType.is_deleted == False),  # noqa: E712
        page, limit,
    )


@router.post("/document-types", response_model=Union[schemas_masters.DocumentType, PendingApproval])
@approval_gate.gated("masters", "CREATE", "DocumentType", "masters.write")
def create_document_type(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    dt_in: schemas_masters.DocumentTypeCreate,
) -> Any:
    dup = db.query(DocumentType).filter(
        DocumentType.code == dt_in.code, DocumentType.is_deleted == False  # noqa: E712
    ).first()
    if dup:
        raise HTTPException(409, f"Document type code '{dt_in.code}' already exists")
    return crud_masters.document_type.create(db=db, obj_in=dt_in, created_by=current_user.id)



@router.get("/document-types/{id}", response_model=schemas_masters.DocumentType)
def read_document_type(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user), id: int) -> Any:
    obj = db.query(DocumentType).filter(DocumentType.id == id, DocumentType.is_deleted == False).first()
    if not obj: raise HTTPException(404, "Document type not found")
    return obj

@router.put("/document-types/{id}", response_model=Union[schemas_masters.DocumentType, PendingApproval])
@approval_gate.gated("masters", "UPDATE", "DocumentType", "masters.write")
def update_document_type(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    id: int,
    dt_in: schemas_masters.DocumentTypeUpdate,
) -> Any:
    obj = crud_masters.document_type.get(db, id)
    if not obj:
        raise HTTPException(404, "Document type not found")
    return crud_masters.document_type.update(db, db_obj=obj, obj_in=dt_in, updated_by=current_user.id)


@router.delete("/document-types/{id}", response_model=Union[schemas_masters.DocumentType, PendingApproval])
@approval_gate.gated("masters", "DELETE", "DocumentType", "masters.delete")
def delete_document_type(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.delete")),
    id: int,
) -> Any:
    from models.members import MemberDocument
    obj = crud_masters.document_type.get(db, id)
    if not obj:
        raise HTTPException(404, "Document type not found")
    in_use = db.query(MemberDocument).filter(
        MemberDocument.document_type_id == id,
        MemberDocument.is_deleted == False,  # noqa: E712
    ).first()
    if in_use:
        raise HTTPException(409, "Document type is used by member documents and cannot be deleted")
    return crud_masters.document_type.remove(db, id=id, deleted_by=current_user.id)
