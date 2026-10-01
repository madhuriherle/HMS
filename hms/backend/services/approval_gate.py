"""@gated(...): decorator for a mutating (create/update/delete) endpoint.

Usage — two small changes to an existing endpoint, no body rewrite:

    @router.post("/states", response_model=Union[schemas_masters.State, PendingApproval])
    @approval_gate.gated("masters", "CREATE", "State", "masters.create")
    def create_state(*, db=Depends(get_db), current_user=Depends(require_permission("masters.create")), state_in: StateCreate) -> Any:
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
        if name not in ("db", "current_user")
    }


def _file_request(db, current_user, module: str, action: str, entity_type: str, permission_code: str, kwargs: dict, id_param: Optional[str]) -> dict:
    from models.approval_requests import ApprovalRequest
    from services.approval_notify import notify_approvers

    req = ApprovalRequest(
        module=module, action=action, entity_type=entity_type,
        entity_id=kwargs.get(id_param) if id_param else None,
        permission_code=permission_code,
        payload=_build_payload(kwargs, action), requested_by=current_user.id,
        status="PENDING", created_by=current_user.id,
    )
    db.add(req)
    db.commit()
    db.refresh(req)
    notify_approvers(
        db,
        title=f"Approval needed: {action.title()} {entity_type}",
        body=f"{current_user.name} requested to {action.lower()} a {entity_type} ({permission_code}).",
        data={"approval_request_id": req.id, "module": module, "action": action, "entity_type": entity_type},
    )
    return {
        "message": f"Submitted for approval ({permission_code})",
        "approval_request_id": req.id,
        "status": "PENDING",
    }


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
            return _file_request(db, current_user, module, action, entity_type, permission_code, kwargs, id_param)
        return wrapper
    return decorator
