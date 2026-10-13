"""Starting values for the lookup_values table (the lists the screens used to keep in their own code).

The office owns these rows from then on: seeding only fills a list that has no rows yet, so an edited list is
never touched. Each entry is (code, label, extra).
"""

from db.lookup_countries import COUNTRY_CODES

LOOKUP_DEFAULTS = {
    "child_relations": [("Male", "Son (Male)", None), ("Female", "Daughter (Female)", None), ("Other", "Other", None)],
    "yes_no": [("YES", "YES", None), ("NO", "NO", None)],
    # extra = the colour class of the status chip
    "receipt_statuses": [
        ("UNASSIGNED", "Unassigned", "chip-warn"),
        ("ASSIGNED", "Assigned", "chip-on"),
        ("APPROVED", "Approved", "chip-brand"),
        ("CANCELLED", "Cancelled", "chip-bad"),
    ],
    "organisation_types": [
        (label, label, None) for label in (
            "Non-Profit / Community Trust", "Society / Association", "Charitable Trust",
            "Religious / Cultural Institution", "Educational Trust", "General Organisation",
        )
    ],
    "activity_action_groups": [
        ("IMPORTANT", "Important Actions", None), ("CRUD", "CRUD Actions", None),
        ("AUTH", "Authentication / Logins", None), ("NAVIGATION", "Navigation Activity", None),
    ],
    "activity_statuses": [("SUCCESS", "Success", None), ("FAILED", "Failed", None)],
    "activity_clients": [("Web Admin", "Web Admin", None), ("Mobile App", "Mobile App", None)],
    # extra = the dial code
    "country_codes": [(code, name, dial) for code, name, dial in COUNTRY_CODES],
}
