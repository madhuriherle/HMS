"""Default modules, privileges and roles — seed DATA, not runtime logic.

Access model (mirrors the Anegudde inventory system):

* A user has exactly ONE role (``users.role_id``).
* A role has a ``rank_level`` (1 = top, larger = weaker) and an optional
  ``is_all_access`` flag. Users and roles can only be managed by someone with a
  strictly smaller rank_level.
* Privileges are ``<module>.read`` / ``<module>.write`` / ``<module>.delete``
  (``users.management``, ``roles`` and ``users.privileges`` are the Users
  group sub-modules). Roles are granted privileges through ``role_permissions``
  (which also carries the per-grant ``requires_approval`` maker-checker flag).
* Modules form a tree (sidebar menu). A module can be disabled (status) or
  restricted to roles with ``rank_level <= min_rank_level``; both apply to
  every privilege linked to it.

The `modules`, `permissions` and `roles` TABLES are the source of truth: the
menu, privilege tree, rank gates and role screens all read them, and Rank 1
manages them through the API. This file only supplies the starting rows. It is
applied by migration 0015, by ``python scripts/seed_defaults.py`` on a fresh
database, and by the test fixtures — never on application startup.
"""

import logging

logger = logging.getLogger("hms.seed")

# ── modules ──────────────────────────────────────────────────
# (code, name, parent_code, route, icon, display_order, min_rank_level)
MODULE_CATALOG = [
    ("masters", "Masters", None, "/masters", "database", 10, None),
    ("users", "Users", None, None, "users", 20, None),
    ("users.management", "User Management", "users", "/users", "user", 1, None),
    ("roles", "Role Management", "users", "/users/roles", "shield", 2, None),
    ("users.privileges", "Privileges", "users", "/users/privileges", "key", 3, None),
    ("members", "Membership", None, "/members", "id-card", 30, None),
    ("members.approvals", "Approvals & Receipt Mapping", "members", "/members/approvals", "check-circle", 35, None),
    ("magazines", "Magazine", None, "/magazines", "book-open", 40, None),
    ("receipts", "Receipts", None, "/receipts", "receipt", 50, None),
    ("reports", "Reports", None, "/reports", "bar-chart", 60, None),
    ("notifications", "Notifications", None, "/notifications", "bell", 70, None),
    ("activity", "Activity Logs", None, "/activity", "activity", 80, None),
    ("events", "Events", None, "/events", "calendar", 90, None),
    ("engagements", "Affiliation, Associates & Press", None, "/engagements", "link", 100, None),
    ("imports", "Imports", None, "/imports", "upload", 110, None),
    ("system", "System", None, "/system", "settings", 120, 1),
]

_READ_WRITE_DELETE = (
    "masters", "users.management", "roles", "members", "magazines", "receipts",
    "reports", "notifications", "events", "engagements",
)
_DESC = {
    "masters": "masters, membership types and personal-master lookups",
    "users.management": "users",
    "roles": "roles",
    "users.privileges": "role privilege assignment",
    "members": "members — profile, memberships, documents",
    "members.approvals": "approval requests and receipt mapping",
    "magazines": "magazine subscriptions, pauses, returns and delivery labels",
    "receipts": "receipts and allocations",
    "reports": "reports and saved reports",
    "notifications": "notification templates, campaigns and sends",
    "activity": "user and member activity logs",
    "events": "events, participants and attachments",
    "engagements": "affiliations, associates, press/media and committee records",
    "imports": "bulk imports such as postal codes",
    "system": "files, attachments, error logs and organisation settings",
}

# (code, module, name, description)
PERMISSION_CATALOG = []
for _m in _READ_WRITE_DELETE:
    for _a in ("read", "write", "delete"):
        PERMISSION_CATALOG.append((f"{_m}.{_a}", _m, f"{_a.title()} {_m}", f"{_a.title()} {_DESC[_m]}"))
for _m in ("users.privileges", "members.approvals"):
    for _a in ("read", "write"):
        PERMISSION_CATALOG.append((f"{_m}.{_a}", _m, f"{_a.title()} {_m}", f"{_a.title()} {_DESC[_m]}"))
PERMISSION_CATALOG += [
    # Meta-permission for reviewing approval requests (maker-checker queue).
    # The backend hardcodes this code (deps.require_permission("approvals.write"),
    # services/approval_notify.py), so it is minted as a single unsplittable
    # code under the members.approvals module rather than read/write/delete.
    ("approvals.write", "members.approvals", "Approve requests", "Review and approve/reject pending approval requests"),
    ("activity.read", "activity", "Read activity", f"Read {_DESC['activity']}"),
    ("system.read", "system", "Read system", f"Read {_DESC['system']}"),
    ("system.write", "system", "Write system", f"Edit {_DESC['system']}"),
    ("imports.write", "imports", "Bulk imports", "CSV imports such as postal codes"),
]

