"""Indexes beyond what the models declare one by one.

PostgreSQL does not index foreign-key columns automatically, and the screens
filter members / receipts / logs by a handful of plain columns. Instead of
sprinkling ``index=True`` over ~80 columns, this module derives them:

* every foreign-key column that is not already the first column of an index;
* the filter columns listed in ``EXTRA_INDEXES`` (state/district/taluk/pincode
  on members are plain ids, not foreign keys, so they are listed here).

``ensure_indexes(metadata)`` attaches them to the ORM metadata (idempotent), so
``create_all`` (fresh installs, tests) and migration 0017 (existing databases)
produce exactly the same ``ix_<table>_<column>`` indexes.
"""

from sqlalchemy import Index

# (table, column) — filter / sort columns used by lists, reports and reminders.
# Free-text columns searched with ILIKE '%x%' are deliberately absent: a btree
# cannot serve a contains-search (that needs pg_trgm).
EXTRA_INDEXES = [
    ("members", "state_id"), ("members", "district_id"), ("members", "taluk_id"), ("members", "pincode_id"),
    ("members", "approval_status"), ("members", "member_status"), ("members", "registration_source"),
    ("members", "gender"),
    ("receipts", "receipt_date"), ("receipts", "payment_status"), ("receipts", "receipt_type"),
    ("magazine_returns", "issue_month_year"), ("magazine_subscriptions", "delivery_status"),
    ("member_memberships", "status"), ("member_memberships", "expires_at"),
    ("member_activity_logs", "created_at"), ("user_activity_logs", "created_at"), ("user_activity_logs", "action"),
    ("notification_messages", "delivery_status"), ("notification_campaigns", "status"),
    ("events", "event_date"), ("postal_codes", "pincode"),
]


def _indexed_first_columns(table) -> set:
    cols = set()
    for idx in table.indexes:
        first = next(iter(idx.columns), None)
        if first is not None:
            cols.add(first.name)
    for col in table.columns:
        if col.primary_key or col.unique or col.index:
            cols.add(col.name)
    for const in table.constraints:
        cols_in = list(getattr(const, "columns", []))
        if cols_in and const.__class__.__name__ in ("UniqueConstraint", "PrimaryKeyConstraint"):
            cols.add(cols_in[0].name)
    return cols


def ensure_indexes(metadata) -> list:
    """Attach the derived indexes to every table in `metadata`. Returns the
    Index objects it created (empty on a second call)."""
    created = []
    for table in metadata.tables.values():
        have = _indexed_first_columns(table)
        wanted = [fk.parent.name for fk in table.foreign_keys]
        wanted += [c for t, c in EXTRA_INDEXES if t == table.name and c in table.columns]
        for name in dict.fromkeys(wanted):
            if name in have:
                continue
            created.append(Index(f"ix_{table.name}_{name}", table.columns[name]))
            have.add(name)
    return created
