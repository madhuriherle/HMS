"""Settings > Data Cleanup: clear operational records, never the master setup.

A group names the tables it empties. Deleting runs child-first (reverse FK order). A row
outside the group that points into it is detached (its nullable column set to NULL); a
group whose tables are pointed at by a NOT NULL column elsewhere must list that group in
``requires``, so the dependent rows go first. tests/test_data_cleanup.py checks this.
"""
import csv
import io
import os
import zipfile
from dataclasses import dataclass, field
from typing import Iterable

from sqlalchemy import func, text, update
from sqlalchemy.orm import Session

from models.activity import UserActivityLog
from models.base import Base
from core.config import settings
from models.system import NumberSequence


@dataclass(frozen=True)
class Group:
    key: str
    label: str
    description: str
    tables: tuple
    requires: tuple = ()
    reset_sequences: tuple = ()  # number_sequences.sequence_type prefixes restarted with the group
    files: tuple = ()  # (table, column) holding uploaded-file paths; the files are deleted with the rows
    warning: str = ""  # shown beside the group on the Data Cleanup screen
    extra: dict = field(default_factory=dict)


GROUPS = {
    g.key: g
    for g in (
        Group("receipts", "Receipts & Payments",
              "Receipts, their particulars lines, member/associate mappings, payment transactions, cancellations and refunds. Receipt numbers start again from the first number.",
              ("receipt_items", "receipt_allocations", "payment_transactions", "receipt_cancellations", "refund_transactions", "receipts"),
              reset_sequences=("RECEIPT",)),
        Group("members", "Members",
              "Every member with their memberships, documents, history, KYC requests, magazine subscriptions and event / committee links. Also clears Receipts & Payments. Membership numbers start again.",
              ("membership_type_history", "membership_type_change_requests", "member_memberships", "member_documents",
               "member_service_optins", "member_profile_history", "member_profile_change_requests", "member_kyc_requests",
               "member_deletion_requests", "member_approval_history", "member_meeting_exports", "member_activity_logs", "magazine_returns",
               "magazine_delivery_pauses", "magazine_subscriptions", "event_member_links", "event_participants",
               "file_attachments", "committee_member_links", "members"),
              requires=("receipts",), reset_sequences=("MEMBER_CODE",),
              files=(("members", "photo_path"), ("member_documents", "file_path"), ("file_attachments", "file_path"))),
        Group("magazines", "Magazine Operations",
              "Delivery batches, label batches and returns. Member subscriptions are cleared with Members.",
              ("magazine_label_batch_items", "magazine_label_batches", "magazine_delivery_batches")),
        Group("engagements", "Affiliations, Associates & Press",
              "Affiliations, associates, press & media contacts and committee members. Also clears Receipts & Payments, because receipts can be mapped to associates.",
              ("affiliation_contacts", "affiliation_magazine_settings", "affiliations", "associate_magazine_settings", "associates",
               "press_media_magazine_settings", "press_media", "committee_member_links", "committee_members", "committee_terms"),
              requires=("receipts",)),
        Group("events", "Events",
              "Events with their participants, member links and attachments.",
              ("event_attachments", "event_member_links", "event_participants", "events"),
              files=(("event_attachments", "file_path"), ("events", "invitation_file_path"))),
        Group("approvals", "Approvals",
              "Approval requests (pending and decided) and their actions. Approval rules stay.",
              ("approval_actions", "approval_requests")),
        Group("notifications", "Notifications",
              "Campaigns, sent messages, delivery logs, import batches and in-app notifications. Templates stay.",
              ("notification_delivery_logs", "notification_recipients", "notification_messages", "notification_import_batches",
               "notification_campaigns", "app_notification_reads", "app_notifications"),
              files=(("notification_import_batches", "file_path"),)),
        Group("logs", "System Logs & Sessions",
              "Activity logs (who did what), error logs, report export logs, login sessions, password-reset links and push tokens. One line recording this cleanup is kept.",
              ("user_activity_logs", "member_activity_logs", "system_error_logs", "report_export_logs",
               "refresh_tokens", "password_reset_tokens", "user_device_tokens"),
              files=(("report_export_logs", "file_path"),),
              warning="Everyone, including you, is signed out and must log in again."),
    )
}


def _table(name: str):
    t = Base.metadata.tables.get(name)
    if t is None:
        raise KeyError(f"Unknown table {name}")
    return t


def closure(keys: Iterable[str]) -> list:
    """The chosen groups plus the groups they require, in a stable order."""
    seen, order = set(), []

    def add(k):
        if k in seen:
            return
        if k not in GROUPS:
            raise KeyError(k)
        seen.add(k)
        for r in GROUPS[k].requires:
            add(r)
        order.append(k)

    for k in keys:
        add(k)
    return order


