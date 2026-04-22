from __future__ import annotations

import json
from collections import defaultdict
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Annotated

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.responses import JSONResponse, StreamingResponse

from app.config import Settings, get_settings
from app.database import get_supabase
from app.schemas import (
    AuthPayload,
    GlossaryTermPatch,
    GlossaryTermPayload,
    GlossaryTermResponse,
    HealthResponse,
    RegisterPayload,
    RenameThreadPayload,
    TranslationMessageResponse,
    TranslationThreadResponse,
    TranslatePayload,
    UserResponse,
)
from app.security import (
    generate_row_id,
    hash_password,
    normalize_username,
    validate_username,
    verify_password,
)
from app.services import (
    create_session_for_user,
    delete_session,
    invite_codes_from_env,
    normalize_invite_code,
    resolve_user_from_session,
    sync_default_invites,
)

MODEL_VALUES = {
    "openai/gpt-4o",
    "openai/gpt-4o-mini",
    "openai/gpt-5.4-nano",
    "openai/gpt-5.4-mini",
    "google/gemini-3-flash-preview",
}
TASK_MODE_VALUES = {"translate", "polish", "ask"}


def source_language_label(value: str) -> str:
    mapping = {
        "auto": "Automatically detect the source language",
        "Chinese (Simplified)": "Chinese (Simplified)",
        "English": "English",
        "Japanese": "Japanese",
        "Korean": "Korean",
        "French": "French",
        "German": "German",
        "Spanish": "Spanish",
    }
    return mapping.get(value, value)


def target_language_label(value: str) -> str:
    return source_language_label(value)


def language_pair_key(payload: TranslatePayload) -> str:
    src = payload.source_language if payload.source_language else "auto"
    tgt = payload.target_language
    return f"{src}->{tgt}"


def format_glossary_block(terms: list[dict]) -> str:
    if not terms:
        return ""
    lines = []
    for term in terms[:40]:
        source_term = (term.get("source_term") or "").strip()
        target_term = (term.get("target_term") or "").strip()
        note = (term.get("note") or "").strip()
        if not source_term or not target_term:
            continue
        entry = f"- {source_term} → {target_term}"
        if note:
            entry += f" ({note})"
        lines.append(entry)
    if not lines:
        return ""
    return (
        "User glossary (honor these mappings when the source term appears; "
        "do not translate them differently):\n" + "\n".join(lines)
    )


def build_system_prompt(payload: TranslatePayload, glossary_block: str) -> str:
    if payload.task_mode == "polish":
        parts = [
            "You are an expert editor.",
            "Rewrite the user's text into polished, concise, professional English.",
            "Preserve meaning, structure, and factual accuracy; improve grammar, clarity, and flow.",
            "Do not add unsupported claims.",
            glossary_block,
            "Return only the polished text.",
        ]
        return "\n\n".join(p for p in parts if p).strip()

    if payload.task_mode == "ask":
        target_instruction = f"Answer in {target_language_label(payload.target_language)}."
        parts = [
            "You are a helpful assistant.",
            target_instruction,
            "Answer directly and practically. If the question is ambiguous, state your assumption briefly.",
            glossary_block,
        ]
        return "\n\n".join(p for p in parts if p).strip()

    source_instruction = (
        "Detect the source language automatically."
        if payload.source_language == "auto"
        else f"The source language is {source_language_label(payload.source_language)}."
    )
    style_instruction = (
        "Prioritize fidelity to the original wording, structure, and nuance."
        if payload.translation_style == "faithful"
        else "Prioritize natural phrasing and readability while preserving meaning."
    )
    parts = [
        "You are a professional translator.",
        source_instruction,
        f"Translate the user text into {target_language_label(payload.target_language)}.",
        style_instruction,
        "Preserve line breaks, lists, names, code blocks, and inline formatting.",
        glossary_block,
        "Return only the translation.",
    ]
    return "\n\n".join(p for p in parts if p).strip()


def fetch_active_glossary(supabase, user_id: str, pair_key: str) -> list[dict]:
    result = (
        supabase.table("user_terms")
        .select("*")
        .eq("user_id", user_id)
        .order("usage_count", desc=True)
        .order("last_used_at", desc=True)
        .limit(200)
        .execute()
    ).data or []
    filtered = [
        row
        for row in result
        if row.get("language_pair") in ("any", "", None, pair_key)
    ]
    return filtered[:40]


