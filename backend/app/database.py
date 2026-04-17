from functools import lru_cache

from supabase import Client, create_client

from app.config import get_settings


@lru_cache(maxsize=1)
def get_supabase() -> Client:
    """返回缓存的 Supabase 客户端实例，整个进程生命周期内只初始化一次。"""
    settings = get_settings()
    return create_client(settings.supabase_url, settings.supabase_anon_key)
