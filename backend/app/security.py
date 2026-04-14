from __future__ import annotations

from datetime import UTC, datetime, timedelta
from hashlib import sha256
from secrets import token_hex
from uuid import uuid4

from passlib.context import CryptContext

from app.config import get_settings

password_context = CryptContext(schemes=["argon2"], deprecated="auto")


def normalize_username(value: str) -> str:
    return value.strip().lower()


def validate_username(value: str) -> bool:
    import re

    return bool(re.fullmatch(r"[a-z0-9_-]{3,20}", value))


def hash_password(password: str) -> str:
    return password_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return password_context.verify(password, password_hash)


def generate_row_id() -> str:
    return str(uuid4())


def generate_session_token() -> str:
    return token_hex(32)


def build_session_expiry() -> datetime:
    settings = get_settings()
    return datetime.now(UTC) + timedelta(seconds=settings.session_max_age_seconds)


def hash_session_token(token: str) -> str:
    settings = get_settings()
    return sha256(f"{settings.session_secret}:{token}".encode("utf-8")).hexdigest()
