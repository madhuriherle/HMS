"""Sorting for list endpoints.

Every list that is not a master shows the newest record first. A list that takes ``sort_by`` and ``sort_dir``
(``asc`` or ``desc``) lets the caller change that; ``sort_by`` must be one of the list's own column names, anything else is
a 400. Ties always fall back to the newest id, so a page never repeats or skips a row.
"""
from typing import Mapping, Optional

from fastapi import HTTPException


def sort_query(query, *, sort_by: Optional[str], sort_dir: Optional[str], allowed: Mapping, newest_first: tuple, tiebreak=None):
    """``allowed``: {name the caller may ask for: column}. ``newest_first``: the columns (already desc) used when
    ``sort_by`` is not given. ``tiebreak``: the id column, always last."""
    direction = (sort_dir or "desc").lower()
    if direction not in ("asc", "desc"):
        raise HTTPException(400, "sort_dir must be asc or desc")
    if sort_by:
        column = allowed.get(sort_by)
        if column is None:
            raise HTTPException(400, f"sort_by must be one of {sorted(allowed)}")
        order = [column.asc() if direction == "asc" else column.desc()]
    else:
        order = list(newest_first)
    if tiebreak is not None:
        order.append(tiebreak.asc() if (sort_by and direction == "asc") else tiebreak.desc())
    return query.order_by(*order)