# ── organisation settings (singleton row, id = 1) ────────────
# Defaults mirror the Sabha's printed receipt book so the receipt/label
# print-header works out of the box; the office edits everything on the
# Settings screen.
ORGANISATION_SETTINGS_DEFAULTS = {
    "id": 1,
    "name_en": "Sri Akhila Havyaka Mahasabha (R)",
    "name_kn": "ಶ್ರೀ ಅಖಿಲ ಹವ್ಯಕ ಮಹಾಸಭಾ (ರ)",
    "address_en": "101/A, 6th Cross, 11th Main, Malleshwaram, Bengaluru-560003",
    "address_kn": "101/A, 6ನೇ ಅಡ್ಡರಸ್ತೆ, 11ನೇ ಮುಖ್ಯ ರಸ್ತೆ, ಮಲ್ಲೇಶ್ವರಂ, ಬೆಂಗಳೂರು-560003",
    "registration_no": "9001-2015",
    "iso_cert_no": "ISO-OM-2104068",
    "phone": "080-23481913",
    "mobile": "91484 59191",
    "email": "srhavyaka@gmail.com",
    "print_header_enabled": True,
    "receipt_footer_note_en": "Cheques are subject to realisation.",
    "receipt_footer_note_kn": "ಚೆಕ್ಕು ಜಮಾ ಆಗುವವರೆಗೆ ಈ ರಸೀದಿ ಪರಿಗಣಿತವಾಗುವುದಿಲ್ಲ.",
    "president_title_en": "President",
    "president_title_kn": "ಅಧ್ಯಕ್ಷರು",
    "secretary_title_en": "Secretary",
    "secretary_title_kn": "ಕಾರ್ಯದರ್ಶಿಗಳು",
    "pay_mode_cash_en": "Cash",
    "pay_mode_cash_kn": "ನಗದು",
    "pay_mode_cheque_en": "Cheque",
    "pay_mode_cheque_kn": "ಚೆಕ್",
    "pay_mode_dd_en": "D.D.",
    "pay_mode_dd_kn": "ಡಿ.ಡಿ",
    "pay_mode_upi_en": "U.P.I.",
    "pay_mode_upi_kn": "ಯು.ಪಿ.ಐ",
    "notify_email_enabled": True,
    "notify_sms_enabled": True,
    "notify_whatsapp_enabled": True,
}

# Receipt-entry bank dropdown defaults from the printed receipt-entry field list.
BANK_CATALOG = [
    ("KBL_1075", "KBL 1075"),
    ("KBL_1541", "KBL1541"),
    ("SBI", "SBI"),
    ("CANARA_BANK", "CANARA BANK"),
]

# ── roles ────────────────────────────────────────────────────
# (code, name, rank_level, is_all_access, description)
ROLE_CATALOG = [
    ("SUPERADMIN", "Super Admin", 1, True, "Developer / owner account — full access"),
    ("ADMIN", "Admin", 2, False, "Administrator"),
    ("STAFF", "Staff", 4, False, "Office staff"),
    ("MEMBER", "Member", 99, False, "Registered member (login created with the membership)"),
]


def seed_modules(db) -> int:
    """Insert missing modules; fill in tree fields on existing rows that lack
    them. Returns the number created."""
    from models.users import Module

    rows = {m.code: m for m in db.query(Module).filter(Module.is_deleted == False).all()}  # noqa: E712
    created = 0
    for code, name, _parent, route, icon, order, min_rank in MODULE_CATALOG:
        if code in rows:
            m = rows[code]
            if m.route is None and route:
                m.route = route
            if m.icon is None and icon:
                m.icon = icon
            if not m.display_order:
                m.display_order = order
            if m.min_rank_level is None and min_rank is not None:
                m.min_rank_level = min_rank
            continue
        row = Module(code=code, name_en=name, route=route, icon=icon,
                     display_order=order, min_rank_level=min_rank)
        db.add(row)
        rows[code] = row
        created += 1
    db.flush()
    for code, _n, parent, *_rest in MODULE_CATALOG:
        if parent and rows[code].parent_id is None:
            rows[code].parent_id = rows[parent].id
    db.commit()
    return created


# ── sidebar pages ────────────────────────────────────────────
# The web panel's left menu is read from the modules table (GET
# /users/modules/menu). Each page is a child module whose route is the
# front-end path; permission_code is the privilege that shows it.
# (code, name, parent_code, route, icon, display_order, permission_code, min_rank_level)
MENU_PAGE_CATALOG = [
    ("dashboard", "Dashboard", None, "/dashboard", "layout-dashboard", 5, None, None),
    ("members.list", "Membership List", "members", "/dashboard/membership/list", "list", 1, "members.read", None),
    ("members.unapproved", "Unapproved Membership", "members", "/dashboard/membership/unapproved", "user-check", 2, "members.approvals.read", None),
    ("receipts.entry", "Receipt Entry", "receipts", "/dashboard/receipts/entry", "file-plus", 1, "receipts.read", None),
    ("receipts.tracking", "Receipt Tracking", "receipts", "/dashboard/receipts/tracking", "search", 2, "receipts.read", None),
    ("users.modules", "Modules", "users", "/dashboard/users/modules", "layout-grid", 4, None, 1),
    ("masters.location", "Location Setup", "masters", "/dashboard/master/location-setup", "map-pin", 1, "masters.read", None),
    ("masters.membership_types", "Membership Types", "masters", "/dashboard/master/membership-type", "badge", 2, "masters.read", None),
    ("masters.particulars", "Particulars Master", "masters", "/dashboard/master/receipt-type", "list-checks", 3, "masters.read", None),
    ("masters.organisation", "Organisation Settings", "masters", "/dashboard/master/organisation-settings", "building", 4, "system.read", None),
    ("masters.payment_modes", "Payment Mode Setup", "masters", "/dashboard/master/payment-modes", "credit-card", 5, "masters.read", None),
]

