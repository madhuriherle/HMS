from typing import Any, Dict, List, Set
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from api import deps
from models.users import User
from models.masters import PostalCode, State, District, Taluk
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
      - pincode: exactly 6 digits (required)
      - post_office_name: optional
      - state_id / district_id: required, must reference existing masters
      - taluk_id: optional, must reference a taluk in the same district
      - state_name_en / district_name_en / taluk_name_en are accepted as
        alternatives to the *_id columns and resolved by name.

    Rows are upserted on (pincode, post_office_name): re-importing the same file
    updates geography instead of duplicating; a different office under the same
    pincode is a new row (pincodes are shared across post offices).
    """
    MAX_ROWS = 50_000
    if not file.filename.endswith(".csv"):
        raise HTTPException(400, "Only CSV files are supported")

    contents = await file.read()
    # utf-8-sig tolerates the BOM that Excel adds, otherwise the first column
    # header arrives as '\ufeffpincode' and never matches.
    decoded = contents.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(decoded))

    required_cols = {"pincode"}
    if not required_cols.issubset(set(reader.fieldnames or [])):
        raise HTTPException(400, "CSV must contain column: pincode (plus state_id/district_id or state_name_en/district_name_en)")

    fields = set(reader.fieldnames or [])
    has_ids = "state_id" in fields and "district_id" in fields
    has_names = "state_name_en" in fields and "district_name_en" in fields
    if not (has_ids or has_names):
        raise HTTPException(400, "CSV needs either state_id+district_id or state_name_en+district_name_en columns")

    # ── Preload lookup maps: one query per table for the whole import. ──
    states_by_id: Dict[int, State] = {
        s.id: s for s in db.query(State).filter(State.is_deleted == False).all()  # noqa: E712
    }
    districts_by_id: Dict[int, District] = {
        d.id: d for d in db.query(District).filter(District.is_deleted == False).all()  # noqa: E712
    }
    taluks_by_id: Dict[int, Taluk] = {
        t.id: t for t in db.query(Taluk).filter(Taluk.is_deleted == False).all()  # noqa: E712
    }
    states_by_name: Dict[str, State] = {s.name_en.strip().lower(): s for s in states_by_id.values()}
    districts_by_name: Dict[tuple, District] = {
        (d.state_id, d.name_en.strip().lower()): d for d in districts_by_id.values()
    }
    taluks_by_name: Dict[tuple, Taluk] = {
        (t.district_id, t.name_en.strip().lower()): t for t in taluks_by_id.values()
    }

    # Existing rows keyed by (pincode, office) for the upsert.
    existing_rows: Dict[tuple, PostalCode] = {
        (row.pincode, (row.post_office_name or "").strip().lower()): row
        for row in db.query(PostalCode).filter(PostalCode.is_deleted == False).all()  # noqa: E712
    }

    inserted = 0
    updated = 0
    skipped = 0
    errors: List[str] = []

    def _fail(i: int, msg: str) -> None:
        errors.append(f"Row {i}: {msg}")
        nonlocal_counter[0] += 1

    nonlocal_counter = [0]

    for i, row in enumerate(reader, start=2):
        if i > MAX_ROWS + 1:
            raise HTTPException(400, f"CSV exceeds {MAX_ROWS} rows")
        try:
            pincode = (row.get("pincode") or "").strip()
            if len(pincode) != 6 or not pincode.isdigit():
                errors.append(f"Row {i}: Invalid pincode '{pincode}'")
                skipped += 1
                continue

            office = (row.get("post_office_name") or "").strip() or None

            # Resolve state
            state = None
            if has_ids and (row.get("state_id") or "").strip():
                state = states_by_id.get(int(row["state_id"]))
            elif (row.get("state_name_en") or "").strip():
                state = states_by_name.get(row["state_name_en"].strip().lower())
            if not state:
                errors.append(f"Row {i}: Unknown state")
                skipped += 1
                continue

            # Resolve district (must belong to the resolved state)
            district = None
            if has_ids and (row.get("district_id") or "").strip():
                district = districts_by_id.get(int(row["district_id"]))
                if district and district.state_id != state.id:
                    errors.append(f"Row {i}: District {district.id} does not belong to state {state.id}")
                    skipped += 1
                    continue
            elif (row.get("district_name_en") or "").strip():
                district = districts_by_name.get((state.id, row["district_name_en"].strip().lower()))
            if not district:
                errors.append(f"Row {i}: Unknown district for state '{state.name_en}'")
                skipped += 1
                continue

            # Resolve taluk (optional; must belong to the resolved district)
            taluk = None
            if (row.get("taluk_id") or "").strip():
                taluk = taluks_by_id.get(int(row["taluk_id"]))
                if not taluk:
                    errors.append(f"Row {i}: Unknown taluk_id {row['taluk_id']}")
                    skipped += 1
                    continue
                if taluk.district_id != district.id:
                    errors.append(f"Row {i}: Taluk {taluk.id} does not belong to district {district.id}")
                    skipped += 1
                    continue
            elif (row.get("taluk_name_en") or "").strip():
                taluk = taluks_by_name.get((district.id, row["taluk_name_en"].strip().lower()))

            key = (pincode, (office or "").strip().lower())
            current = existing_rows.get(key)
            if current:
                current.state_id = state.id
                current.district_id = district.id
                current.taluk_id = taluk.id if taluk else None
                current.post_office_name = office
                current.updated_by = current_user.id
                updated += 1
            else:
                new_row = PostalCode(
                    pincode=pincode,
                    post_office_name=office,
                    state_id=state.id,
                    district_id=district.id,
                    taluk_id=taluk.id if taluk else None,
                    created_by=current_user.id,
                )
                db.add(new_row)
                existing_rows[key] = new_row
                inserted += 1

        except ValueError:
            errors.append(f"Row {i}: id columns must be integers")
            skipped += 1
        except Exception as e:
            errors.append(f"Row {i}: {e}")
            skipped += 1

    db.commit()
    return {
        "message": "Import complete",
        "inserted": inserted,
        "updated": updated,
        "skipped": skipped,
        "errors": errors[:20],  # Show first 20 errors max
    }
