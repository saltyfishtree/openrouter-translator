from __future__ import annotations

from datetime import UTC, datetime
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import InviteCode, Session as UserSession, User
from app.security import (
    build_session_expiry,
    generate_row_id,
    generate_session_token,
    hash_session_token,
    normalize_username,
)


def normalize_invite_code(value: str) -> str:
    """规范化邀请码：去除首尾空格并转小写。"""
    return value.strip().lower()


def invite_codes_from_env(raw_codes: str) -> list[str]:
    """
    从逗号分隔的字符串中解析邀请码列表。
    自动去重、去空，保持原始顺序。
    """
    seen: set[str] = set()
    result: list[str] = []
    for item in raw_codes.split(","):
        normalized = normalize_invite_code(item)
        if normalized and normalized not in seen:
            seen.add(normalized)
            result.append(normalized)
    return result


def sync_default_invites(db: Session, codes: Iterable[str]) -> None:
    """
    将默认邀请码写入数据库（幂等：已存在的不重复写）。
    每次应用启动时调用，确保配置中的邀请码始终可用。
    """
    for code in codes:
        existing = db.scalar(select(InviteCode).where(InviteCode.code == code))
        if existing is None:
            db.add(InviteCode(id=generate_row_id(), code=code))
    db.commit()


def create_session_for_user(db: Session, user: User) -> str:
    """
    为指定用户创建一个新 session，将 token 哈希存入数据库，返回明文 token。
    明文 token 只在此函数中存在，之后只有哈希值留在服务端。
    """
    token = generate_session_token()
    db.add(
        UserSession(
            id=generate_row_id(),
            token_hash=hash_session_token(token),
            user_id=user.id,
            expires_at=build_session_expiry(),
        )
    )
    db.commit()
    return token


def resolve_user_from_session(db: Session, token: str | None) -> User | None:
    """
    根据 Cookie 中的 session token 查找对应用户。
    若 token 不存在、无效或已过期，返回 None 并自动清理过期记录。
    """
    if not token:
        return None

    session = db.scalar(
        select(UserSession).where(UserSession.token_hash == hash_session_token(token))
    )

    if session is None:
        return None

    if session.expires_at <= datetime.now(UTC):
        # session 已过期，从数据库删除，强制用户重新登录
        db.delete(session)
        db.commit()
        return None

    return db.get(User, session.user_id)


def delete_session(db: Session, token: str | None) -> None:
    """根据 token 明文删除对应的 session 记录（退出登录）。"""
    if not token:
        return
    session = db.scalar(
        select(UserSession).where(UserSession.token_hash == hash_session_token(token))
    )
    if session is not None:
        db.delete(session)
        db.commit()


def username_exists(db: Session, username: str) -> bool:
    """检查用户名是否已存在（规范化后比较）。"""
    normalized = normalize_username(username)
    return db.scalar(select(User).where(User.username == normalized)) is not None