def bump_glossary_usage(supabase, user_id: str, source_text: str, terms: list[dict]) -> None:
    if not terms or not source_text:
        return
    haystack = source_text.lower()
    now_iso = datetime.now(UTC).isoformat()
    for term in terms:
        source_term = (term.get("source_term") or "").strip()
        if not source_term:
            continue
        if source_term.lower() in haystack:
            supabase.table("user_terms").update(
                {
                    "usage_count": (term.get("usage_count") or 0) + 1,
                    "last_used_at": now_iso,
                }
            ).eq("id", term["id"]).eq("user_id", user_id).execute()


def build_thread_title(text: str) -> str:
    compact = " ".join(text.strip().split())
    if not compact:
        return "未命名翻译会话"
    if len(compact) <= 42:
        return compact
    return f"{compact[:42]}..."


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield


app = FastAPI(
    title="OpenRouter Translator API",
    version="1.0.0",
    lifespan=lifespan,
)


def cookie_settings(settings: Settings) -> dict[str, object]:
    return {
        "httponly": True,
        "max_age": settings.session_max_age_seconds,
        "samesite": "lax",
        "secure": settings.app_base_url.startswith("https://"),
        "path": "/",
    }


def current_user_or_401(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict:
    supabase = get_supabase()
    session_token = request.cookies.get(settings.session_cookie_name)
    user = resolve_user_from_session(supabase, session_token)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请先登录。")
    return user


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """健康检查接口，用于 Vercel/负载均衡器确认服务存活。"""
    return HealthResponse()


@app.get("/auth/me", response_model=UserResponse)
def auth_me(user: Annotated[dict, Depends(current_user_or_401)]) -> UserResponse:
    """返回当前登录用户信息。未登录时返回 401。"""
    return UserResponse.model_validate(user)


@app.post("/auth/register")
def auth_register(
    payload: RegisterPayload,
    settings: Annotated[Settings, Depends(get_settings)],
) -> JSONResponse:
    """注册新用户，需要邀请码。邀请码只能使用一次。"""
    supabase = get_supabase()
    sync_default_invites(supabase, invite_codes_from_env(settings.default_invite_codes))

    username = normalize_username(payload.username)
    if not validate_username(username):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="用户名需为 3-20 位字母、数字、下划线或横线。",
        )

    if supabase.table("users").select("id").eq("username", username).execute().data:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="用户名已存在。")

    invite_code = normalize_invite_code(payload.invite_code)
    invite_result = (
        supabase.table("invite_codes").select("*").eq("code", invite_code).execute()
    )
    if not invite_result.data or invite_result.data[0].get("used_at") is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="邀请码无效，或者已经被使用。",
        )

    user_id = generate_row_id()
    supabase.table("users").insert(
        {
            "id": user_id,
            "username": username,
            "password_hash": hash_password(payload.password),
        }
    ).execute()

    # 原子性更新：只有 used_at 为 NULL 时才成功，防止并发注册竞争
    mark_result = (
        supabase.table("invite_codes")
        .update({"used_at": datetime.now(UTC).isoformat(), "used_by_id": user_id})
        .eq("code", invite_code)
        .is_("used_at", "null")
        .execute()
    )
    if not mark_result.data:
        supabase.table("users").delete().eq("id", user_id).execute()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="注册信息冲突，请更换用户名或邀请码后重试。",
        )

    session_token = create_session_for_user(supabase, {"id": user_id, "username": username})
    result = JSONResponse({"ok": True})
    result.set_cookie(settings.session_cookie_name, session_token, **cookie_settings(settings))
    return result


@app.post("/auth/login")
def auth_login(
    payload: AuthPayload,
    settings: Annotated[Settings, Depends(get_settings)],
) -> JSONResponse:
    """登录已有账号，设置 session Cookie。"""
    supabase = get_supabase()
    username = normalize_username(payload.username)
    user_result = supabase.table("users").select("*").eq("username", username).execute()

    user = user_result.data[0] if user_result.data else None
    if user is None or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误。",
        )

    session_token = create_session_for_user(supabase, user)
    result = JSONResponse({"ok": True})
    result.set_cookie(settings.session_cookie_name, session_token, **cookie_settings(settings))
    return result


@app.post("/auth/logout")
def auth_logout(
    settings: Annotated[Settings, Depends(get_settings)],
    request: Request,
) -> JSONResponse:
    """退出登录，清除服务端 session 和 Cookie。"""
    supabase = get_supabase()
    session_token = request.cookies.get(settings.session_cookie_name)
    delete_session(supabase, session_token)
    result = JSONResponse({"ok": True})
    result.delete_cookie(settings.session_cookie_name, path="/")
    return result


