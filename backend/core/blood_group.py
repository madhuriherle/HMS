"""One way to write a blood group: A+, A-, B+, B-, AB+, AB-, O+, O-.

The old register wrote them as "O+VE", "A +VE", "AB -VE"; the forms write "A+". Everything stored and shown uses the short form."""
import re
from typing import Optional

_GROUP = re.compile(r"^(AB|A|B|O)([+-])(?:VE)?$")
_WORDS = {"POSITIVE": "+", "POS": "+", "NEGATIVE": "-", "NEG": "-"}


def normalize_blood_group(value: Optional[str]) -> Optional[str]:
    """``"A +VE"`` -> ``"A+"``. Anything that is not a blood group with a sign (for example a bare ``"A"``) is returned as typed, trimmed."""
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    squeezed = re.sub(r"\s+", "", raw.upper())
    for word, sign in _WORDS.items():
        squeezed = squeezed.replace(word, sign)
    m = _GROUP.match(squeezed)
    return f"{m.group(1)}{m.group(2)}" if m else raw
