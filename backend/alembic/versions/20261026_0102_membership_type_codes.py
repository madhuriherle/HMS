"""Short codes for the membership types of the old register: AJ, PO, MP, ML.

Revision ID: 20261026_0102
Revises: 20261026_0101

The old register writes these in its DocNo column (333/AJ/450). A type gets its code only while it still has the code made by
the system and no other type uses the new one, so a code an admin chose is kept. Idempotent.
"""
import re

import sqlalchemy as sa
from alembic import op

revision = "20261026_0102"
down_revision = "20261026_0101"
branch_labels = None
depends_on = None

CODES = {"AJEEVA": "AJ", "POSHAKA": "PO", "MAHAPOSHAKA": "MP", "MAHAPALAKA": "ML"}


def _made_by_the_system(code: str) -> bool:
    """MT-01 style, or the letters + digits the screen makes from a name (MAHA4303CF4)."""
    return code.startswith("MT-") or bool(re.fullmatch(r"[A-Z0-9]{1,4}\d{3}[0-9A-F]{4}", code or ""))


def upgrade() -> None:
    bind = op.get_bind()
    for name, code in CODES.items():
        if bind.execute(sa.text("SELECT 1 FROM membership_types WHERE code = :c AND is_deleted = false"), {"c": code}).first():
            continue
        for row_id, current in bind.execute(sa.text("SELECT id, code FROM membership_types WHERE upper(name_en) = :n AND is_deleted = false"), {"n": name}).all():
            if _made_by_the_system(current):
                bind.execute(sa.text("UPDATE membership_types SET code = :c WHERE id = :i"), {"c": code, "i": row_id})


def downgrade() -> None:
    pass
