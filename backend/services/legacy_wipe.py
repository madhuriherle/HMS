"""Remove what the old-register import created, and nothing else (test data, other members and receipts stay).

The seeds are the members with registration_source MIGRATION and the receipts with source OLD_REGISTER. From them the foreign keys are
followed (parents first):
  * a row that points at a removed row through a NOT NULL column belongs to it and is removed too (member_memberships, documents,
    allocations, receipt lines, magazine subscriptions...), and the rows that point at those in turn;
  * a row that points at a removed row through a nullable column is kept and the link is set to NULL (a test member whose father was an
    imported member, a test receipt mapped to an imported member).
Nothing is deleted from tables that no removed row points into. dry=True counts and rolls back.
"""
from sqlalchemy import text

from models.base import Base

SEEDS = {"members": "registration_source = 'MIGRATION'", "receipts": "source = 'OLD_REGISTER'"}


def wipe(db, dry: bool = False) -> dict:
    doomed = {}                       # table name -> temp table of ids
    order = []                        # discovery order, parents first
    counts = {}
    detached = {}
    tables = list(Base.metadata.sorted_tables)

    def mk(name, select_sql):
        tmp = f"d_{name}"
        db.execute(text(f"DROP TABLE IF EXISTS {tmp}"))
        db.execute(text(f"CREATE TEMP TABLE {tmp} AS {select_sql}"))
        doomed[name] = tmp

    for name, where in SEEDS.items():
        mk(name, f"SELECT id FROM {name} WHERE {where}")
        order.append(name)

    direct = []                       # (table, where-sql) of tables without an id column to follow further
    for t in tables:
        if t.name in SEEDS or t.name.startswith("alembic"):
            continue
        fks = [fk for fk in t.foreign_keys if fk.column.table.name in doomed and fk.column.name == "id"]
        if not fks:
            continue
        hard = [fk for fk in fks if not fk.parent.nullable]
        if hard:
            cond = " OR ".join(f"{fk.parent.name} IN (SELECT id FROM {doomed[fk.column.table.name]})" for fk in hard)
            if "id" in t.c and t.c["id"].primary_key:
                mk(t.name, f"SELECT id FROM {t.name} WHERE {cond}")
                order.append(t.name)
            else:
                direct.append((t.name, cond))
        for fk in fks:
            if fk.parent.nullable:
                detached.setdefault(t.name, []).append((fk.parent.name, doomed[fk.column.table.name]))

    # links from rows that stay: set to NULL, rows that go are skipped
    for tname, links in detached.items():
        for col, tmp in links:
            own = f" AND id NOT IN (SELECT id FROM d_{tname})" if tname in doomed else ""
            res = db.execute(text(f"UPDATE {tname} SET {col} = NULL WHERE {col} IN (SELECT id FROM {tmp}){own}"))
            if res.rowcount:
                counts[f"{tname}.{col} detached"] = res.rowcount
    # a seed table pointing at another seed or itself through a nullable column (members -> members): cut first, so the order of deletion is free
    for name in SEEDS:
        t = Base.metadata.tables[name]
        for fk in t.foreign_keys:
            tn = fk.column.table.name
            if tn in doomed and fk.column.name == "id" and fk.parent.nullable:
                res = db.execute(text(f"UPDATE {name} SET {fk.parent.name} = NULL WHERE {fk.parent.name} IN (SELECT id FROM {doomed[tn]})"))
                if res.rowcount:
                    counts[f"{name}.{fk.parent.name} detached"] = res.rowcount

    for tname, cond in direct:
        res = db.execute(text(f"DELETE FROM {tname} WHERE {cond}"))
        counts[tname] = res.rowcount or 0
    for name in reversed(order):
        res = db.execute(text(f"DELETE FROM {name} WHERE id IN (SELECT id FROM {doomed[name]})"))
        counts[name] = res.rowcount or 0
    for tmp in doomed.values():
        db.execute(text(f"DROP TABLE IF EXISTS {tmp}"))
    if dry:
        db.rollback()
    else:
        db.commit()
    return {k: v for k, v in counts.items() if v}
