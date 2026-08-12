import uuid
from datetime import UTC, datetime, timedelta


def new_id() -> str:
    """Primary key for nodes and edges."""
    return str(uuid.uuid4())


def utcnow_iso() -> str:
    """UTC timestamp in the same shape the SQLite column defaults produce."""
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def utcnow_shifted(days: int) -> str:
    """A timestamp `days` from now, in the shape the columns store."""
    moment = datetime.now(UTC) + timedelta(days=days)
    return moment.isoformat(timespec="milliseconds").replace("+00:00", "Z")
