"""One place for the data rules the backend enforces and the screens show.

The screens fetch these from GET /meta/rules instead of keeping their own copies, so a rule changed
here changes everywhere (the forms and the server can never disagree).
"""

import re
import secrets
import time

from core.security import MIN_PASSWORD_LENGTH

# ── formats ──────────────────────────────────────────────────
MOBILE_MIN_DIGITS = 10
MOBILE_MAX_DIGITS = 12
AADHAAR_DIGITS = 12
PINCODE_DIGITS = 6
PAN_PATTERN = r"^[A-Z]{5}[0-9]{4}[A-Z]$"
EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
USERNAME_MIN_LENGTH = 3
USERNAME_PATTERN = r"^[A-Za-z0-9._]+$"
MIN_MEMBER_AGE = 18
AMOUNT_MAX = 9_999_999_999.99  # NUMERIC(12,2)
FINANCIAL_YEAR_START_MONTH = 4  # April

# ── fixed lists ──────────────────────────────────────────────
GENDERS = ["MALE", "FEMALE", "OTHER"]
NAME_TITLES = ["SRI.", "MS."]
BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"]
APPLIED_ON_BEHALF_OF = ["Self", "Family", "Father", "Mother", "Son", "Daughter", "Spouse", "Relative", "Others"]
MEMBER_CATEGORIES = ["Individual", "Family", "Institutional", "Senior Citizen", "Corporate", "General"]
MEMBERSHIP_TYPE_CATEGORIES = [
    "Only Havyaka Mahasabha Membership",
    "Havyaka Mahasabha Membership & Mangalya Registration",
]


def as_dict() -> dict:
    return {
        "mobile": {"min_digits": MOBILE_MIN_DIGITS, "max_digits": MOBILE_MAX_DIGITS},
        "aadhaar": {"digits": AADHAAR_DIGITS},
        "pincode": {"digits": PINCODE_DIGITS},
        "pan": {"pattern": PAN_PATTERN},
        "email": {"pattern": EMAIL_PATTERN},
        "username": {"min_length": USERNAME_MIN_LENGTH, "pattern": USERNAME_PATTERN},
        "password": {
            "min_length": MIN_PASSWORD_LENGTH,
            "needs": ["uppercase", "lowercase", "number", "symbol"],
            "message": f"Password must be at least {MIN_PASSWORD_LENGTH} characters and include uppercase, lowercase, number, and symbol",
        },
        "member": {"min_age": MIN_MEMBER_AGE},
        "amount": {"max": AMOUNT_MAX},
        "financial_year": {"start_month": FINANCIAL_YEAR_START_MONTH},
        "genders": GENDERS,
        "name_titles": NAME_TITLES,
        "blood_groups": BLOOD_GROUPS,
        "applied_on_behalf_of": APPLIED_ON_BEHALF_OF,
        "member_categories": MEMBER_CATEGORIES,
        "membership_type_categories": MEMBERSHIP_TYPE_CATEGORIES,
    }


def make_code(name: str, prefix_len: int = 4) -> str:
    """A short unique-enough code from a name when the client did not send one: 'Hostel Fund' -> 'HOST4F2A91'."""
    letters = re.sub(r"[^A-Za-z0-9]", "", str(name or "")).upper()[:prefix_len] or "ITEM"
    return f"{letters}{str(int(time.time()))[-3:]}{secrets.token_hex(2).upper()}"
