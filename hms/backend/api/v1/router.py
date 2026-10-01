from fastapi import APIRouter, Depends
from api.deps import read_guard
from api.v1.endpoints import (
    auth, masters, users, members, receipts,
    magazines, events, engagements, notifications,
    system, activity, reports, approvals, imports, dashboard, kyc
)

api_router = APIRouter()

# Auth (no auth required)
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])

# Public, token-authenticated KYC update flow
api_router.include_router(kyc.router, prefix="/kyc", tags=["kyc"])

# Core modules
api_router.include_router(masters.router, prefix="/masters", tags=["masters"], dependencies=[Depends(read_guard("masters"))])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(members.router, prefix="/members", tags=["members"], dependencies=[Depends(read_guard("members"))])
api_router.include_router(receipts.router, prefix="/receipts", tags=["receipts"], dependencies=[Depends(read_guard("receipts"))])
api_router.include_router(magazines.router, prefix="/magazines", tags=["magazines"], dependencies=[Depends(read_guard("magazines"))])

# Operations
api_router.include_router(events.router, prefix="/events", tags=["events"], dependencies=[Depends(read_guard("events"))])
api_router.include_router(engagements.router, prefix="/engagements", tags=["engagements"], dependencies=[Depends(read_guard("engagements"))])
api_router.include_router(notifications.router, prefix="/notifications", tags=["notifications"], dependencies=[Depends(read_guard("notifications", exempt_prefixes=("/inbox", "/devices")))])
api_router.include_router(approvals.router, prefix="/approvals", tags=["approvals"], dependencies=[Depends(read_guard("approvals"))])
api_router.include_router(imports.router, prefix="/imports", tags=["imports"])
api_router.include_router(dashboard.router, prefix="/dashboard", tags=["dashboard"])

# Reports
api_router.include_router(reports.router, prefix="/reports", tags=["reports"], dependencies=[Depends(read_guard("reports"))])

# System / Admin
api_router.include_router(system.router, prefix="/system", tags=["system"], dependencies=[Depends(read_guard("system"))])
api_router.include_router(activity.router, prefix="/activity", tags=["activity"], dependencies=[Depends(read_guard("activity"))])
