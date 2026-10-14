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

# ── sub-modules ──────────────────────────────────────────────
# A module can be split into areas (pages) that each get their own Read / Write / Delete
# privileges, e.g. masters.banks.write. The API keeps asking for the module-level code
# (masters.write); services.permission_areas turns it into the area's code from the request
# path, so one rule covers every route.
# module -> [(sub_module_code, label, [request path prefixes])]
SUB_MODULE_AREAS = {
    "masters": [
        ("masters.location", "Location Setup", ["/masters/states", "/masters/districts", "/masters/taluks", "/masters/postal-codes", "/masters/states-summary", "/masters/districts-summary", "/masters/taluks-summary"]),
        ("masters.membership_types", "Membership Types", ["/masters/membership-types", "/masters/membership-credit-settings", "/masters/usage/membership-types"]),
        ("masters.particulars", "Particulars Master", ["/masters/particulars", "/masters/service-types", "/masters/usage/particulars"]),
        # banks are made and listed from the Payment Mode Setup screen; there is no separate Bank Master screen
        ("masters.payment_modes", "Payment Mode Setup", ["/masters/payment-modes", "/masters/banks"]),
    ],
    # A rule is a path prefix, or (methods, path-regex[, query]) where query is "unapproved" / "not-unapproved"
    # (the approval_status filter of the member list). Paths are relative to /api/v1.
    "members": [
        ("members.list", "Membership List", [
            ("GET", r"^/members/?$", "not-unapproved"),
            ("GET", r"^/members/export-labels/?$"),
            ("GET", r"^/members/documents/\d+/file/?$"),
            ("GET", r"^/members/\d+(/(family|services|donations|profile(/[a-z]+)?|membership-credit|documents|service-optins))?/?$"),
            ("PUT|DELETE", r"^/members/\d+/?$"),
        ]),
        ("members.unapproved", "Unapproved Members", [
            ("GET", r"^/members/?$", "unapproved"),
            ("GET", r"^/members/documents/\d+/file/?$"),
            ("GET", r"^/members/\d+(/(family|services|donations|profile(/[a-z]+)?|membership-credit|documents|service-optins))?/?$"),
            ("PUT|POST", r"^/members/\d+/(approve|request-activation)/?$"),
        ]),
        ("members.register", "Register New Member", [
            ("POST", r"^/members/?$"),
            ("POST", r"^/members/bulk-import(-file)?/?$"),
            ("POST", r"^/members/\d+/(memberships|photo)/?$"),
        ]),
    ],
    "receipts": [
        ("receipts.entry", "Receipt Entry", [
            ("POST", r"^/receipts/?$"),
            ("GET", r"^/receipts/tracking/?$"),  # the entry screen checks existing receipt numbers
            ("GET", r"^/receipts/member-lookup/?$"),  # "who is this membership number?"
            ("GET", r"^/receipts/(next-number|number-check|duplicate-check)/?$"),  # the entry form's own helpers
        ]),
        ("receipts.tracking", "Receipt Tracking", [
            ("GET", r"^/receipts/?$"),
            ("GET", r"^/receipts/(tracking|allocations|day-book)/?$"),
            ("GET", r"^/receipts/\d+(/allocations)?/?$"),
            ("PUT|DELETE", r"^/receipts/\d+/?$"),
            ("POST", r"^/receipts/\d+/(allocate|cancel|refund|payment-transactions)/?$"),
            ("DELETE", r"^/receipts/\d+/allocations/\d+/?$"),
        ]),
        ("receipts.bulk_mapping", "Bulk Receipt Mapping", [
            ("GET", r"^/receipts/unassigned-candidates/?$"),
            ("POST", r"^/receipts/bulk-allocate/?$"),
        ]),
    ],
    "system": [
        ("system.number_formats", "Number Formats", ["/system/number-formats"]),
        # Settings hub tools. Read = look, Write = restore / delete / clear (the Super Admin hands these out)
        # the Organisation Settings page is its own area (its menu page row is the module)
        ("masters.organisation", "Organisation Settings", ["/system/settings"]),
        ("system.recycle_bin", "Recycle Bin", ["/system/recycle-bin"]),
        ("system.cleanup", "Data Cleanup", ["/system/cleanup"]),
    ],
    "engagements": [
        ("engagements.affiliations", "Affiliations", ["/engagements/affiliations"]),
        ("engagements.associates", "Associates", ["/engagements/associates"]),
        ("engagements.press_media", "Press & Media", ["/engagements/press-media"]),
        ("engagements.committee", "Committee", ["/engagements/committee"]),
    ],
}
# Areas that do not have all three actions (default: read, write, delete)
# A page works completely with its own privilege: the reads it needs from other pages are served to the holders of
# these privileges too, read-only. (Writes always stay on the page that owns the data.) Paths are GET requests,
# relative to /api/v1; the codes are the privileges that may use them.
SHARED_READS = [
    # reference lists the screens fill their dropdowns and filters from
    (r"^/masters/(states|districts|taluks|postal-codes)(/.*)?$",
     ["receipts.entry.read", "receipts.tracking.read", "members.list.read", "members.unapproved.read",
      "members.register.write", "reports.read"]),
    (r"^/masters/membership-types(/.*)?$",
     ["receipts.entry.read", "receipts.tracking.read", "members.list.read", "members.unapproved.read",
      "members.register.write", "reports.read"]),
    (r"^/masters/(gotras|qualifications|native-places)(/.*)?$",
     ["members.list.read", "members.unapproved.read", "members.register.write"]),
    (r"^/masters/(particulars|payment-modes|banks)(/.*)?$",
     ["receipts.entry.read", "receipts.tracking.read", "members.register.write", "reports.read"]),
    # the member picker and member checks used by the receipt screens and the registration form
    (r"^/members/?$", ["receipts.entry.read", "receipts.tracking.read", "receipts.bulk_mapping.read", "events.write", "engagements.write"]),
    (r"^/members/lookup/?$", ["receipts.entry.read", "members.register.write"]),
    (r"^/members/duplicate-check/?$", ["members.register.write"]),
    (r"^/members/\d+(/profile(/[a-z]+)?)?/?$", ["receipts.entry.read", "members.register.write"]),
    # existing receipts: the entry form checks numbers and loads a receipt's allocations when it edits one
    (r"^/receipts/?$", ["receipts.entry.read", "members.list.read", "masters.payment_modes.read"]),  # also: member status popup, payment-mode usage counts
    (r"^/receipts/\d+/allocations/?$", ["receipts.entry.read"]),
]

