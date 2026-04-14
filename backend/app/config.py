from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = Field(alias="DATABASE_URL")
    openrouter_api_key: str = Field(alias="OPENROUTER_API_KEY", min_length=1)
    session_secret: str = Field(alias="AUTH_SECRET", min_length=16)
    default_invite_codes: str = Field(alias="DEFAULT_INVITE_CODES", default="zjxai")
    app_base_url: str = Field(alias="OPENROUTER_SITE_URL", default="http://localhost:3000")
    openrouter_app_name: str = Field(
        alias="OPENROUTER_APP_NAME", default="OpenRouter Translator"
    )
    session_cookie_name: str = "translator_session"
    session_max_age_seconds: int = 60 * 60 * 24 * 30

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
