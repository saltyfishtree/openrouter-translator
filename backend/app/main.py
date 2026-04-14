from __future__ import annotations

import json
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Annotated

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.database import Base, engine, get_db
from app.models import InviteCode, User
from app.schemas import (
    AuthPayload,
    HealthResponse,
    RegisterPayload,
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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="当前模型不在允许列表中。")

    async def stream_translation():
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
                    "messages": [
                        {"role": "system", "content": build_system_prompt(payload)},
                        {"role": "user", "content": payload.source_text},
                    ],
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
                        yield chunk.encode("utf-8")

    return StreamingResponse(
        stream_translation(),
        media_type="text/plain; charset=utf-8",
        headers={"Cache-Control": "no-cache, no-transform"},
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(_, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.detail},
    )