@app.get("/translations/threads")
def list_translation_threads(
    user: Annotated[dict, Depends(current_user_or_401)],
    q: str | None = None,
) -> list[TranslationThreadResponse]:
    """列出当前用户的翻译历史会话，支持关键词搜索（匹配标题）。"""
    supabase = get_supabase()
    query = (
        supabase.table("translation_threads")
        .select("*")
        .eq("user_id", user["id"])
        .order("updated_at", desc=True)
        .limit(80)
    )
    if q and q.strip():
        query = query.ilike("title", f"%{q.strip()}%")

    threads = query.execute().data
    if not threads:
        return []

    thread_ids = [t["id"] for t in threads]
    all_msgs = (
        supabase.table("translation_messages")
        .select("id, thread_id, source_text, created_at")
        .in_("thread_id", thread_ids)
        .order("created_at", desc=True)
        .execute()
    ).data

    msgs_by_thread: dict[str, list] = defaultdict(list)
    for msg in all_msgs:
        msgs_by_thread[msg["thread_id"]].append(msg)

    response = []
    for thread in threads:
        thread_msgs = msgs_by_thread[thread["id"]]
        last_msg = thread_msgs[0] if thread_msgs else None
        last_preview = (
            " ".join(last_msg["source_text"].strip().split())[:120] if last_msg else ""
        )
        response.append(
            TranslationThreadResponse(
                id=thread["id"],
                title=thread["title"],
                created_at=thread["created_at"],
                updated_at=thread["updated_at"],
                last_preview=last_preview,
                message_count=len(thread_msgs),
            )
        )
    return response


@app.delete("/translations/threads/{thread_id}", status_code=204)
def delete_translation_thread(
    thread_id: str,
    user: Annotated[dict, Depends(current_user_or_401)],
) -> None:
    """删除指定翻译会话及其所有消息（级联删除由数据库外键保证）。"""
    supabase = get_supabase()
    check = (
        supabase.table("translation_threads")
        .select("id")
        .eq("id", thread_id)
        .eq("user_id", user["id"])
        .execute()
    )
    if not check.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="会话不存在。")
    supabase.table("translation_threads").delete().eq("id", thread_id).execute()


@app.patch("/translations/threads/{thread_id}")
def rename_translation_thread(
    thread_id: str,
    payload: RenameThreadPayload,
    user: Annotated[dict, Depends(current_user_or_401)],
) -> TranslationThreadResponse:
    """重命名指定翻译会话的标题。"""
    supabase = get_supabase()
    check = (
        supabase.table("translation_threads")
        .select("id")
        .eq("id", thread_id)
        .eq("user_id", user["id"])
        .execute()
    )
    if not check.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="会话不存在。")

    updated = (
        supabase.table("translation_threads")
        .update({"title": payload.title.strip()})
        .eq("id", thread_id)
        .execute()
    ).data[0]

    msgs = (
        supabase.table("translation_messages")
        .select("id, source_text, created_at")
        .eq("thread_id", thread_id)
        .order("created_at", desc=True)
        .execute()
    ).data

    last_preview = (
        " ".join(msgs[0]["source_text"].strip().split())[:120] if msgs else ""
    )
    return TranslationThreadResponse(
        id=updated["id"],
        title=updated["title"],
        created_at=updated["created_at"],
        updated_at=updated["updated_at"],
        last_preview=last_preview,
        message_count=len(msgs),
    )


@app.get("/translations/threads/{thread_id}/messages")
def list_translation_messages(
    thread_id: str,
    user: Annotated[dict, Depends(current_user_or_401)],
) -> list[TranslationMessageResponse]:
    """获取指定会话的所有翻译消息，按时间升序排列。"""
    supabase = get_supabase()
    check = (
        supabase.table("translation_threads")
        .select("id")
        .eq("id", thread_id)
        .eq("user_id", user["id"])
        .execute()
    )
    if not check.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="会话不存在。")

    messages = (
        supabase.table("translation_messages")
        .select("*")
        .eq("thread_id", thread_id)
        .order("created_at")
        .limit(500)
        .execute()
    ).data

    return [
        TranslationMessageResponse(
            id=msg["id"],
            thread_id=msg["thread_id"],
            model=msg["model"],
            source_language=msg["source_language"],
            target_language=msg["target_language"],
            translation_style=msg["translation_style"],
            source_text=msg["source_text"],
            translated_text=msg["translated_text"],
            created_at=msg["created_at"],
        )
        for msg in messages
    ]


