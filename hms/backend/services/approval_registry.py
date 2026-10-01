"""Registry of endpoint functions a generic ApprovalRequest can replay.

Each gated mutating endpoint registers itself once, at import time, via the
@approval_gate.gated(...) decorator. On approval, get() looks the entry up
by (module, action, entity_type) and rebuild_kwargs() reconstructs the
originally-submitted arguments (using the function's own type annotations,
so pydantic body params come back as real model instances) so the caller
can re-invoke fn directly with the original requester's identity — the
exact function the direct API call would have run, so there is nothing to
keep in sync separately.
"""

import inspect
from dataclasses import dataclass
from typing import Any, Callable, Dict, Optional, Tuple

from pydantic import BaseModel


@dataclass
class RegisteredAction:
    fn: Callable[..., Any]
    sig: inspect.Signature


_REGISTRY: Dict[Tuple[str, str, str], RegisteredAction] = {}


def register(module: str, action: str, entity_type: str, fn: Callable[..., Any], sig: inspect.Signature) -> None:
    _REGISTRY[(module, action, entity_type)] = RegisteredAction(fn, sig)


def get(module: str, action: str, entity_type: str) -> Optional[RegisteredAction]:
    return _REGISTRY.get((module, action, entity_type))


def rebuild_kwargs(action: RegisteredAction, payload: Optional[dict]) -> Dict[str, Any]:
    """Turn a stored payload dict back into real kwargs for action.fn,
    reconstructing any BaseModel-typed parameter from its plain dict form."""
    kwargs: Dict[str, Any] = {}
    for name, value in (payload or {}).items():
        param = action.sig.parameters.get(name)
        ann = param.annotation if param is not None else None
        if isinstance(ann, type) and issubclass(ann, BaseModel) and isinstance(value, dict):
            kwargs[name] = ann(**value)
        else:
            kwargs[name] = value
    return kwargs
