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