@app.post("/translate")
async def translate(
    payload: TranslatePayload,
    settings: Annotated[Settings, Depends(get_settings)],
    request: Request,
):
    """发起流式翻译，结束后将原文/译文持久化到数据库。"""
    supabase = get_supabase()
    session_token = request.cookies.get(settings.session_cookie_name)
    user = resolve_user_from_session(supabase, session_token)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请先登录。")

    if payload.model not in MODEL_VALUES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="当前模型不在允许列表中。"
        )
    if payload.task_mode not in TASK_MODE_VALUES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="当前工作模式不受支持。"
        )

    if payload.thread_id:
        thread_result = (
            supabase.table("translation_threads")
            .select("*")
            .eq("id", payload.thread_id)
            .eq("user_id", user["id"])
            .execute()
        )
        if not thread_result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="目标翻译会话不存在。"
            )
        selected_thread = thread_result.data[0]
    else:
        selected_thread = (
            supabase.table("translation_threads")
            .insert(
                {
                    "id": generate_row_id(),
                    "user_id": user["id"],
                    "title": build_thread_title(payload.source_text),
                    "updated_at": datetime.now(UTC).isoformat(),
                }
            )
            .execute()
        ).data[0]

    prior_msgs = (
        supabase.table("translation_messages")
        .select("source_text, translated_text, created_at")
        .eq("thread_id", selected_thread["id"])
        .order("created_at", desc=True)
        .limit(payload.context_depth)
        .execute()
    ).data
    prior_msgs.reverse()

    pair_key = language_pair_key(payload)
    active_terms = fetch_active_glossary(supabase, user["id"], pair_key)
    glossary_block = format_glossary_block(active_terms)
    bump_glossary_usage(supabase, user["id"], payload.source_text, active_terms)

    prompt_messages: list[dict[str, str]] = [
        {"role": "system", "content": build_system_prompt(payload, glossary_block)}
    ]
    for msg in prior_msgs:
        prompt_messages.append({"role": "user", "content": msg["source_text"]})
        prompt_messages.append({"role": "assistant", "content": msg["translated_text"]})
    prompt_messages.append({"role": "user", "content": payload.source_text})

    client = httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=20.0))
    upstream_request = client.build_request(
        "POST",
        "https://openrouter.ai/api/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {settings.openrouter_api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": settings.app_base_url,
            "X-Title": settings.openrouter_app_name,
        },
        json={
            "model": payload.model,
            "stream": True,
            "temperature": 0.2,
            "messages": prompt_messages,
        },
    )
    upstream = await client.send(upstream_request, stream=True)
    if upstream.status_code != status.HTTP_200_OK:
        await upstream.aclose()
        await client.aclose()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="OpenRouter 请求失败，请检查服务端密钥、额度或模型配置。",
        )

    async def stream_translation():
        translated_parts: list[str] = []
        try:
            async for line in upstream.aiter_lines():
                trimmed = line.strip()
                if not trimmed.startswith("data:"):
                    continue
                body = trimmed[5:].strip()
                if not body or body == "[DONE]":
                    continue
                try:
                    event = json.loads(body)
                except json.JSONDecodeError:
                    continue
                chunk = event.get("choices", [{}])[0].get("delta", {}).get("content")
                if chunk:
                    translated_parts.append(chunk)
                    yield chunk.encode("utf-8")
        finally:
            await upstream.aclose()
            await client.aclose()

        translated_text = "".join(translated_parts).strip()
        if translated_text:
            supabase.table("translation_messages").insert(
                {
                    "id": generate_row_id(),
                    "thread_id": selected_thread["id"],
                    "user_id": user["id"],
                    "model": payload.model,
                    "source_language": payload.source_language,
                    "target_language": payload.target_language,
                    "translation_style": payload.translation_style,
                    "source_text": payload.source_text,
                    "translated_text": translated_text,
                }
            ).execute()
            supabase.table("translation_threads").update(
                {"updated_at": datetime.now(UTC).isoformat()}
            ).eq("id", selected_thread["id"]).execute()

    return StreamingResponse(
        stream_translation(),
        media_type="text/plain; charset=utf-8",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Thread-Id": selected_thread["id"],
        },
    )


