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

SEEDS = {"members": "registration_source = 'MIGRATION'", "receipts": "source = 'OLD_REGISTER'"}


def wipe(db, dry: bool = False) -> dict:
    from sqlalchemy import inspect

    insp = inspect(db.get_bind())
    names = [t for t in insp.get_table_names() if not t.startswith("alembic")]
    fks = {t: [f for f in insp.get_foreign_keys(t) if f["referred_columns"] == ["id"] and len(f["constrained_columns"]) == 1] for t in names}
    nullable = {t: {c["name"]: c["nullable"] for c in insp.get_columns(t)} for t in names}
    has_id = {t: insp.get_pk_constraint(t).get("constrained_columns") == ["id"] for t in names}
    doomed, order, direct, counts = {}, [], [], {}

    def mk(name, select_sql):
        db.execute(text(f"DROP TABLE IF EXISTS d_{name}"))
        db.execute(text(f"CREATE TEMP TABLE d_{name} AS {select_sql}"))
        doomed[name] = f"d_{name}"

    for name, where in SEEDS.items():
        mk(name, f"SELECT id FROM {name} WHERE {where}")
        order.append(name)
    # follow the links parents first: a row that must have its parent goes with it
    grew = True
    while grew:
        grew = False
        for t in names:
            if t in doomed or t in {x for x, _ in direct}:
                continue
            hard = [f for f in fks[t] if f["referred_table"] in doomed and not nullable[t][f["constrained_columns"][0]]]
            if not hard:
                continue
            cond = " OR ".join(f"{f['constrained_columns'][0]} IN (SELECT id FROM {doomed[f['referred_table']]})" for f in hard)
            if has_id[t]:
                mk(t, f"SELECT id FROM {t} WHERE {cond}")
                order.append(t)
            else:
                direct.append((t, cond))
            grew = True
    # links that may be empty, from any table: cut them (rows that go anyway do not matter)
    for t in names:
        for f in fks[t]:
            col = f["constrained_columns"][0]
            if f["referred_table"] in doomed and nullable[t][col]:
                res = db.execute(text(f"UPDATE {t} SET {col} = NULL WHERE {col} IN (SELECT id FROM {doomed[f['referred_table']]})"))
                if res.rowcount:
                    counts[f"{t}.{col} detached"] = res.rowcount
    for t, cond in direct:
        res = db.execute(text(f"DELETE FROM {t} WHERE {cond}"))
        counts[t] = res.rowcount or 0
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
