import os

file_path = 'backend/api/v1/endpoints/master_settings/geography.py'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

if 'from fastapi.responses import StreamingResponse' not in content:
    content = content.replace('from fastapi import APIRouter, Depends, HTTPException, Response', 'from fastapi import APIRouter, Depends, HTTPException, Response\nfrom fastapi.responses import StreamingResponse\nimport io\nimport csv')

summary_code = '''
@router.get("/states-summary")
def get_states_summary(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    states = db.query(State).filter(State.is_deleted == False).all()
    res = []
    for st in states:
        d_count = db.query(District).filter(District.state_id == st.id, District.is_deleted == False).count()
        t_count = db.query(Taluk).join(District).filter(District.state_id == st.id, Taluk.is_deleted == False, District.is_deleted == False).count()
        p_count = db.query(PostalCode).filter(PostalCode.state_id == st.id, PostalCode.is_deleted == False).count()
        res.append({
            "id": st.id,
            "name": st.name_en,
            "code": st.code,
            "status": st.status,
            "districts": d_count,
            "taluks": t_count,
            "pins": p_count
        })
    return {"data": res}
'''

if '/states-summary' not in content:
    content = content.replace('@router.get("/states")', summary_code + '\n\n@router.get("/states")')

export_code = '''
@router.get("/postal-codes/export")
def export_postal_codes(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    pincode: Optional[str] = None,
    state_id: Optional[int] = None,
    district_id: Optional[int] = None,
    taluk_id: Optional[int] = None,
    search: Optional[str] = None,
) -> Any:
    q = db.query(PostalCode, State.name_en.label("state_name"), District.name_en.label("district_name"), Taluk.name_en.label("taluk_name")).\\
        outerjoin(State, PostalCode.state_id == State.id).\\
        outerjoin(District, PostalCode.district_id == District.id).\\
        outerjoin(Taluk, PostalCode.taluk_id == Taluk.id).\\
        filter(PostalCode.is_deleted == False)
    if pincode:
        q = q.filter(PostalCode.pincode.ilike(f"%{pincode}%"))
    if state_id:
        q = q.filter(PostalCode.state_id == state_id)
    if district_id:
        q = q.filter(PostalCode.district_id == district_id)
    if taluk_id:
        q = q.filter(PostalCode.taluk_id == taluk_id)
    if search:
        q = q.filter((PostalCode.post_office_name.ilike(f"%{search}%")) | (PostalCode.pincode.ilike(f"%{search}%")))
        
    records = q.all()
    
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['pin_code', 'post_office_name', 'taluk_name', 'district_name', 'state_name', 'status'])
    
    for row in records:
        pc, st_name, dist_name, tk_name = row
        status = "Active" if pc.status == "Mapped" else pc.status
        writer.writerow([pc.pincode, pc.post_office_name or "", tk_name or "", dist_name or "", st_name or "", status or "Active"])
        
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=postal_codes.csv"}
    )
'''

if '/postal-codes/export' not in content:
    content = content.replace('@router.get("/postal-codes/template")', export_code + '\n\n@router.get("/postal-codes/template")')

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
print('Patched geography.py')