def _tables_for(keys: Iterable[str]) -> list:
    names = {n for k in keys for n in GROUPS[k].tables}
    ordered = [t for t in Base.metadata.sorted_tables if t.name in names]
    missing = names - {t.name for t in ordered}
    if missing:
        raise KeyError(f"Unknown tables: {sorted(missing)}")
    return ordered


def blockers(keys: Iterable[str]) -> list:
    """NOT NULL foreign keys from tables outside the chosen groups into them (must be empty)."""
    tables = _tables_for(keys)
    inside = {t.name for t in tables}
    out = []
    for t in Base.metadata.sorted_tables:
        if t.name in inside:
            continue
        for fk in t.foreign_keys:
            if fk.column.table.name in inside and not fk.parent.nullable:
                out.append(f"{t.name}.{fk.parent.name} -> {fk.column.table.name}")
    return out


def preview(db: Session) -> list:
    out = []
    for g in GROUPS.values():
        total = 0
        for name in g.tables:
            total += db.query(func.count()).select_from(_table(name)).scalar() or 0
        out.append({"key": g.key, "label": g.label, "description": g.description, "requires": list(g.requires),
                    "rows": total, "warning": g.warning, "has_files": bool(g.files)})
    return out


def backup_zip(db: Session, keys: Iterable[str]) -> bytes:
    """A zip of one CSV per table, to keep before clearing."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for t in _tables_for(closure(keys)):
            out = io.StringIO()
            w = csv.writer(out)
            cols = [c.name for c in t.columns]
            w.writerow(cols)
            for row in db.execute(t.select()).all():
                w.writerow(["" if v is None else v for v in row])
            z.writestr(f"{t.name}.csv", out.getvalue())
    return buf.getvalue()


def _collect_files(db: Session, keys: Iterable[str]) -> set:
    paths = set()
    for k in keys:
        for table, column in GROUPS[k].files:
            t = _table(table)
            for (value,) in db.execute(t.select().with_only_columns(t.c[column]).where(t.c[column].isnot(None))):
                if value:
                    paths.add(str(value))
    return paths


def _delete_files(paths: Iterable[str]) -> int:
    """Remove uploaded files; anything outside the upload folder is left alone."""
    base = os.path.abspath(settings.UPLOAD_DIR)
    prefix = settings.UPLOAD_DIR.rstrip("/\\").replace("\\", "/") + "/"
    gone = 0
    for p in paths:
        rel = p.replace("\\", "/")
        if rel.startswith(prefix):
            rel = rel[len(prefix):]
        target = os.path.abspath(os.path.join(base, *rel.lstrip("/").split("/")))
        if not target.startswith(base + os.sep):
            continue
        try:
            os.remove(target)
            gone += 1
        except OSError:
            pass
    return gone


def clear(db: Session, keys: Iterable[str], user_id: int, reason: str = "") -> dict:
    keys = closure(keys)
    tables = _tables_for(keys)
    problems = blockers(keys)
    if problems:
        raise RuntimeError("Cannot clear: " + ", ".join(problems))
    inside = {t.name for t in tables}
    paths = _collect_files(db, keys)

    # rows elsewhere that point into the cleared tables lose the link
    for t in Base.metadata.sorted_tables:
        if t.name in inside:
            continue
        for fk in t.foreign_keys:
            if fk.column.table.name in inside:
                db.execute(update(t).where(fk.parent.isnot(None)).values({fk.parent.name: None}))

    removed = {}
    for t in reversed([t for t in tables]):  # children first
        # a table that points at itself (members -> members) is emptied in one statement
        res = db.execute(t.delete())
        removed[t.name] = res.rowcount or 0

    for k in keys:
        for prefix in GROUPS[k].reset_sequences:
            db.query(NumberSequence).filter(NumberSequence.sequence_type.like(f"{prefix}%")).delete(synchronize_session=False)

    summary = {k: sum(removed.get(n, 0) for n in GROUPS[k].tables) for k in keys}
    db.add(UserActivityLog(
        user_id=user_id, action="CLEANUP", entity_type="system", entity_id=None,
        details={"groups": summary, "reason": reason or None},
        description="Cleared data: " + ", ".join(f"{GROUPS[k].label} ({n} rows)" for k, n in summary.items()),
        module="System", activity_type="DATA", status="SUCCESS",
    ))
    db.commit()
    return {"cleared": summary, "groups": keys, "files_deleted": _delete_files(paths),
            "warnings": [GROUPS[k].warning for k in keys if GROUPS[k].warning]}
