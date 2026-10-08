from crud.base import CRUDBase
from models.notifications import NotificationTemplate
from schemas.notifications import NotificationTemplateCreate, NotificationTemplateUpdate

class CRUDNotificationTemplate(CRUDBase[NotificationTemplate, NotificationTemplateCreate, NotificationTemplateUpdate]):
    pass

template = CRUDNotificationTemplate(NotificationTemplate)
