"""Settings > Recycle Bin and Data Cleanup.

Privileges: ``system.recycle_bin.read|write`` and ``system.cleanup.read|write`` (the routes ask for
``system.read`` / ``system.write``; services.permission_areas maps them by path). Data Cleanup's module is
also limited to rank 0 roles.
"""
from typing import Any, List, Optional
from threading import Lock
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from api import deps
from models.users import User
from services import data_cleanup, recycle_bin
from db.session import SessionLocal

router = APIRouter()

_empty_jobs = {}
_empty_jobs_lock = Lock()


def _run_empty_recycle_job(job_id: str, entity: Optional[str], user_id: int) -> None:
    db = SessionLocal()
    try:
        viewer = db.get(User, user_id)
        items = recycle_bin.all_items(db, entity, viewer=viewer)
        with _empty_jobs_lock:
            _empty_jobs[job_id] = {"status": "running", "total": len(items)}
        result = recycle_bin.purge(db, items, viewer=viewer)
        with _empty_jobs_lock:
            _empty_jobs[job_id] = {"status": "completed", **result, "total": len(items)}
    except Exception as exc:  # background failures must be visible to the UI
        db.rollback()
        with _empty_jobs_lock:
            _empty_jobs[job_id] = {"status": "failed", "error": str(exc)[:300]}
    finally:
        db.close()


class BinItem(BaseModel):
    entity: str
    id: int


class BinItems(BaseModel):
    items: List[BinItem] = Field(min_length=1, max_length=500)


class BinEmpty(BaseModel):
    entity: Optional[str] = None


@router.get("/recycle-bin")
def read_recycle_bin(
    *, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("system.read")),
    search: str = "", entity: str = "", page: int = Query(1, ge=1), limit: int = Query(25, ge=1, le=200),
) -> Any:
    if entity and entity not in recycle_bin.ENTITIES:
        raise HTTPException(400, "Unknown record type")
    out = recycle_bin.listing(db, search=search, entity=entity, page=page, limit=limit, viewer=current_user)
    out["types"] = recycle_bin.counts(db, viewer=current_user)
    return out


@router.post("/recycle-bin/restore")
def restore_from_recycle_bin(
    *, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("system.write")), body: BinItems,
) -> Any:
    return recycle_bin.restore(db, current_user.id, [i.model_dump() for i in body.items], viewer=current_user)


@router.post("/recycle-bin/purge")
def purge_from_recycle_bin(
    *, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("system.write")), body: BinItems,
) -> Any:
    return recycle_bin.purge(db, [i.model_dump() for i in body.items], viewer=current_user)


@router.post("/recycle-bin/empty")
def empty_recycle_bin(
    *, background_tasks: BackgroundTasks, current_user: User = Depends(deps.require_permission("system.write")), body: BinEmpty,
) -> Any:
    """Permanently delete everything in the bin (or one record type). Records still used elsewhere stay."""
    if body.entity and body.entity not in recycle_bin.ENTITIES:
        raise HTTPException(400, "Unknown record type")
    job_id = uuid4().hex
    with _empty_jobs_lock:
        _empty_jobs[job_id] = {"status": "queued"}
    background_tasks.add_task(_run_empty_recycle_job, job_id, body.entity, current_user.id)
    return {"job_id": job_id, "status": "queued", "message": "Recycle Bin cleanup started."}


@router.get("/recycle-bin/empty/{job_id}")
def empty_recycle_bin_status(
    *, job_id: str, current_user: User = Depends(deps.require_permission("system.read")),
) -> Any:
    with _empty_jobs_lock:
        job = _empty_jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Cleanup job not found or the server was restarted.")
    return job


class CleanupIn(BaseModel):
    groups: List[str] = Field(min_length=1)
    confirm_text: str = ""


def _groups(keys: List[str]) -> List[str]:
    unknown = [k for k in keys if k not in data_cleanup.GROUPS]
    if unknown:
        raise HTTPException(400, f"Unknown data group: {', '.join(unknown)}")
    return data_cleanup.closure(keys)


@router.get("/cleanup")
def read_cleanup_groups(
    *, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("system.read")),
) -> Any:
    return {"data": data_cleanup.preview(db), "confirm_word": "CLEAR"}


@router.get("/cleanup/backup")
def download_cleanup_backup(
    *, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("system.write")),
    groups: str = Query(..., description="comma separated group keys"),
) -> Any:
    """A zip with one CSV per table that the chosen groups would clear."""
    keys = _groups([g for g in groups.split(",") if g])
    return Response(
        data_cleanup.backup_zip(db, keys), media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="hms-backup-before-cleanup.zip"'},
    )


@router.post("/cleanup")
def clear_data(
    *, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("system.write")), body: CleanupIn,
) -> Any:
    """Empty the chosen groups (and the groups they depend on). Needs the word CLEAR in confirm_text."""
    if body.confirm_text.strip() != "CLEAR":
        raise HTTPException(400, "Type CLEAR to confirm.")
    keys = _groups(body.groups)
    return data_cleanup.clear(db, keys, current_user.id, getattr(db, "_action_reason", "") or "")
