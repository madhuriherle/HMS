"""Member registration fields + starter gotra / qualification masters.

Revision ID: 20261009_0026
Revises: 20261009_0025
Create Date: 2026-10-09

Adds the columns the new Register New Member screen needs (name title, WhatsApp
country code, applied-on-behalf-of, magazine needed, membership category,
referred-by, family membership, payment entered with the application) and loads
the Havyaka gotras and the qualification list into their masters, only when
those masters are empty, so the screen's dropdowns come from the database.
Idempotent: a fresh database built from current ORM metadata already has the
columns.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.orm import Session

revision = "20261009_0026"
down_revision = "20261009_0025"
branch_labels = None
depends_on = None

NEW_COLUMNS = [
    ("name_title", sa.String(10)),
    ("whatsapp_country_code", sa.String(5)),
    ("applied_on_behalf_of", sa.String(30)),
    ("magazine_needed", sa.Boolean()),
    ("membership_type_category", sa.String(80)),
    ("referred_by_number", sa.String(30)),
    ("referred_by_name", sa.String(150)),
    ("family_membership_number", sa.String(30)),
    ("family_membership_name", sa.String(150)),
    ("registration_payment", sa.JSON()),
]


def upgrade() -> None:
    bind = op.get_bind()
    existing = {c["name"] for c in sa.inspect(bind).get_columns("members")}
    for name, type_ in NEW_COLUMNS:
        if name not in existing:
            op.add_column("members", sa.Column(name, type_, nullable=True))

    session = Session(bind=bind)
    try:
        from db.seed_defaults import seed_personal_master_values

        seed_personal_master_values(session)
    finally:
        session.close()


def downgrade() -> None:
    # Additive; dropping the columns could destroy member data.
    pass
