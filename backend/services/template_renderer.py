"""Template-based WhatsApp message rendering.

Templates use ``{{variable}}`` placeholders, e.g.::

    Dear {{name}}, your membership {{member_code}} is now active.

Rendering is deliberately forgiving: unknown variables render as empty
strings rather than failing a whole bulk send, and extra variables are
ignored. This matches WhatsApp template semantics where a missing param
degrades one message, not a campaign.
"""

import re
from typing import Mapping

PLACEHOLDER = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}")


def render(content: str, variables: Mapping[str, object] | None = None) -> str:
    """Substitute ``{{name}}`` placeholders with values (missing → '')."""
    if not variables:
        return PLACEHOLDER.sub("", content or "")
    return PLACEHOLDER.sub(
        lambda m: str(variables.get(m.group(1), "")), content or ""
    )


def template_variables(template_content: str) -> list[str]:
    """The placeholder names a template expects (deduplicated, in order)."""
    seen: list[str] = []
    for match in PLACEHOLDER.finditer(template_content or ""):
        if match.group(1) not in seen:
            seen.append(match.group(1))
    return seen
