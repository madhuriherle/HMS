
from fastapi import APIRouter

from . import administration, documents, finance, geography, membership, personal

router = APIRouter()
router.include_router(geography.router)
router.include_router(membership.router)
router.include_router(documents.router)
router.include_router(finance.router)
router.include_router(personal.router)
router.include_router(administration.router)
