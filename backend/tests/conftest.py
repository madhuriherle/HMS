"""Test bootstrap: point the app at a throwaway SQLite database.

Environment variables are set before any app module is imported so that
``core.config.Settings`` picks them up.
"""

import os
import pathlib
import sys
import tempfile

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

_TMP = tempfile.mkdtemp(prefix="hms_test_")
# Set TEST_DATABASE_URL=postgresql://... to run the suite on a real PostgreSQL
# database (use a throwaway DB, e.g. one built with `alembic upgrade head`).
_PG = os.environ.get("TEST_DATABASE_URL")
os.environ["DATABASE_URL"] = _PG or f"sqlite:///{_TMP}/test.db"
os.environ["UPLOAD_DIR"] = os.path.join(_TMP, "uploads")
os.environ["BOOTSTRAP_ADMIN_USERNAME"] = "admin"
os.environ["BOOTSTRAP_ADMIN_PASSWORD"] = "Admintest@123"
os.environ["WHATSAPP_CALLBACK_SECRET"] = "cb-secret-test"

import pytest  # noqa: E402


@pytest.fixture(scope="session")
def app_engine():
    """Create every table on the throwaway SQLite database."""
    from sqlalchemy import INTEGER, event

    from db.session import engine
    from models.base import Base

    import main  # noqa: F401  # imports every model + registers audit listeners

    # Enforce foreign keys in SQLite so the tests exercise the same referential
    # guarantees (and delete ordering) as PostgreSQL.
    if engine.dialect.name == "sqlite":
        @event.listens_for(engine, "connect")
        def _enable_foreign_keys(dbapi_connection, connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    # SQLite cannot autoincrement BIGINT primary keys (PostgreSQL can), so the
    # primary key columns are downgraded to INTEGER for the test schema only.
    if engine.dialect.name == "sqlite":
        for table in Base.metadata.tables.values():
            for column in table.columns:
                if column.primary_key:
                    column.type = INTEGER()

    Base.metadata.create_all(bind=engine)

    # Modules / privileges / roles live in tables now; load the defaults the
    # migration would (db/seed_defaults.py). Idempotent, so a migrated
    # PostgreSQL test database is fine too.
    from db.seed_defaults import seed_banks, seed_menu_pages, seed_modules, seed_permissions, seed_roles
    from db.session import SessionLocal
    with SessionLocal() as seed_db:
        seed_modules(seed_db)
        seed_menu_pages(seed_db)
        seed_permissions(seed_db)
        seed_banks(seed_db)
        seed_roles(seed_db)
    return engine


@pytest.fixture(scope="session")
def client(app_engine):
    """A TestClient whose lifespan runs the startup bootstrap."""
    from fastapi.testclient import TestClient

    from main import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="session")
def admin_headers(client):
    response = client.post(
        "/api/v1/auth/login",
        data={"username": "admin", "password": "Admintest@123"},
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}