AREA_ACTIONS = {
    "members.unapproved": ("read", "write"),
    "members.register": ("write",),
    "receipts.entry": ("read", "write"),
    "receipts.bulk_mapping": ("read", "write"),
    "system.number_formats": ("read", "write"),
    "masters.organisation": ("read", "write"),
    "system.recycle_bin": ("read", "write"),
    "system.cleanup": ("read", "write"),
}

# Modules whose screens are not built yet: switched off (status = false) by migration 0032
NOT_BUILT_YET = ("notifications", "imports")

# ── modules ──────────────────────────────────────────────────
# (code, name, parent_code, route, icon, display_order, min_rank_level)
MODULE_CATALOG = [
    ("masters", "Masters", None, "/masters", "database", 10, None),
    ("users", "Users", None, None, "users", 20, None),
    ("users.management", "User Management", "users", "/users", "user", 1, None),
    ("roles", "Role Management", "users", "/users/roles", "shield", 2, None),
    ("users.privileges", "Privileges", "users", None, "key", 3, None),  # edited inside Role Management, no page of its own
    ("members", "Membership", None, "/members", "id-card", 30, None),
    ("approvals", "Approvals", None, "/approvals", "check-circle", 35, None),
    ("magazines", "Magazine", None, "/magazines", "book-open", 40, None),
    ("receipts", "Receipts", None, "/receipts", "receipt", 50, None),
    ("reports", "Reports", None, "/reports", "bar-chart", 60, None),
    ("notifications", "Notifications", None, "/notifications", "bell", 70, None),
    ("activity", "Activity Logs", "users", "/dashboard/users/activity", "activity", 5, None),
    ("events", "Events", None, "/events", "calendar", 90, None),
    ("engagements", "Affiliation, Associates & Press", None, "/engagements", "link", 100, None),
    ("imports", "Imports", None, "/imports", "upload", 110, None),
    ("system", "Settings", None, None, "settings", 120, 1),  # holds Organisation Settings (a Masters page) and future screens
]
# Settings tools reached from the System Settings page (no sidebar entry of their own, so no route).
# Data Cleanup is also locked to rank 1 roles, whatever a role is granted.
MODULE_CATALOG += [
    ("system.recycle_bin", "Recycle Bin", "system", None, None, 4, None),
    ("system.cleanup", "Data Cleanup", "system", None, None, 5, 1),
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
    "approvals": "the approval queue",
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
for _m in ("users.privileges",):
    for _a in ("read", "write"):
        PERMISSION_CATALOG.append((f"{_m}.{_a}", _m, f"{_a.title()} {_m}", f"{_a.title()} {_DESC[_m]}"))
PERMISSION_CATALOG.append(("approvals.read", "approvals", "Open the Approvals queue", "See the approval requests waiting for a reviewer"))
PERMISSION_CATALOG += [
    # Meta-permission for reviewing approval requests (maker-checker queue).
    # The backend hardcodes this code (deps.require_permission("approvals.write"),
    # services/approval_notify.py), so it is minted as a single unsplittable
    # code under the approvals module rather than read/write/delete.
    ("approvals.write", "approvals", "Approve requests", "Review and approve/reject pending approval requests"),
    ("activity.read", "activity", "Read activity", f"Read {_DESC['activity']}"),
    ("system.read", "system", "Read system", f"Read {_DESC['system']}"),
    ("system.write", "system", "Write system", f"Edit {_DESC['system']}"),
    ("imports.write", "imports", "Bulk imports", "CSV imports such as postal codes"),
    # Dashboard opener: the endpoint itself is gated on it, while every data
    # block on it keeps following the module reads (members/receipts/...).
    ("dashboard.read", "dashboard", "Open the Dashboard", "See the dashboard summary (each card still follows the module's own read privilege)"),
]

# Read / Write / Delete for every sub-module area
for _module, _areas in SUB_MODULE_AREAS.items():
    for _sub, _label, _paths in _areas:
        for _a in AREA_ACTIONS.get(_sub, ("read", "write", "delete")):
            PERMISSION_CATALOG.append((f"{_sub}.{_a}", _sub, f"{_a.title()} {_label}", f"{_a.title()} {_label.lower()}"))

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
    ("dashboard", "Dashboard", None, "/dashboard", "layout-dashboard", 5, "dashboard.read", None),
    ("members.list", "Membership List", "members", "/dashboard/membership/list", "list", 1, "members.list.read", None),
    ("members.unapproved", "Unapproved Members", "members", "/dashboard/membership/unapproved", "user-check", 2, "members.unapproved.read", None),
    ("members.register", "Register New Member", "members", "/dashboard/membership/register", "user-plus", 3, "members.register.write", None),
    ("members.import", "Member Import", "members", "/dashboard/membership/import", "upload", 4, "members.register.write", None),
    # Final-approval queue: unapproved members who already have a receipt assigned (same privilege as Unapproved Members).
    ("members.assigned", "Assigned for Approval", "approvals", "/dashboard/membership/assigned", "check-circle", 2, "members.unapproved.read", None),
    ("receipts.entry", "Receipt Entry", "receipts", "/dashboard/receipts/entry", "file-plus", 1, "receipts.entry.read", None),
    ("receipts.tracking", "Receipt Tracking", "receipts", "/dashboard/receipts/tracking", "search", 2, "receipts.tracking.read", None),
    ("receipts.bulk_mapping", "Bulk Receipt Mapping", "receipts", "/dashboard/receipts/bulk-mapping", "link", 3, "receipts.bulk_mapping.read", None),
    ("users.modules", "Modules", "users", "/dashboard/users/modules", "layout-grid", 4, None, 1),
    ("masters.location", "Location Setup", "masters", "/dashboard/master/location-setup", "map-pin", 1, "masters.location.read", None),
    ("masters.membership_types", "Membership Types", "masters", "/dashboard/master/membership-type", "badge", 2, "masters.membership_types.read", None),
    ("masters.particulars", "Particulars Master", "masters", "/dashboard/master/receipt-type", "list-checks", 3, "masters.particulars.read", None),
    ("system.hub", "System Settings", "system", "/dashboard/settings", "settings", 0, "system.read", None),
    ("system.number_formats", "Number Formats", "system.hub", "/dashboard/system/number-formats", "list-checks", 2, "system.number_formats.read", None),
    ("masters.organisation", "Organisation Settings", "system.hub", "/dashboard/master/organisation-settings", "building", 1, "system.read", None),
    ("masters.payment_modes", "Payment Mode Setup", "masters", "/dashboard/master/payment-modes", "credit-card", 5, "masters.payment_modes.read", None),
    # Personal Masters screen is switched off for now (also switched off in migration 0025):
    # ("masters.personal", "Personal Masters", "masters", "/dashboard/master/personal-masters", "list-checks", 7, "masters.read", None),
    # parent may list alternatives ("a|b"): the first module code that exists is used
    ("approvals.requests", "Approval Requests", "approvals", "/dashboard/approvals", "check-circle", 1, "approvals.read", None),
    # Magazine module: subscriptions / pauses / returns / label batches live on one tabbed page
    ("magazines.management", "Magazine", "magazines", "/dashboard/magazine", "book-open", 1, "magazines.read", None),
    ("events.management", "Events", "events", "/dashboard/events", "calendar", 1, "events.read", None),
    ("engagements.affiliations", "Affiliations", "engagements", "/dashboard/engagements/affiliations", "users", 1, "engagements.affiliations.read", None),
    ("engagements.associates", "Associates", "engagements", "/dashboard/engagements/associates", "user-check", 2, "engagements.associates.read", None),
    ("engagements.press_media", "Press & Media", "engagements", "/dashboard/engagements/press-media", "newspaper", 3, "engagements.press_media.read", None),
    ("engagements.committee", "Managing Committee", "engagements", "/dashboard/engagements/committee", "shield", 4, "engagements.committee.read", None),
    ("reports.management", "Reports", "reports", "/dashboard/reports", "bar-chart", 1, "reports.read", None),
]

