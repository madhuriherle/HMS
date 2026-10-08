import sys
import os

file_path = r'D:\python_project\hms\hms\backend\api\v1\endpoints\members.py'
with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_code = '''
from fastapi.responses import Response
from io import BytesIO

@router.get("/export-labels")
def export_labels(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    state_id: Optional[int] = None,
    district_id: Optional[int] = None,
    taluk_id: Optional[int] = None,
    pincode_id: Optional[int] = None,
    membership_type_id: Optional[int] = None,
) -> Response:
    """Generate a printable PDF of member address labels."""
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas
    
    query = db.query(Member).filter(Member.is_deleted == False, Member.member_status == "ACTIVE")

    if state_id:
        query = query.filter(Member.state_id == state_id)
    if district_id:
        query = query.filter(Member.district_id == district_id)
    if taluk_id:
        query = query.filter(Member.taluk_id == taluk_id)
    if pincode_id:
        query = query.filter(Member.pincode_id == pincode_id)
    if membership_type_id:
        query = query.filter(Member.membership_type_id == membership_type_id)

    members = query.all()

    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4
    
    labels_per_row = 3
    labels_per_col = 8
    
    label_width = width / labels_per_row
    label_height = height / labels_per_col
    
    col = 0
    row = 0
    
    for member in members:
        x = col * label_width + 15
        y = height - ((row + 1) * label_height) + 15
        
        textobject = c.beginText()
        textobject.setTextOrigin(x, y + label_height - 25)
        textobject.setFont("Helvetica-Bold", 10)
        name = f"{member.first_name_en or ''} {member.last_name_en or ''}".strip()
        textobject.textLine(name or "Unknown Member")
        
        textobject.setFont("Helvetica", 9)
        if member.address_line1: textobject.textLine(member.address_line1)
        if member.address_line2: textobject.textLine(member.address_line2)
        
        locality_str = [x for x in [member.locality, member.city, member.post] if x]
        if locality_str:
            textobject.textLine(", ".join(locality_str))
            
        c.drawText(textobject)
        
        col += 1
        if col >= labels_per_row:
            col = 0
            row += 1
            if row >= labels_per_col:
                row = 0
                c.showPage()
                
    c.save()
    pdf = buffer.getvalue()
    buffer.close()

    return Response(
        content=pdf, 
        media_type="application/pdf", 
        headers={"Content-Disposition": "attachment; filename=labels.pdf"}
    )

'''

out_lines = []
for line in lines:
    if '@router.get("/{id}",' in line:
        out_lines.append(new_code)
    out_lines.append(line)

with open(file_path, 'w', encoding='utf-8') as f:
    f.writelines(out_lines)

print("Done")
