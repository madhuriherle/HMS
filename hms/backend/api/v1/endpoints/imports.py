from typing import Any
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from api import deps
from models.users import User
from models.masters import PostalCode
from models.magazines import MagazineReturn, MagazineSubscription
import io
import csv

router = APIRouter()

@router.post("/postal-codes/import")
async def import_postal_codes(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("imports.write")),
    file: UploadFile = File(...),
) -> Any:
    """
    Bulk import postal codes from a CSV file.
    Expected CSV columns: pincode, post_office_name, state_id, district_id, taluk_id
    """
    MAX_ROWS = 50_000
    if not file.filename.endswith(".csv"):
        raise HTTPException(400, "Only CSV files are supported")

    contents = await file.read()
    # utf-8-sig tolerates the BOM that Excel adds, otherwise the first column
    # header arrives as '\ufeffpincode' and never matches.
    decoded = contents.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(decoded))

    required_cols = {"pincode", "state_id", "district_id"}
    if not required_cols.issubset(set(reader.fieldnames or [])):
        raise HTTPException(400, f"CSV must contain columns: {required_cols}")

    # One query for the whole table — no per-row lookup.
    existing = {row[0] for row in db.query(PostalCode.pincode).distinct().all()}

    inserted = 0
    skipped = 0
    errors = []
    new_rows = []

    for i, row in enumerate(reader, start=2):
        if i > MAX_ROWS + 1:
            raise HTTPException(400, f"CSV exceeds {MAX_ROWS} rows")
        try:
            pincode = (row.get("pincode") or "").strip()
            if not pincode or len(pincode) != 6 or not pincode.isdigit():
                errors.append(f"Row {i}: Invalid pincode '{pincode}'")
                skipped += 1
                continue

            # Skip duplicates
            if pincode in existing:
                skipped += 1
                continue

            new_rows.append(PostalCode(
                pincode=pincode,
                post_office_name=(row.get("post_office_name") or "").strip() or None,
                state_id=int(row["state_id"]),
                district_id=int(row["district_id"]),
                taluk_id=int(row["taluk_id"]) if (row.get("taluk_id") or "").strip() else None,
                created_by=current_user.id
            ))
            existing.add(pincode)
            inserted += 1

        except Exception as e:
            errors.append(f"Row {i}: {str(e)}")
            skipped += 1

    if new_rows:
        db.add_all(new_rows)
    db.commit()
    return {
        "message": "Import complete",
        "inserted": inserted,
        "skipped": skipped,
        "errors": errors[:20]  # Show first 20 errors max
    }
