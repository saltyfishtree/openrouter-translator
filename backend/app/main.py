from __future__ import annotations

import json
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Annotated

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.database import Base, engine, get_db
from app.models import InviteCode, TranslationMessage, TranslationThread, User
from app.schemas import (
    AuthPayload,
    HealthResponse,
    RegisterPayload,
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


def build_system_prompt(payload: TranslatePayload) -> str:
    source_instruction = (
        "Automatically detect the source language."
        if payload.source_language == "auto"
        else f"The source language is {source_language_label(payload.source_language)}."
    )
    style_instruction = (
        "Prioritize fidelity to the original wording, structure, and nuance."
        if payload.translation_style == "faithful"
        else "Prioritize natural phrasing and readability while preserving meaning."
    )
    return " ".join(
        [
            "You are a professional translation engine.",
            source_instruction,
            f"Translate the user text into {target_language_label(payload.target_language)}.",
            style_instruction,
            "Return only the translation.",
            "Preserve line breaks, lists, names, code blocks, and inline formatting when present.",
        ]
    )


def build_thread_title(text: str) -> str:
    compact = " ".join(text.strip().split())
    if not compact:
        return "未命名翻译会话"
    if len(compact) <= 42:
        return compact
    return f"{compact[:42]}..."


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    with Session(engine) as db:
        settings = get_settings()
        sync_default_invites(db, invite_codes_from_env(settings.default_invite_codes))
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
    db: Annotated[Session, Depends(get_db)],
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
) -> User:
    session_token = request.cookies.get(settings.session_cookie_name)
    user = resolve_user_from_session(db, session_token)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请先登录。")
    return user


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse()


@app.get("/auth/me", response_model=UserResponse)
def auth_me(user: Annotated[User, Depends(current_user_or_401)]) -> UserResponse:
    return UserResponse.model_validate(user)


@app.post("/auth/register")
def auth_register(
    payload: RegisterPayload,
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> JSONResponse:
    sync_default_invites(db, invite_codes_from_env(settings.default_invite_codes))

    username = normalize_username(payload.username)
    if not validate_username(username):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="用户名需为 3-20 位字母、数字、下划线或横线。",
        )

    if db.scalar(select(User).where(User.username == username)) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="用户名已存在。")

    invite_code = normalize_invite_code(payload.invite_code)
    invite = db.scalar(
        select(InviteCode).where(InviteCode.code == invite_code).with_for_update()
    )
    if invite is None or invite.used_at is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="邀请码无效，或者已经被使用。",
        )

    user = User(
        id=generate_row_id(),
        username=username,
        password_hash=hash_password(payload.password),
    )
    try:
        db.add(user)
        db.flush()

        invite.used_at = datetime.now(UTC)
        invite.used_by_id = user.id
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="注册信息冲突，请更换用户名或邀请码后重试。",
        ) from exc

    session_token = create_session_for_user(db, user)
    result = JSONResponse({"ok": True})
    result.set_cookie(
        settings.session_cookie_name, session_token, **cookie_settings(settings)
    )
    return result


@app.post("/auth/login")
def auth_login(
    payload: AuthPayload,
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> JSONResponse:
    username = normalize_username(payload.username)
    user = db.scalar(select(User).where(User.username == username))

    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误。",
        )

    session_token = create_session_for_user(db, user)
    result = JSONResponse({"ok": True})
    result.set_cookie(
        settings.session_cookie_name, session_token, **cookie_settings(settings)
    )
    return result


@app.post("/auth/logout")
def auth_logout(
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
    request: Request,
) -> JSONResponse:
    session_token = request.cookies.get(settings.session_cookie_name)
    delete_session(db, session_token)
    result = JSONResponse({"ok": True})
    result.delete_cookie(settings.session_cookie_name, path="/")
    return result


