"""Seed the default modules, privileges and roles into an empty database.

Usage (from backend/):  python scripts/seed_defaults.py
Safe to re-run: only missing rows are inserted. (Migration 0015 already does
this for databases created through Alembic.)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db.seed_defaults import seed_modules, seed_permissions, seed_roles  # noqa: E402
from db.session import SessionLocal  # noqa: E402

if __name__ == "__main__":
    db = SessionLocal()
    try:
        print("modules created:", seed_modules(db))
        print("permissions created:", seed_permissions(db))
        print("roles created:", seed_roles(db))
    finally:
        db.close()
