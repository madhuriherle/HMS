from crud.base import CRUDBase
from models.engagements import (
    Affiliation, Associate, PressMedia,
    CommitteeCategory, CommitteeSubcategory, CommitteeTerm,
)
from schemas.engagements import (
    AffiliationCreate, AffiliationUpdate,
    AssociateCreate, AssociateUpdate,
    PressMediaCreate, PressMediaUpdate,
    CommitteeCategoryCreate, CommitteeCategoryUpdate,
    CommitteeSubcategoryCreate, CommitteeSubcategoryUpdate,
    CommitteeTermCreate, CommitteeTermUpdate,
)

class CRUDAffiliation(CRUDBase[Affiliation, AffiliationCreate, AffiliationUpdate]):
    pass

class CRUDAssociate(CRUDBase[Associate, AssociateCreate, AssociateUpdate]):
    pass

class CRUDPressMedia(CRUDBase[PressMedia, PressMediaCreate, PressMediaUpdate]):
    pass

class CRUDCommitteeCategory(CRUDBase[CommitteeCategory, CommitteeCategoryCreate, CommitteeCategoryUpdate]):
    pass

class CRUDCommitteeSubcategory(CRUDBase[CommitteeSubcategory, CommitteeSubcategoryCreate, CommitteeSubcategoryUpdate]):
    pass

class CRUDCommitteeTerm(CRUDBase[CommitteeTerm, CommitteeTermCreate, CommitteeTermUpdate]):
    pass

affiliation = CRUDAffiliation(Affiliation)
associate = CRUDAssociate(Associate)
press_media = CRUDPressMedia(PressMedia)
committee_category = CRUDCommitteeCategory(CommitteeCategory)
committee_subcategory = CRUDCommitteeSubcategory(CommitteeSubcategory)
committee_term = CRUDCommitteeTerm(CommitteeTerm)
