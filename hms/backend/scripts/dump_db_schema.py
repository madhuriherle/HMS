"""Dump the full DB schema (from SQLAlchemy metadata) to Excel + Markdown.

Run from the backend directory:
    python scripts/dump_db_schema.py

Outputs (in docs/):
    db_schema.xlsx   — Overview + All Columns + Relationships sheets
    db_schema.md     — plain-text reference, easy to diff in git

Re-run after any migration to refresh the reference.
"""

import os
import sys
import tempfile

# Point the app at a throwaway DB before any model import touches settings.
_TMP = tempfile.mkdtemp(prefix="hms_schema_")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_TMP}/schema_ref.db")
os.environ.setdefault("SECRET_KEY", "schema-dump-only-key-0123456789abcdef")

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)
DOCS_DIR = os.path.join(BACKEND_DIR, "docs")

from models.base import Base  # noqa: E402

# Import every model module so all tables register on Base.metadata.
import models.masters  # noqa: F401, E402
import models.users  # noqa: F401, E402
import models.members  # noqa: F401, E402
import models.receipts  # noqa: F401, E402
import models.magazines  # noqa: F401, E402
import models.events  # noqa: F401, E402
import models.engagements  # noqa: F401, E402
import models.notifications  # noqa: F401, E402
import models.activity  # noqa: F401, E402
import models.system  # noqa: F401, E402
import models.inbox  # noqa: F401, E402
import models.approval_requests  # noqa: F401, E402

# AuditMixin columns shared by every table (kept out of the per-table rows so
# the sheets stay readable; a footnote on the Overview lists them).
AUDIT_COLUMNS = {
    "created_at", "created_by", "updated_at", "updated_by",
    "deleted_at", "deleted_by", "is_deleted",
}


def _collect():
    tables = []
    for tname in sorted(Base.metadata.tables):
        t = Base.metadata.tables[tname]
        cols = []
        for c in t.columns:
            tags = []
            if c.primary_key:
                tags.append("PK")
            if c.foreign_keys:
                tags.append("FK->" + ",".join(fk.target_fullname for fk in c.foreign_keys))
            if not c.nullable and not c.primary_key:
                tags.append("NOT NULL")
            if c.unique:
                tags.append("UNIQUE")
            if c.name in AUDIT_COLUMNS:
                tags.append("audit")
            cols.append((c.name, str(c.type), " ".join(tags)))
        indexes = [
            ("UNIQUE " + ix.name, ",".join(col.name for col in ix.columns))
            for ix in t.indexes if ix.unique
        ]
        tables.append((tname, cols, indexes))
    return tables


def _write_excel(tables, path):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill("solid", fgColor="2F5597")

    def _sheet(title, headers, rows, widths):
        ws = wb.create_sheet(title)
        ws.append(headers)
        for cell in ws[1]:
            cell.font = header_font
            cell.fill = header_fill
        for row in rows:
            ws.append(row)
        for i, w in enumerate(widths, start=1):
            ws.column_dimensions[get_column_letter(i)].width = w
        ws.freeze_panes = "A2"
        return ws

    # Overview: one row per table
    overview = [
        (name, len(cols), sum(1 for _, tags, _ in cols if "PK" in tags),
         sum(1 for _, tags, _ in cols if tags.startswith("FK")),
         ", ".join(ix_name for ix_name, _ in indexes) or "-")
        for name, cols, indexes in tables
    ]
    _sheet("Overview", ["table", "columns", "pks", "fks", "unique_indexes"],
           overview, [34, 10, 6, 6, 52])

    # All Columns: one row per column
    all_cols = [
        (tname, cname, ctype, tags)
        for tname, cols, _ in tables
        for cname, ctype, tags in cols
    ]
    _sheet("All Columns", ["table", "column", "type", "flags"],
           all_cols, [34, 30, 22, 42])

    # Relationships: one row per FK
    rels = []
    for tname, cols, _ in tables:
        for cname, ctype, tags in cols:
            if tags.startswith("FK->"):
                target = tags[4:]
                rels.append((tname, cname, target.split(".")[0], target.split(".")[1]))
    _sheet("Relationships", ["from_table", "from_column", "to_table", "to_column"],
           rels, [34, 28, 30, 26])

    del wb["Sheet"]
    wb.save(path)


def _write_markdown(tables, path):
    lines = [
        "# HMS MMA — Database Schema Reference",
        "",
        "Generated from the SQLAlchemy models (`python scripts/dump_db_schema.py`).",
        "Re-run after any migration to refresh.",
        "",
        f"Every table also carries the audit columns: "
        + ", ".join(sorted(AUDIT_COLUMNS)) + ".",
        "",
    ]
    for tname, cols, indexes in tables:
        lines.append(f"## `{tname}`")
        lines.append("")
        lines.append("| Column | Type | Flags |")
        lines.append("|---|---|---|")
        for cname, ctype, tags in cols:
            lines.append(f"| `{cname}` | {ctype} | {tags or '-'} |")
        for ix_name, ix_cols in indexes:
            lines.append(f"| | | UNIQUE INDEX `{ix_name}` ({ix_cols}) |")
        lines.append("")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))


def main():
    os.makedirs(DOCS_DIR, exist_ok=True)
    tables = _collect()

    xlsx_path = os.path.join(DOCS_DIR, "db_schema.xlsx")
    md_path = os.path.join(DOCS_DIR, "db_schema.md")
    _write_excel(tables, xlsx_path)
    _write_markdown(tables, md_path)

    print(f"{len(tables)} tables dumped:")
    print(f"  {xlsx_path}")
    print(f"  {md_path}")


if __name__ == "__main__":
    main()
