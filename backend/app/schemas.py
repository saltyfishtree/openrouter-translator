from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class HealthResponse(BaseModel):
    ok: bool = True


class AuthPayload(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=8)


class RegisterPayload(AuthPayload):
    invite_code: str = Field(alias="inviteCode", min_length=1)


class UserResponse(BaseModel):
    username: str
    model_config = ConfigDict(from_attributes=True)


class TranslatePayload(BaseModel):
    model: str = Field(min_length=1)
    source_language: str = Field(alias="sourceLanguage", min_length=1)
    target_language: str = Field(alias="targetLanguage", min_length=1)
    translation_style: str = Field(alias="translationStyle", min_length=1)
    source_text: str = Field(alias="sourceText", min_length=1, max_length=12000)
    thread_id: str | None = Field(alias="threadId", default=None, min_length=1)
    context_depth: int = Field(alias="contextDepth", default=6, ge=0, le=20)


class TranslationThreadResponse(BaseModel):
    id: str
    title: str
    created_at: datetime
    updated_at: datetime
    last_preview: str = Field(alias="lastPreview")
    message_count: int = Field(alias="messageCount")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class TranslationMessageResponse(BaseModel):
    id: str
    thread_id: str = Field(alias="threadId")
    model: str
    source_language: str = Field(alias="sourceLanguage")
    target_language: str = Field(alias="targetLanguage")
    translation_style: str = Field(alias="translationStyle")
    source_text: str = Field(alias="sourceText")
    translated_text: str = Field(alias="translatedText")
    created_at: datetime = Field(alias="createdAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)
