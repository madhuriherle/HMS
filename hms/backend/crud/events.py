from crud.base import CRUDBase
from models.events import Event
from schemas.events import EventCreate, EventUpdate

class CRUDEvent(CRUDBase[Event, EventCreate, EventUpdate]):
    pass

event = CRUDEvent(Event)
