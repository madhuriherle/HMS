from crud.base import CRUDBase
from models.system import FileAttachment, SystemErrorLog
from schemas.system import FileAttachmentCreate, FileAttachmentUpdate, SystemErrorLogCreate, SystemErrorLogUpdate

class CRUDFileAttachment(CRUDBase[FileAttachment, FileAttachmentCreate, FileAttachmentUpdate]):
    pass

class CRUDSystemErrorLog(CRUDBase[SystemErrorLog, SystemErrorLogCreate, SystemErrorLogUpdate]):
    pass

attachment = CRUDFileAttachment(FileAttachment)
error_log = CRUDSystemErrorLog(SystemErrorLog)