# Older rows were seeded with API-style routes; point them at the real pages,
# but only while they still hold the old value (so admin edits are kept).
# code -> (old route, new route)
# Renames, applied only while the row still has the old name (admin renames are kept).
# code -> (old name, new name)
MENU_NAME_FIXES = {
    "members.unapproved": ("Unapproved Membership", "Unapproved Members"),
    "system": ("System", "Settings"),
}

# Pages moved to a new group: code -> (old parent, new parent, new order). Applied only while the row is
# still under the old parent, so a move an admin made by hand is kept.
MENU_MOVES = {
    "masters.organisation": ("masters", "system", 1),
    "members.assigned": ("members", "approvals", 2),
}
# Pages nested one level deeper, under another page (the System Settings page holds its tools). Same rule as MENU_MOVES.
MENU_NEST = {
    "masters.organisation": ("system", "system.hub", 1),
    "system.number_formats": ("system", "system.hub", 2),
}
# Order changes, applied only while the row still has the old order: code -> (old, new)
MENU_ORDER_FIXES = {
    "system.number_formats": (3, 2),
    "system.files": (1, 3),  # make room: Organisation Settings 1, Number Formats 2
    "system.error_logs": (2, 4),
}
# Page privilege changes, applied only while the row still has the old one: code -> (old, new)
MENU_PERMISSION_FIXES = {
    "system.number_formats": ("system.read", "system.number_formats.read"),
    "masters.organisation": ("system.read", "masters.organisation.read"),
    # the dashboard opens only for roles holding dashboard.read (migration 0046);
    # applied only while the row still has no privilege, so admin edits are kept.
    "dashboard": (None, "dashboard.read"),
}

