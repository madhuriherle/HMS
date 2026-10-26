"""Name Titles master (SRI., SMT., DR. ...).

Revision ID: 20261026_0096
Revises: 20261023_0095

The titles members carry before their name used to be a fixed list in the code. Now a master, seeded with the
titles of the old register. Idempotent.
"""
import sqlalchemy as sa
from alembic import op

revision = "20261026_0096"
down_revision = "20261023_0095"
branch_labels = None
depends_on = None

TITLES = ["SRI.", "SMT.", "KUM.", "KUMARI", "MS.", "DR.", "PROF.", "PANDIT.", "VIDWAN.", "VIDUSHI.", "VEDMU.", "CA.", "JUSTICE.",
          "M/S", "MAJOR.", "CAPT.", "KARNAL.", "LT.COL.", "SQN.LDR.", "WG. CDR.", "BRIG.", "CDR.", "CDT.", "W.COM."]


def upgrade() -> None:
    bind = op.get_bind()
    if "name_titles" not in sa.inspect(bind).get_table_names():
        op.create_table(
            "name_titles",
            sa.Column("id", sa.BigInteger, primary_key=True),
            sa.Column("name_en", sa.String(30), nullable=False),
            sa.Column("name_kn", sa.String(150), nullable=True),
            sa.Column("status", sa.Boolean, nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("created_by", sa.BigInteger, nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_by", sa.BigInteger, nullable=True),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("deleted_by", sa.BigInteger, nullable=True),
            sa.Column("is_deleted", sa.Boolean, nullable=False, server_default=sa.false()),
        )
        op.create_index("ix_name_titles_id", "name_titles", ["id"])
    if not bind.execute(sa.text("select 1 from name_titles limit 1")).first():
        for t in TITLES:
            bind.execute(sa.text("insert into name_titles (name_en, status, is_deleted) values (:n, true, false)"), {"n": t})


def downgrade() -> None:
    op.drop_table("name_titles")
