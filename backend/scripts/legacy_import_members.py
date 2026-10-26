"""Import the members of the old register: python scripts/legacy_import_members.py MstMember.xlsx [--user ID] [--limit N].
Members only (no receipts). Safe to repeat: members already imported are skipped. Prints the result and writes it to a json file."""
import argparse
import json
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from db.session import SessionLocal  # noqa: E402
from models.users import User  # noqa: E402
from services import legacy_import  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("file")
ap.add_argument("--user", type=int)
ap.add_argument("--limit", type=int)
ap.add_argument("--out", default="legacy_import_result.json")
a = ap.parse_args()

rows = legacy_import.read_register(Path(a.file).read_bytes())
if a.limit:
    rows = rows[: a.limit]
db = SessionLocal()
try:
    user_id = a.user or db.query(User.id).order_by(User.id).first()[0]
    result = legacy_import.import_members(db, rows, user_id, run_id=uuid.uuid4().hex, file_name=Path(a.file).name,
                                          progress=lambda n, c: print(f"  {n} rows read, {c} members created", flush=True))
finally:
    db.close()
print({k: v for k, v in result.items() if not k.endswith("_list")})
Path(a.out).write_text(json.dumps(result, indent=1, default=str), encoding="utf-8")
