"""Human-readable wording for activity-log rows (user logs and member timelines)."""

from typing import Any, Optional

# table -> what to call one row of it
LABELS = {
    "members": "member",
    "member_memberships": "membership",
    "member_service_optins": "service",
    "member_documents": "document",
    "member_kyc_requests": "KYC request",
    "member_profile_change_requests": "profile change request",
    "membership_type_change_requests": "membership type change",
    "member_deletion_requests": "deletion request",
    "receipts": "receipt",
    "receipt_items": "receipt line",
    "receipt_allocations": "receipt mapping",
    "receipt_cancellations": "receipt cancellation",
    "refund_transactions": "refund",
    "payment_transactions": "payment transaction",
    "magazine_subscriptions": "magazine subscription",
    "magazine_pauses": "magazine pause",
    "magazine_returns": "magazine return",
    "events": "event",
    "event_participants": "event participant",
    "associates": "associate",
    "users": "user",
    "roles": "role",
    "role_permissions": "role privilege",
    "modules": "module",
    "banks": "bank",
    "payment_modes": "payment mode",
    "particulars": "particular",
    "membership_types": "membership type",
    "document_types": "document type",
    "service_types": "service type",
    "states": "state",
    "districts": "district",
    "taluks": "taluk",
    "postal_codes": "PIN code",
    "notification_templates": "notification template",
    "notification_campaigns": "notification campaign",
    "approval_requests": "approval request",
}

# table -> module column shown in the Activity Logs screen
MODULES = {
    "Membership": ("members", "member_memberships", "member_service_optins", "member_documents", "member_kyc_requests",
                   "member_profile_change_requests", "membership_type_change_requests", "member_deletion_requests"),
    "Receipts": ("receipts", "receipt_items", "receipt_allocations", "receipt_cancellations", "refund_transactions",
                 "payment_transactions"),
    "Magazine": ("magazine_subscriptions", "magazine_pauses", "magazine_returns"),
    "Events": ("events", "event_participants"),
    "Approvals": ("approval_requests",),
    "User Management": ("users",),
    "Role Management": ("roles", "role_permissions", "modules"),
    "Master Settings": ("banks", "payment_modes", "particulars", "membership_types", "document_types", "service_types",
                        "states", "districts", "taluks", "postal_codes"),
    "Notifications": ("notification_templates", "notification_campaigns"),
}
_MODULE_OF = {t: m for m, tables in MODULES.items() for t in tables}

NOISE_FIELDS = {"created_at", "updated_at", "created_by", "updated_by", "deleted_at", "deleted_by", "is_deleted"}
VERBS = {"CREATE": "Created", "UPDATE": "Updated", "DELETE": "Deleted"}


def module_for(table: Optional[str]) -> str:
    return _MODULE_OF.get(table or "", "System")


def label_for(table: Optional[str]) -> str:
    return LABELS.get(table or "", (table or "record").replace("_", " ").rstrip("s"))


def field_label(name: str) -> str:
    return name.replace("_en", "").replace("_", " ").strip().capitalize()


def name_hint(obj: Any) -> Optional[str]:
    """Something that tells a person which record this is (a name, receipt number, code...)."""
    first = getattr(obj, "first_name_en", None)
    if first:
        return getattr(obj, "display_name", None) or " ".join(p for p in (first, getattr(obj, "last_name_en", None)) if p)
    for attr in ("receipt_number", "name_en", "name", "title", "template_name", "username", "payment_mode", "code"):
        value = getattr(obj, attr, None)
        if value:
            return str(value)
    return None


def _short(value: Any, limit: int = 40) -> str:
    if value is None or value == "":
        return "—"
    text = str(value)
    return text if len(text) <= limit else text[: limit - 1] + "…"


def summarize_changes(changes: Optional[dict], limit: int = 4) -> str:
    items = [(k, v) for k, v in (changes or {}).items() if k not in NOISE_FIELDS]
    parts = [f"{field_label(k)}: {_short(v.get('from'))} → {_short(v.get('to'))}" for k, v in items[:limit]]
    if len(items) > limit:
        parts.append(f"+{len(items) - limit} more")
    return "; ".join(parts)


def was_soft_deleted(changes: Optional[dict]) -> bool:
    return bool(changes and changes.get("is_deleted", {}).get("to") is True)


def describe(action: str, table: Optional[str], hint: Optional[str], entity_id: Any, changes: Optional[dict] = None) -> str:
    label = label_for(table)
    verb = "Deleted" if (action == "UPDATE" and was_soft_deleted(changes)) else VERBS.get(action, action.title())
    who = f"{label} {hint}" if hint else f"{label} {entity_id}" if entity_id else label
    text = f"{verb} {who}"
    if action == "UPDATE" and verb == "Updated":
        summary = summarize_changes(changes)
        if summary:
            text += f" ({summary})"
    return text[:255]
