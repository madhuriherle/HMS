"""Every icon a seeded module uses must exist in the front-end icon list (sidebar + icon picker)."""

import re
from pathlib import Path


def _frontend_icon_names():
    src = Path(__file__).resolve().parents[2] / "frontend" / "src" / "utils" / "menuIcons.js"
    block = src.read_text(encoding="utf8").split("export const MENU_ICONS = {", 1)[1].split("};", 1)[0]
    return set(re.findall(r"^\s*'?([a-z0-9-]+)'?\s*:", block, flags=re.MULTILINE))


def test_seeded_module_icons_can_be_drawn():
    from db.seed_defaults import MENU_PAGE_CATALOG, MODULE_CATALOG

    available = _frontend_icon_names()
    assert {"layout-dashboard", "database", "users", "check-circle"} <= available, "the icon list was read"
    used = {row[4] for row in MODULE_CATALOG if row[4]} | {row[4] for row in MENU_PAGE_CATALOG if row[4]}
    missing = sorted(used - available)
    assert not missing, f"icons used by seeded modules but missing from frontend/src/utils/menuIcons.js: {missing}"
