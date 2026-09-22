"""Create HMS MMA schema from ORM metadata."""

from alembic import op

from models.activity import MemberActivityLog, UserActivityLog
from models.engagements import (
    Affiliation,
    AffiliationContact,
    AffiliationMagazineSetting,
    Associate,
    AssociateMagazineSetting,
    CommitteeCategory,
    CommitteeMember,
    CommitteeMemberLink,
    CommitteeSubcategory,
    CommitteeTerm,
    PressMedia,
    PressMediaMagazineSetting,
)
from models.events import Event, EventAttachment, EventMemberLink, EventParticipant
from models.magazines import (
    MagazineDeliveryBatch,
    MagazineDeliveryPause,
    MagazineLabelBatch,
    MagazineLabelBatchItem,
    MagazineReturn,
    MagazineSubscription,
)
from models.masters import (
    District,
    DocumentType,
    HmsSetting,
    MembershipType,
    MembershipTypePrice,
    PostalCode,
    ServiceType,
    State,
    Taluk,
)
from models.members import (
    Member,
    MemberApprovalHistory,
    MemberDeletionRequest,
    MemberDocument,
    MemberKycRequest,
    MemberMembership,
    MemberProfileChangeRequest,
    MemberProfileHistory,
    MembershipTypeChangeRequest,
    MembershipTypeHistory,
)
from models.notifications import (
    NotificationCampaign,
    NotificationDeliveryLog,
    NotificationImportBatch,
    NotificationMessage,
    NotificationRecipient,
    NotificationTemplate,
)
from models.receipts import (
    PaymentTransaction,
    Receipt,
    ReceiptAllocation,
    ReceiptCancellation,
    ReceiptItem,
    RefundTransaction,
)
from models.reports import ReportExportLog, SavedReport
from models.system import (
    ApprovalAction,
    ApprovalWorkflow,
    FileAttachment,
    NumberSequence,
    PasswordResetToken,
    RefreshToken,
    SystemErrorLog,
)
from models.users import Permission, Role, RolePermission, User, UserRole
from models.base import Base

revision = "20260921_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind)


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind)
