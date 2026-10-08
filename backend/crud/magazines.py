from crud.base import CRUDBase
from models.magazines import MagazineSubscription, MagazineDeliveryPause, MagazineReturn
from schemas.magazines import MagazineSubscriptionCreate, MagazineSubscriptionUpdate, MagazineDeliveryPauseCreate, MagazineDeliveryPauseUpdate

class CRUDMagazineSubscription(CRUDBase[MagazineSubscription, MagazineSubscriptionCreate, MagazineSubscriptionUpdate]):
    pass

class CRUDMagazineDeliveryPause(CRUDBase[MagazineDeliveryPause, MagazineDeliveryPauseCreate, MagazineDeliveryPauseUpdate]):
    pass

subscription = CRUDMagazineSubscription(MagazineSubscription)
pause = CRUDMagazineDeliveryPause(MagazineDeliveryPause)
