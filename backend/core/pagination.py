from typing import Generic, TypeVar, List, Optional, Set
import decimal

from pydantic import BaseModel
from sqlalchemy import inspect as sa_inspect

T = TypeVar("T")

class PaginatedResponse(BaseModel, Generic[T]):
    total: int
    page: int
    limit: int
    pages: int
    data: List[T]

def _jsonable(value):
    """Coerce values pydantic can't serialise (datetime → ISO string, etc.)."""
    import datetime as _dt

    if isinstance(value, (_dt.datetime, _dt.date)):
        return value.isoformat()
    if isinstance(value, _dt.timedelta):
        return value.total_seconds()
    if isinstance(value, decimal.Decimal):
        return float(value)
    return value


def _to_plain(obj, exclude: Set[str]):
    """ORM row → plain dict of its mapped columns.

    FastAPI serialises `-> Any` responses through pydantic, which cannot
    handle live ORM instances, so paginated results are converted here.
    """
    if not hasattr(obj, "__mapper__"):
        return obj
    state = sa_inspect(obj)
    return {
        prop.key: _jsonable(getattr(obj, prop.key))
        for prop in state.mapper.column_attrs
        if prop.key not in exclude
    }

MAX_PAGE_SIZE = 25000

def paginate(query, page: int = 1, limit: int = 20, exclude: Optional[Set[str]] = None) -> dict:
    """Helper to paginate a SQLAlchemy query (limit is clamped)."""
    page = max(1, int(page))
    limit = max(1, min(int(limit), MAX_PAGE_SIZE))
    excluded = set(exclude or ())
    total = query.count()
    items = query.offset((page - 1) * limit).limit(limit).all()
    pages = (total + limit - 1) // limit
    return {
        "total": total,
        "page": page,
        "limit": limit,
        "pages": pages,
        "data": [_to_plain(item, excluded) for item in items]
    }
