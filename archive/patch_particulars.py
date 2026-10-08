import re

# 1. Add Particular to models/masters.py
with open(r'D:\python_project\hms\hms\backend\models\masters.py', 'r', encoding='utf-8') as f:
    models = f.read()

particular_model = '''
class Particular(AuditMixin, Base):
    __tablename__ = "particulars"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    name_en: Mapped[str] = mapped_column(String(100), nullable=False)
    name_kn: Mapped[str] = mapped_column(String(150), nullable=True)
    parent_id: Mapped[Optional[int]] = mapped_column(BigInteger, ForeignKey("particulars.id"), nullable=True)
    status: Mapped[bool] = mapped_column(Boolean, default=True)
    
    children = relationship("Particular", backref=backref("parent", remote_side=[id]))

'''
if "class Particular(" not in models:
    models = models.replace('class ServiceType(AuditMixin, Base):', particular_model + 'class ServiceType(AuditMixin, Base):')
    with open(r'D:\python_project\hms\hms\backend\models\masters.py', 'w', encoding='utf-8') as f:
        f.write(models)


# 2. Add schemas
with open(r'D:\python_project\hms\hms\backend\schemas\masters.py', 'r', encoding='utf-8') as f:
    schemas = f.read()

particular_schemas = '''
class ParticularBase(BaseModel):
    code: str
    name_en: str
    name_kn: Optional[str] = None
    parent_id: Optional[int] = None
    status: bool = True

class ParticularCreate(ParticularBase):
    pass

class ParticularUpdate(BaseModel):
    code: Optional[str] = None
    name_en: Optional[str] = None
    name_kn: Optional[str] = None
    parent_id: Optional[int] = None
    status: Optional[bool] = None

class Particular(ParticularBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

'''
if "class ParticularBase" not in schemas:
    schemas = schemas.replace('class ServiceTypeBase(BaseModel):', particular_schemas + 'class ServiceTypeBase(BaseModel):')
    with open(r'D:\python_project\hms\hms\backend\schemas\masters.py', 'w', encoding='utf-8') as f:
        f.write(schemas)


# 3. Add to CRUD
with open(r'D:\python_project\hms\hms\backend\crud\masters.py', 'r', encoding='utf-8') as f:
    crud = f.read()

if "CRUDParticular" not in crud:
    crud = crud.replace('ServiceType,', 'ServiceType, Particular,')
    crud = crud.replace('ServiceTypeCreate, ServiceTypeUpdate', 'ServiceTypeCreate, ServiceTypeUpdate, ParticularCreate, ParticularUpdate')
    
    crud_add = '''class CRUDParticular(CRUDBase[Particular, ParticularCreate, ParticularUpdate]):
    pass

particular = CRUDParticular(Particular)
'''
    crud = crud + "\n" + crud_add
    with open(r'D:\python_project\hms\hms\backend\crud\masters.py', 'w', encoding='utf-8') as f:
        f.write(crud)


# 4. Add router
with open(r'D:\python_project\hms\hms\backend\api\v1\endpoints\master_settings\finance.py', 'r', encoding='utf-8') as f:
    finance = f.read()

if "@router.get(\"/particulars\")" not in finance:
    finance = finance.replace("from models.masters import Bank, ServiceType", "from models.masters import Bank, ServiceType, Particular")
    
    router_code = '''
# ─────────────── PARTICULARS ────────────────
@router.get("/particulars")
def read_particulars(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    page: int = 1,
    limit: int = 1000,
) -> Any:
    q = db.query(Particular).filter(Particular.is_deleted == False)
    return paginate(q, page, limit)

@router.post("/particulars", response_model=Union[schemas_masters.Particular, PendingApproval])
@approval_gate.gated("masters", "CREATE", "Particular", "masters.write")
def create_particular(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    obj_in: schemas_masters.ParticularCreate,
) -> Any:
    return crud_masters.particular.create(db=db, obj_in=obj_in, created_by=current_user.id)

@router.put("/particulars/{id}", response_model=Union[schemas_masters.Particular, PendingApproval])
@approval_gate.gated("masters", "UPDATE", "Particular", "masters.write")
def update_particular(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.write")),
    id: int,
    obj_in: schemas_masters.ParticularUpdate,
) -> Any:
    obj = crud_masters.particular.get(db, id)
    if not obj:
        raise HTTPException(404, "Particular not found")
    return crud_masters.particular.update(db, db_obj=obj, obj_in=obj_in, updated_by=current_user.id)

@router.delete("/particulars/{id}", response_model=Union[schemas_masters.Particular, PendingApproval])
@approval_gate.gated("masters", "DELETE", "Particular", "masters.delete")
def delete_particular(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("masters.delete")),
    id: int,
) -> Any:
    obj = crud_masters.particular.get(db, id)
    if not obj:
        raise HTTPException(404, "Particular not found")
    return crud_masters.particular.remove(db, id=id, deleted_by=current_user.id)
'''
    finance = finance + "\n" + router_code
    with open(r'D:\python_project\hms\hms\backend\api\v1\endpoints\master_settings\finance.py', 'w', encoding='utf-8') as f:
        f.write(finance)

# 5. Patch ReceiptTypeManagement.jsx
with open(r'D:\python_project\HMS-frontend-main\src\pages\ReceiptTypeManagement.jsx', 'r', encoding='utf-8') as f:
    frontend = f.read()

frontend = frontend.replace('/master-settings/finance/service-types', '/master-settings/finance/particulars')
with open(r'D:\python_project\HMS-frontend-main\src\pages\ReceiptTypeManagement.jsx', 'w', encoding='utf-8') as f:
    f.write(frontend)

print("Done generating endpoints and updating frontend.")
