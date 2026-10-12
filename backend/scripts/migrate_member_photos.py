"""Move member photos into uploads/images/members/<member_id>/photo.<ext>.

Run from backend/:  python scripts/migrate_member_photos.py [--dry-run]
Idempotent: members already on the new layout are skipped.
"""
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.config import settings  # noqa: E402
from db.session import SessionLocal  # noqa: E402
from models.members import Member  # noqa: E402


def main(dry_run: bool) -> None:
    db = SessionLocal()
    moved = missing = skipped = 0
    for m in db.query(Member).filter(Member.photo_path.isnot(None)).all():
        rel = m.photo_path.replace("\\", "/")
        prefix = settings.UPLOAD_DIR.rstrip("/\\").replace("\\", "/") + "/"
        if rel.startswith(prefix + f"images/members/{m.id}/"):
            skipped += 1
            continue
        src = rel if os.path.isfile(rel) else os.path.join(settings.UPLOAD_DIR, rel[len(prefix):] if rel.startswith(prefix) else rel)
        if not os.path.isfile(src):
            print(f"member {m.id}: file missing ({m.photo_path})")
            missing += 1
            continue
        ext = os.path.splitext(src)[1].lower()
        dest_dir = os.path.join(settings.UPLOAD_DIR, "images", "members", str(m.id))
        dest = os.path.join(dest_dir, f"photo{ext}")
        print(f"member {m.id}: {src} -> {dest}")
        if not dry_run:
            os.makedirs(dest_dir, exist_ok=True)
            shutil.move(src, dest)
            m.photo_path = dest.replace("\\", "/")
        moved += 1
    if not dry_run:
        db.commit()
    print(f"moved={moved} skipped={skipped} missing={missing} dry_run={dry_run}")


if __name__ == "__main__":
    main("--dry-run" in sys.argv)
