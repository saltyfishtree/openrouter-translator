from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """应用配置，从环境变量或 .env 文件读取。"""

    supabase_url: str = Field(alias="SUPABASE_URL")
    # Supabase 项目 URL，格式：https://<project-ref>.supabase.co

    supabase_anon_key: str = Field(alias="SUPABASE_ANON_KEY")
    # Supabase anon/public key，用于服务端直接操作数据库（需关闭 RLS）

    openrouter_api_key: str = Field(alias="OPENROUTER_API_KEY", min_length=1)
    # 从 https://openrouter.ai/keys 获取

    session_secret: str = Field(alias="AUTH_SECRET", min_length=16)
    # 用于 HMAC 签名 session token，至少 16 位随机字符串

    default_invite_codes: str = Field(alias="DEFAULT_INVITE_CODES", default="zjxai")
    # 逗号分隔的初始邀请码，首次启动时自动写入数据库

    app_base_url: str = Field(alias="OPENROUTER_SITE_URL", default="http://localhost:3000")
    # 显示给 OpenRouter 的来源 URL，影响用量统计页面的显示

    openrouter_app_name: str = Field(
        alias="OPENROUTER_APP_NAME", default="OpenRouter Translator"
    )
    # 显示在 OpenRouter 控制台的应用名称

    session_cookie_name: str = "translator_session"
    # HTTP-only Cookie 名称

    session_max_age_seconds: int = 60 * 60 * 24 * 30
    # Session 有效期：30 天

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """返回缓存的配置实例，整个进程生命周期内只初始化一次。"""
    return Settings()
