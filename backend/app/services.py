from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from supabase import Client

from app.security import (
    build_session_expiry,
    generate_row_id,
    generate_session_token,
    hash_session_token,
)


def normalize_invite_code(value: str) -> str:
    """规范化邀请码：去除首尾空格并转小写。"""
    return value.strip().lower()


def invite_codes_from_env(raw_codes: str) -> list[str]:
    """从逗号分隔的字符串中解析邀请码列表，自动去重、去空。"""
    seen: set[str] = set()
    result: list[str] = []
    for item in raw_codes.split(","):
        normalized = normalize_invite_code(item)
        if normalized and normalized not in seen:
            seen.add(normalized)
            result.append(normalized)
    return result


def sync_default_invites(supabase: Client, codes: list[str]) -> None:
    """将默认邀请码写入数据库（幂等：已存在的不重复写）。"""
    for code in codes:
        existing = supabase.table("invite_codes").select("id").eq("code", code).execute()
        if not existing.data:
            supabase.table("invite_codes").insert(
                {"id": generate_row_id(), "code": code}
            ).execute()


def create_session_for_user(supabase: Client, user: dict[str, Any]) -> str:
    """为指定用户创建新 session，返回明文 token（只在此函数中出现）。"""
    token = generate_session_token()
    supabase.table("sessions").insert(
        {
            "id": generate_row_id(),
            "token_hash": hash_session_token(token),
            "user_id": user["id"],
            "expires_at": build_session_expiry().isoformat(),
        }
    ).execute()
    return token


def resolve_user_from_session(
    supabase: Client, token: str | None
) -> dict[str, Any] | None:
    """根据 Cookie 中的 session token 查找对应用户，过期或无效返回 None。"""
    if not token:
        return None

    result = supabase.table("sessions").select("*").eq(
        "token_hash", hash_session_token(token)
    ).execute()

    if not result.data:
        return None

    session = result.data[0]
    expires_raw = session["expires_at"]
    expires_at = (
        datetime.fromisoformat(expires_raw.replace("Z", "+00:00"))
        if isinstance(expires_raw, str)
        else expires_raw
    )
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)

    if expires_at <= datetime.now(UTC):
        supabase.table("sessions").delete().eq("id", session["id"]).execute()
        return None

    user_result = supabase.table("users").select("*").eq(
        "id", session["user_id"]
    ).execute()
    return user_result.data[0] if user_result.data else None


def delete_session(supabase: Client, token: str | None) -> None:
    """根据 token 明文删除对应的 session 记录（退出登录）。"""
    if not token:
        return
    supabase.table("sessions").delete().eq(
        "token_hash", hash_session_token(token)
    ).execute()
