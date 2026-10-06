
from typing import Any, Optional, Union

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from api import deps
from core.pagination import paginate
from crud import masters as crud_masters
from crud.base import CRUDBase
from models.users import User
from schemas import masters as schemas_masters
from schemas.common import PendingApproval
from services import approval_gate
from services.personal_masters import PERSONAL_MASTERS as _PERSONAL_MASTERS, PersonalMasterSpec as _PersonalMasterSpec
from .common import ensure_district

router = APIRouter()



def _personal_master_crud(spec: _PersonalMasterSpec) -> CRUDBase:
    return getattr(crud_masters, spec.crud_attr)


def _dup_check(db: Session, spec: _PersonalMasterSpec, name_en: str, exclude_id: Optional[int] = None):
    q = db.query(spec.model).filter(
        spec.model.name_en == name_en,
        spec.model.is_deleted == False,  # noqa: E712
    )
    if exclude_id is not None:
        q = q.filter(spec.model.id != exclude_id)
    if q.first():
        raise HTTPException(409, f"{spec.label} '{name_en}' already exists")


@router.get("/personal-masters")
def read_personal_masters_overview(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """One-shot list of every personal master with its row count — handy for
    building the profile form's dropdowns in a single request."""
    overview = {}
    for spec in _PERSONAL_MASTERS:
        overview[spec.route_prefix.replace("-", "_")] = {
            "label": spec.label,
            "count": db.query(spec.model).filter(spec.model.is_deleted == False).count(),  # noqa: E712
        }
    return overview


for _spec in _PERSONAL_MASTERS:
    _crud = _personal_master_crud(_spec)
    _resp = schemas_masters.NativePlace if _spec.uses_district else schemas_masters.PersonalMaster

    def _make_list(_spec=_spec):
        def read_personal_master(
            db: Session = Depends(deps.get_db),
            current_user: User = Depends(deps.get_current_user),
            district_id: Optional[int] = None,
            search: Optional[str] = None,
            status: Optional[bool] = None,
            page: int = 1,
            limit: int = 100,
        ) -> Any:
            q = db.query(_spec.model).filter(_spec.model.is_deleted == False)  # noqa: E712
            if _spec.uses_district and district_id:
                q = q.filter(_spec.model.district_id == district_id)
            if search:
                q = q.filter(_spec.model.name_en.ilike(f"%{search}%"))
            if status is not None:
                q = q.filter(_spec.model.status == status)
            return paginate(q, page, limit)

        read_personal_master.__name__ = f"read_{_spec.route_prefix.replace('-', '_')}"
        return read_personal_master

    router.get(f"/{_spec.route_prefix}")( _make_list())

    def _make_get(_spec=_spec, _crud=_crud):
        def read_personal_master_item(
            *,
            db: Session = Depends(deps.get_db),
            current_user: User = Depends(deps.get_current_user),
            id: int,
        ) -> Any:
            obj = _crud.get(db, id)
            if not obj:
                raise HTTPException(404, f"{_spec.label} not found")
            return obj

        read_personal_master_item.__name__ = f"read_{_spec.route_prefix.replace('-', '_')}_item"
        return read_personal_master_item

    router.get(f"/{_spec.route_prefix}/{{id}}", response_model=_resp)(_make_get())

    def _make_create(_spec=_spec, _crud=_crud):
        def create_personal_master(
            *,
            db: Session = Depends(deps.get_db),
            current_user: User = Depends(deps.require_permission("masters.write")),
            obj_in: schemas_masters.NativePlaceCreate if _spec.uses_district else schemas_masters.PersonalMasterCreate,
        ) -> Any:
            _dup_check(db, _spec, obj_in.name_en)
            if _spec.uses_district and obj_in.district_id:
                ensure_district(db, obj_in.district_id)
            return _crud.create(db=db, obj_in=obj_in, created_by=current_user.id)

        create_personal_master.__name__ = f"create_{_spec.route_prefix.replace('-', '_')}"
        return approval_gate.gated("masters", "CREATE", _spec.label, "masters.write")(create_personal_master)

    router.post(f"/{_spec.route_prefix}", response_model=Union[_resp, PendingApproval], status_code=201)(_make_create())

    def _make_update(_spec=_spec, _crud=_crud):
        def update_personal_master(
            *,
            db: Session = Depends(deps.get_db),
            current_user: User = Depends(deps.require_permission("masters.write")),
            id: int,
            obj_in: schemas_masters.NativePlaceUpdate if _spec.uses_district else schemas_masters.PersonalMasterUpdate,
        ) -> Any:
            obj = _crud.get(db, id)
            if not obj:
                raise HTTPException(404, f"{_spec.label} not found")
            data = obj_in.model_dump(exclude_unset=True)
            if "name_en" in data and data["name_en"] != obj.name_en:
                _dup_check(db, _spec, data["name_en"], exclude_id=id)
            if _spec.uses_district and data.get("district_id"):
                ensure_district(db, data["district_id"])
            return _crud.update(db, db_obj=obj, obj_in=obj_in, updated_by=current_user.id)

        update_personal_master.__name__ = f"update_{_spec.route_prefix.replace('-', '_')}"
        return approval_gate.gated("masters", "UPDATE", _spec.label, "masters.write")(update_personal_master)

    router.put(f"/{_spec.route_prefix}/{{id}}", response_model=Union[_resp, PendingApproval])(_make_update())

    def _make_delete(_spec=_spec, _crud=_crud):
        def delete_personal_master(
            *,
            db: Session = Depends(deps.get_db),
            current_user: User = Depends(deps.require_permission("masters.delete")),
            id: int,
        ) -> Any:
            obj = _crud.get(db, id)
            if not obj:
                raise HTTPException(404, f"{_spec.label} not found")
            # Block deletion while members reference this master.
            fk_name = _spec.member_field
            if fk_name:
                from models.members import Member
                col = getattr(Member, fk_name)
                if db.query(Member).filter(
                    col == id, Member.is_deleted == False  # noqa: E712
                ).first():
                    raise HTTPException(409, f"{_spec.label} is assigned to members and cannot be deleted")
            return _crud.remove(db, id=id, deleted_by=current_user.id)

        delete_personal_master.__name__ = f"delete_{_spec.route_prefix.replace('-', '_')}"
        return approval_gate.gated("masters", "DELETE", _spec.label, "masters.delete")(delete_personal_master)

    router.delete(f"/{_spec.route_prefix}/{{id}}", response_model=Union[_resp, PendingApproval])(_make_delete())