MENU_ROUTE_FIXES = {
    "users.management": ("/users", "/dashboard/users/list"),
    "roles": ("/users/roles", "/dashboard/users/roles"),
    "users.privileges": ("/users/privileges", None),  # privileges are edited inside Role Management
    "events": ("/events", None),
    "engagements": ("/engagements", None),
    "engagements.affiliations": (None, "/dashboard/engagements/affiliations"),
    "engagements.associates": (None, "/dashboard/engagements/associates"),
    "engagements.press_media": (None, "/dashboard/engagements/press-media"),
    "engagements.committee": (None, "/dashboard/engagements/committee"),
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
        parent_row = next((rows[c] for c in (parent or '').split('|') if c in rows), None) if parent else None
        if parent and not parent_row:
            logger.error("Menu page '%s' references unknown parent module '%s' - skipped.", code, parent)
            continue
        row = Module(
            code=code, name_en=name, route=route, icon=icon, display_order=order,
            permission_code=perm, min_rank_level=min_rank,
            parent_id=parent_row.id if parent_row else None,
        )
        db.add(row)
        db.flush()  # a page may be the parent of the next one
        rows[code] = row
        created += 1
    for code, (old, new) in MENU_ROUTE_FIXES.items():
        m = rows.get(code)
        if m is not None and m.route == old:
            m.route = new
    for code, (old, new) in MENU_NAME_FIXES.items():
        m = rows.get(code)
        if m is not None and m.name_en == old:
            m.name_en = new
    for code, (old_parent, new_parent, order) in MENU_MOVES.items():
        m, old_row, new_row = rows.get(code), rows.get(old_parent), rows.get(new_parent)
        if m is not None and old_row is not None and new_row is not None and m.parent_id == old_row.id:
            m.parent_id, m.display_order = new_row.id, order
    for code, (old_parent, new_parent, order) in MENU_NEST.items():
        m, old_row, new_row = rows.get(code), rows.get(old_parent), rows.get(new_parent)
        if m is not None and old_row is not None and new_row is not None and m.parent_id == old_row.id:
            m.parent_id, m.display_order = new_row.id, order
    for code, (old, new) in MENU_ORDER_FIXES.items():
        m = rows.get(code)
        if m is not None and m.display_order == old:
            m.display_order = new
    for code, (old, new) in MENU_PERMISSION_FIXES.items():
        m = rows.get(code)
        if m is not None and m.permission_code == old:
            m.permission_code = new
    db.commit()
    return created


# ── personal master starter values ───────────────────────────
GOTRA_VALUES = [
    "Vasista", "Vishwamitra", "Kashyapa", "Aangiras",
    "Goutama", "Jamadagni", "Bharadwaja", "Mouna Bharghava",
]

QUALIFICATION_VALUES = [
    "BE", "BTech", "MBA", "MCA", "ME", "MTech", "MS Eng", "CA", "CS", "MBBS", "MD", "MS Med",
    "MSc", "MCom", "MA", "MFA", "ML", "BCom", "BSc", "BCA", "BBA", "BA", "BDS", "BFA", "BArch",
    "BFD", "BDes", "BJMC", "LLB", "BAMS", "BPharm", "PhD", "Diploma", "ICWA", "MPharm", "BHMS",
    "BHM", "BSc in Nursing", "MSc in Nursing", "BL", "MHA", "BLA", "BSc MLT", "MSc MLT", "BNYS",
    "BPT", "MPT", "MPED", "PUC", "HIGH SCHOOL", "OTHERS", "ANY",
]


def seed_personal_master_values(db) -> int:
    """Load the starter gotras and qualifications, but only into a master that
    has no rows yet (an admin's own list is never touched). Returns rows added."""
    from models.masters import Gotra, Qualification

    added = 0
    for model, values in ((Gotra, GOTRA_VALUES), (Qualification, QUALIFICATION_VALUES)):
        if db.query(model).filter(model.is_deleted == False).count():  # noqa: E712
            continue
        for name in values:
            db.add(model(name_en=name, status=True))
            added += 1
    db.commit()
    return added


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


def seed_lookup_values(db) -> int:
    """Fill each lookup list that has no rows yet (an edited list is never touched). Returns rows added."""
    from db.lookup_seed import LOOKUP_DEFAULTS
    from models.masters import LookupValue

    present = {
        row[0] for row in db.query(LookupValue.list_code).filter(LookupValue.is_deleted == False).distinct().all()  # noqa: E712
    }
    added = 0
    for list_code, entries in LOOKUP_DEFAULTS.items():
        if list_code in present:
            continue
        for order, (code, label, extra) in enumerate(entries, start=1):
            db.add(LookupValue(list_code=list_code, code=code, label=label, extra=extra, sort_order=order, status=True))
            added += 1
    if added:
        db.commit()
    return added


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
