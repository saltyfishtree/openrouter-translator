from __future__ import annotations

from datetime import UTC, datetime, timedelta
from hashlib import sha256
from secrets import token_hex
from uuid import uuid4

from passlib.context import CryptContext

from app.config import get_settings

# argon2 是目前推荐的密码哈希算法，比 bcrypt 更安全
password_context = CryptContext(schemes=["argon2"], deprecated="auto")


def normalize_username(value: str) -> str:
    """将用户名规范化：去除首尾空格并转小写。"""
    return value.strip().lower()


def validate_username(value: str) -> bool:
    """校验用户名格式：3-20 位字母、数字、下划线或横线。"""
    import re
    return bool(re.fullmatch(r"[a-z0-9_-]{3,20}", value))


def hash_password(password: str) -> str:
    """使用 argon2 对明文密码进行哈希处理。"""
    return password_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """验证明文密码是否与 argon2 哈希匹配。"""
    return password_context.verify(password, password_hash)


def generate_row_id() -> str:
    """生成一个随机 UUID 字符串作为数据库主键。"""
    return str(uuid4())


def generate_session_token() -> str:
    """生成 64 字节的随机 hex 字符串作为 session token 明文（不存入数据库）。"""
    return token_hex(32)


def build_session_expiry() -> datetime:
    """根据配置计算 session 过期时间（默认 30 天后）。"""
    settings = get_settings()
    return datetime.now(UTC) + timedelta(seconds=settings.session_max_age_seconds)


def hash_session_token(token: str) -> str:
    """将 session token 明文用 HMAC-SHA256 哈希后存入数据库，防止 token 泄露。"""
    settings = get_settings()
    return sha256(f"{settings.session_secret}:{token}".encode("utf-8")).hexdigest()
