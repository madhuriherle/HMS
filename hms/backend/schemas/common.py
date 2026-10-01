from typing import List, Optional

from pydantic import BaseModel


class PendingApproval(BaseModel):
    """Returned by a gated create/update/delete endpoint instead of the
    entity, when the caller's permission grant has requires_approval=True.
    Every such endpoint's response_model becomes Union[Entity, PendingApproval]
    so FastAPI's response validation accepts both shapes."""
    message: str
    approval_request_id: int
    status: str


class BulkApprovalAction(BaseModel):
    """Body for a bulk approve endpoint: act on several pending requests in
    one call. note is optional, matching the single-item approve endpoints."""
    ids: List[int]
    note: Optional[str] = None


class BulkRejectionAction(BaseModel):
    """Body for a bulk reject endpoint. note is required, matching the
    single-item reject endpoints."""
    ids: List[int]
    note: str
