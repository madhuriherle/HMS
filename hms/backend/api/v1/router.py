from fastapi import APIRouter
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
api_router.include_router(masters.router, prefix="/masters", tags=["masters"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(members.router, prefix="/members", tags=["members"])
api_router.include_router(receipts.router, prefix="/receipts", tags=["receipts"])
api_router.include_router(magazines.router, prefix="/magazines", tags=["magazines"])

# Operations
api_router.include_router(events.router, prefix="/events", tags=["events"])
api_router.include_router(engagements.router, prefix="/engagements", tags=["engagements"])
api_router.include_router(notifications.router, prefix="/notifications", tags=["notifications"])
api_router.include_router(approvals.router, prefix="/approvals", tags=["approvals"])
api_router.include_router(imports.router, prefix="/imports", tags=["imports"])
api_router.include_router(dashboard.router, prefix="/dashboard", tags=["dashboard"])

# Reports
api_router.include_router(reports.router, prefix="/reports", tags=["reports"])

# System / Admin
api_router.include_router(system.router, prefix="/system", tags=["system"])
api_router.include_router(activity.router, prefix="/activity", tags=["activity"])
