"""Masters API router.

The master screens are split by domain under ``master_settings`` while this
module preserves the existing import path and /masters URL prefix.
"""

from api.v1.endpoints.master_settings import router