# Older rows were seeded with API-style routes; point them at the real pages,
# but only while they still hold the old value (so admin edits are kept).
# code -> (old route, new route)
MENU_ROUTE_FIXES = {
    "users.management": ("/users", "/dashboard/users/list"),
    "roles": ("/users/roles", "/dashboard/users/roles"),
    "users.privileges": ("/users/privileges", None),  # privileges are edited inside Role Management
}


def seed_menu_pages(db) -> int:
    """Insert the sidebar page rows that are missing and repoint old routes.
    Returns the number created. Never overwrites a value an admin has edited."""
    from models.users import Module

    rows = {m.code: m for m in db.query(Module).filter(Module.is_deleted == False).all()}  # noqa: E712
    created = 0
    for code, name, parent, route, icon, order, perm, min_rank in MENU_PAGE_CATALOG:
        if code in rows:
            continue
        parent_row = rows.get(parent) if parent else None
        if parent and not parent_row:
            logger.error("Menu page '%s' references unknown parent module '%s' - skipped.", code, parent)
            continue
        row = Module(
            code=code, name_en=name, route=route, icon=icon, display_order=order,
            permission_code=perm, min_rank_level=min_rank,
            parent_id=parent_row.id if parent_row else None,
        )
        db.add(row)
        rows[code] = row
        created += 1
    for code, (old, new) in MENU_ROUTE_FIXES.items():
        m = rows.get(code)
        if m is not None and m.route == old:
            m.route = new
    db.commit()
    return created


def seed_permissions(db) -> int:
    """Insert any missing permission rows. Returns the number created.

    Requires seed_modules() to have already run: a permission whose module
    code has no matching modules row is skipped (with a logged error).
    """
    from models.users import Permission, Module

    existing = {
        p.code
        for p in db.query(Permission).filter(Permission.is_deleted == False).all()  # noqa: E712
    }
    modules_by_code = {
        m.code: m for m in db.query(Module).filter(Module.is_deleted == False).all()  # noqa: E712
    }
    created = 0
    for code, module, name, description in PERMISSION_CATALOG:
        if code in existing:
            continue
        module_row = modules_by_code.get(module)
        if not module_row:
            logger.error(
                "Permission '%s' references unknown module '%s' — not seeded. "
                "Add it to MODULE_CATALOG first.", code, module,
            )
            continue
        db.add(Permission(module=module, module_id=module_row.id, name=name, code=code, description=description))
        created += 1
    if created:
        db.commit()
    return created


def seed_organisation_settings(db) -> bool:
    """Create the singleton organisation-settings row (id = 1) if missing.
    Returns True when the row was created. Existing rows are never touched —
    the office may have edited them on the Settings screen."""
    from models.system import OrganisationSettings

    row = db.query(OrganisationSettings).filter(OrganisationSettings.id == 1).first()
    if row is not None:
        return False
    db.add(OrganisationSettings(**ORGANISATION_SETTINGS_DEFAULTS))
    db.commit()
    return True


def seed_banks(db) -> int:
    """Create missing bank master rows used by receipt-entry payment mode."""
    from models.masters import Bank

    existing = {
        b.code
        for b in db.query(Bank).filter(Bank.is_deleted == False).all()  # noqa: E712
    }
    created = 0
    for code, name in BANK_CATALOG:
        if code in existing:
            continue
        db.add(Bank(code=code, name_en=name, status=True))
        created += 1
    if created:
        db.commit()
    return created


def seed_roles(db) -> int:
    """Insert missing base roles and keep rank / all-access on the seeded
    ones in sync with the catalog. Returns the number created."""
    from models.users import Role

    rows = {r.code: r for r in db.query(Role).filter(Role.is_deleted == False).all()}  # noqa: E712
    created = 0
    for code, name, rank, all_access, desc in ROLE_CATALOG:
        r = rows.get(code)
        if r is None:
            db.add(Role(code=code, name=name, rank_level=rank, is_all_access=all_access, description=desc))
            created += 1
        elif code == "SUPERADMIN" and (r.rank_level != 1 or not r.is_all_access):
            r.rank_level, r.is_all_access = 1, True
    if created or db.dirty:
        db.commit()
    return created
