"""@gated(...): decorator for a mutating (create/update/delete) endpoint.

Usage — two small changes to an existing endpoint, no body rewrite:

    @router.post("/states", response_model=Union[schemas_masters.State, PendingApproval])
    @approval_gate.gated("masters", "CREATE", "State", "masters.write")
    def create_state(*, db=Depends(get_db), current_user=Depends(require_permission("masters.write")), state_in: StateCreate) -> Any:
        ...unchanged body...

When the caller's grant of `permission_code` has requires_approval=True
(api.deps.permission_requires_approval), every keyword argument except db
and current_user is captured (pydantic models via model_dump) into a
pending ApprovalRequest instead of running the function, and a
PendingApproval-shaped dict is returned. Otherwise the function runs
exactly as before. On approval, services.approval_registry.rebuild_kwargs
reconstructs the same kwargs and the SAME function is called again, as the
original requester — see approve_generic_request in api/v1/endpoints/approvals.py.
"""

import functools
import inspect
from typing import Any, Callable, Optional

from pydantic import BaseModel

import api.deps as deps
from services import approval_registry


def _serialize_kwarg(value: Any, action: str) -> Any:
    if isinstance(value, BaseModel):
        # UPDATE bodies use exclude_unset so a partial patch replays as the
        # same partial patch, not a full overwrite of untouched fields.
        return value.model_dump(mode="json", exclude_unset=(action == "UPDATE"))
    return value


def _build_payload(kwargs: dict, action: str) -> dict:
    return {
        name: _serialize_kwarg(value, action)
        for name, value in kwargs.items()
        if name not in ("db", "current_user", "dry_run")
    }


def _file_request(db, current_user, module: str, action: str, entity_type: str, permission_code: str, kwargs: dict, id_param: Optional[str], warning: Optional[str] = None) -> dict:
    from models.approval_requests import ApprovalRequest
    from services.approval_notify import notify_approvers

    entity_id = kwargs.get(id_param) if id_param else None
    previous = None
    if action in ("UPDATE", "DELETE") and entity_id:
        try:
            from models.base import Base
            from core.pagination import _to_plain
            model_cls = Base.registry._class_registry.get(entity_type)
            if model_cls and hasattr(model_cls, "id"):
                existing = db.query(model_cls).filter(model_cls.id == entity_id).first()
                if existing:
                    previous = _to_plain(existing, {"created_at", "updated_at", "created_by", "updated_by", "is_deleted"})
        except Exception:
            pass

    req = ApprovalRequest(
        module=module, action=action, entity_type=entity_type,
        entity_id=entity_id,
        permission_code=permission_code,
        payload={
            **_build_payload(kwargs, action),
            **({"_warning": warning} if warning else {}),
            **({"_previous": previous} if previous else {}),
        },
        requested_by=current_user.id,
        status="PENDING", created_by=current_user.id,
    )
    db.add(req)
    db.commit()
    db.refresh(req)
    notify_approvers(
        db,
        title=f"Approval needed: {action.title()} {entity_type}",
        body=f"{current_user.name} requested to {action.lower()} a {entity_type} ({permission_code})." + (f" Warning: {warning}" if warning else ""),
        data={"approval_request_id": req.id, "module": module, "action": action, "entity_type": entity_type},
    )
    return {
        "message": f"Submitted for approval ({permission_code})",
        "approval_request_id": req.id,
        "status": "PENDING",
    }


def _precheck(fn: Callable[..., Any], sig: inspect.Signature, action: str, kwargs: dict) -> Optional[str]:
    """For a DELETE that needs approval: ask the endpoint (dry_run, nothing is changed) whether the
    record is in use. Not forced -> the 409 goes back to the requester; forced -> the warning text
    is returned so the approver can see what the requester agreed to."""
    if action != "DELETE" or "dry_run" not in sig.parameters or inspect.iscoroutinefunction(fn):
        return None
    from core.exceptions import InUseError
    try:
        fn(**{**kwargs, "dry_run": True, "force": False})
    except InUseError as exc:
        if kwargs.get("force"):
            return str(exc.detail)
        raise
    return None


def gated(module: str, action: str, entity_type: str, permission_code: str, *, id_param: Optional[str] = "id"):
    """fn may be sync or async — the wrapper matches, since FastAPI decides
    whether to run a route in the event loop or a threadpool by inspecting
    the registered callable itself (not what it wraps)."""
    def decorator(fn: Callable[..., Any]) -> Callable[..., Any]:
        sig = inspect.signature(fn)
        approval_registry.register(module, action, entity_type, fn, sig)

        if inspect.iscoroutinefunction(fn):
            @functools.wraps(fn)
            async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
                db = kwargs.get("db")
                current_user = kwargs.get("current_user")
                if db is None or current_user is None or not deps.permission_requires_approval(db, current_user, permission_code):
                    return await fn(*args, **kwargs)
                return _file_request(db, current_user, module, action, entity_type, permission_code, kwargs, id_param)
            return async_wrapper

        @functools.wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            db = kwargs.get("db")
            current_user = kwargs.get("current_user")
            if db is None or current_user is None or not deps.permission_requires_approval(db, current_user, permission_code):
                return fn(*args, **kwargs)
            warning = _precheck(fn, sig, action, kwargs)
            return _file_request(db, current_user, module, action, entity_type, permission_code, kwargs, id_param, warning)
        return wrapper
    return decorator
