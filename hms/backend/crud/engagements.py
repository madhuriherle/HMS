from crud.base import CRUDBase
from models.engagements import Affiliation, Associate, PressMedia, CommitteeMember
from schemas.engagements import AffiliationCreate, AffiliationUpdate

class CRUDAffiliation(CRUDBase[Affiliation, AffiliationCreate, AffiliationUpdate]):
    pass

affiliation = CRUDAffiliation(Affiliation)