@app.get("/translations/threads")
def list_translation_threads(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(current_user_or_401)],
) -> list[TranslationThreadResponse]:
    thread_rows = db.execute(
        select(
            TranslationThread,
            func.count(TranslationMessage.id).label("message_count"),
            func.max(TranslationMessage.created_at).label("last_message_time"),
        )
        .outerjoin(
            TranslationMessage, TranslationMessage.thread_id == TranslationThread.id
        )
        .where(TranslationThread.user_id == user.id)
        .group_by(TranslationThread.id)
        .order_by(TranslationThread.updated_at.desc())
        .limit(80)
    ).all()

    threads: list[TranslationThreadResponse] = []
    for thread, message_count, _ in thread_rows:
        last_message = db.scalar(
            select(TranslationMessage)
            .where(TranslationMessage.thread_id == thread.id)
            .order_by(TranslationMessage.created_at.desc())
            .limit(1)
        )
        last_preview = ""
        if last_message is not None:
            last_preview = (
                " ".join(last_message.source_text.strip().split())[:120]
                if last_message.source_text
                else ""
            )

        threads.append(
            TranslationThreadResponse(
                id=thread.id,
                title=thread.title,
                created_at=thread.created_at,
                updated_at=thread.updated_at,
                lastPreview=last_preview,
                messageCount=int(message_count or 0),
            )
        )

    return threads


@app.get("/translations/threads/{thread_id}/messages")
def list_translation_messages(
    thread_id: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(current_user_or_401)],
) -> list[TranslationMessageResponse]:
    thread = db.scalar(
        select(TranslationThread).where(
            TranslationThread.id == thread_id, TranslationThread.user_id == user.id
        )
    )
    if thread is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="会话不存在。")

    messages = db.scalars(
        select(TranslationMessage)
        .where(TranslationMessage.thread_id == thread_id)
        .order_by(TranslationMessage.created_at.asc())
        .limit(500)
    ).all()

    return [
        TranslationMessageResponse(
            id=message.id,
            threadId=message.thread_id,
            model=message.model,
            sourceLanguage=message.source_language,
            targetLanguage=message.target_language,
            translationStyle=message.translation_style,
            sourceText=message.source_text,
            translatedText=message.translated_text,
            createdAt=message.created_at,
        )
        for message in messages
    ]


@app.post("/translate")
async def translate(
    payload: TranslatePayload,
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
    request: Request,
):
    session_token = request.cookies.get(settings.session_cookie_name)
    user = resolve_user_from_session(db, session_token)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请先登录。")

    if payload.model not in MODEL_VALUES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="当前模型不在允许列表中。"
        )

    selected_thread: TranslationThread | None = None
    if payload.thread_id:
        selected_thread = db.scalar(
            select(TranslationThread).where(
                TranslationThread.id == payload.thread_id,
                TranslationThread.user_id == user.id,
            )
        )
        if selected_thread is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="目标翻译会话不存在。"
            )
    else:
        selected_thread = TranslationThread(
            id=generate_row_id(),
            user_id=user.id,
            title=build_thread_title(payload.source_text),
            updated_at=datetime.now(UTC),
        )
        db.add(selected_thread)
        db.flush()

    prior_messages = db.scalars(
        select(TranslationMessage)
        .where(TranslationMessage.thread_id == selected_thread.id)
        .order_by(TranslationMessage.created_at.desc())
        .limit(payload.context_depth)
    ).all()
    prior_messages.reverse()

    prompt_messages: list[dict[str, str]] = [
        {"role": "system", "content": build_system_prompt(payload)}
    ]
    for message in prior_messages:
        prompt_messages.append({"role": "user", "content": message.source_text})
        prompt_messages.append({"role": "assistant", "content": message.translated_text})

    prompt_messages.append({"role": "user", "content": payload.source_text})

    async def stream_translation():
        translated_parts: list[str] = []
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=20.0)) as client:
            async with client.stream(
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
            ) as upstream:
                if upstream.status_code != status.HTTP_200_OK:
                    raise HTTPException(
                        status_code=status.HTTP_502_BAD_GATEWAY,
                        detail="OpenRouter 请求失败，请检查服务端密钥、额度或模型配置。",
                    )

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

                    chunk = (
                        event.get("choices", [{}])[0]
                        .get("delta", {})
                        .get("content")
                    )
                    if chunk:
                        translated_parts.append(chunk)
                        yield chunk.encode("utf-8")

        translated_text = "".join(translated_parts).strip()
        if translated_text:
            db.add(
                TranslationMessage(
                    id=generate_row_id(),
                    thread_id=selected_thread.id,
                    user_id=user.id,
                    model=payload.model,
                    source_language=payload.source_language,
                    target_language=payload.target_language,
                    translation_style=payload.translation_style,
                    source_text=payload.source_text,
                    translated_text=translated_text,
                )
            )
            selected_thread.updated_at = datetime.now(UTC)
            db.commit()

    return StreamingResponse(
        stream_translation(),
        media_type="text/plain; charset=utf-8",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Thread-Id": selected_thread.id,
        },
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(_, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.detail},
    )
