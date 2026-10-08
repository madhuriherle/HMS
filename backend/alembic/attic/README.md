# Migration drafts (not used)

These two files are superseded drafts from the initial scaffold. They all claim
revision id `20260921_0001`, which conflicts with the live migration, and their
column names do not match the SQLAlchemy models (`full_name`, `is_active`,
`postal_code`, …), so applying them would create a schema the app can't use.

The authoritative migration is:

    alembic/versions/20260921_0001_create_hms_mma_full_schema.py

which is generated from the ORM metadata (`Base.metadata.create_all`) and always
matches `backend/models/`.

Alembic only scans `alembic/versions/`, so nothing in this folder is ever loaded.
Kept for reference only — safe to delete.