def _normalize_pair(pair: str | None) -> str:
    value = (pair or "any").strip()
    return value or "any"


def _term_to_response(row: dict) -> GlossaryTermResponse:
    return GlossaryTermResponse(
        id=row["id"],
        source_term=row["source_term"],
        target_term=row["target_term"],
        language_pair=row.get("language_pair") or "any",
        note=row.get("note") or "",
        usage_count=row.get("usage_count") or 0,
        last_used_at=row.get("last_used_at"),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@app.get("/glossary")
def list_glossary(
    user: Annotated[dict, Depends(current_user_or_401)],
) -> list[GlossaryTermResponse]:
    """列出当前用户术语本，按使用次数排序。"""
    supabase = get_supabase()
    rows = (
        supabase.table("user_terms")
        .select("*")
        .eq("user_id", user["id"])
        .order("usage_count", desc=True)
        .order("last_used_at", desc=True)
        .order("updated_at", desc=True)
        .limit(400)
        .execute()
    ).data or []
    return [_term_to_response(row) for row in rows]


@app.post("/glossary", status_code=201)
def create_glossary_term(
    payload: GlossaryTermPayload,
    user: Annotated[dict, Depends(current_user_or_401)],
) -> GlossaryTermResponse:
    """新增或 upsert 一条术语映射。"""
    supabase = get_supabase()
    source_term = payload.source_term.strip()
    target_term = payload.target_term.strip()
    pair = _normalize_pair(payload.language_pair)
    note = (payload.note or "").strip()

    existing = (
        supabase.table("user_terms")
        .select("*")
        .eq("user_id", user["id"])
        .ilike("source_term", source_term)
        .eq("language_pair", pair)
        .execute()
    ).data or []

    now_iso = datetime.now(UTC).isoformat()
    if existing:
        row = existing[0]
        updated = (
            supabase.table("user_terms")
            .update(
                {
                    "target_term": target_term,
                    "note": note,
                    "updated_at": now_iso,
                }
            )
            .eq("id", row["id"])
            .eq("user_id", user["id"])
            .execute()
        ).data[0]
        return _term_to_response(updated)

    inserted = (
        supabase.table("user_terms")
        .insert(
            {
                "id": generate_row_id(),
                "user_id": user["id"],
                "source_term": source_term,
                "target_term": target_term,
                "language_pair": pair,
                "note": note,
                "usage_count": 0,
                "updated_at": now_iso,
            }
        )
        .execute()
    ).data[0]
    return _term_to_response(inserted)


@app.patch("/glossary/{term_id}")
def update_glossary_term(
    term_id: str,
    payload: GlossaryTermPatch,
    user: Annotated[dict, Depends(current_user_or_401)],
) -> GlossaryTermResponse:
    """编辑已有术语条目。"""
    supabase = get_supabase()
    owned = (
        supabase.table("user_terms")
        .select("*")
        .eq("id", term_id)
        .eq("user_id", user["id"])
        .execute()
    ).data
    if not owned:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="术语不存在。")

    patch: dict[str, object] = {}
    if payload.source_term is not None and payload.source_term.strip():
        patch["source_term"] = payload.source_term.strip()
    if payload.target_term is not None and payload.target_term.strip():
        patch["target_term"] = payload.target_term.strip()
    if payload.language_pair is not None:
        patch["language_pair"] = _normalize_pair(payload.language_pair)
    if payload.note is not None:
        patch["note"] = payload.note.strip()

    if not patch:
        return _term_to_response(owned[0])

    patch["updated_at"] = datetime.now(UTC).isoformat()
    updated = (
        supabase.table("user_terms")
        .update(patch)
        .eq("id", term_id)
        .eq("user_id", user["id"])
        .execute()
    ).data[0]
    return _term_to_response(updated)


@app.delete("/glossary/{term_id}", status_code=204)
def delete_glossary_term(
    term_id: str,
    user: Annotated[dict, Depends(current_user_or_401)],
) -> None:
    """删除一条术语。"""
    supabase = get_supabase()
    check = (
        supabase.table("user_terms")
        .select("id")
        .eq("id", term_id)
        .eq("user_id", user["id"])
        .execute()
    )
    if not check.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="术语不存在。")
    supabase.table("user_terms").delete().eq("id", term_id).eq("user_id", user["id"]).execute()


@app.exception_handler(HTTPException)
async def http_exception_handler(_, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.detail},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(_, exc: Exception):
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"error": "服务端内部错误，请稍后重试。"},
    )
