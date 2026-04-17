from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import NullPool

from app.config import get_settings


class Base(DeclarativeBase):
    """所有 ORM 模型的基类。"""
    pass


settings = get_settings()

def _normalize_db_url(url: str) -> str:
    # postgresql:// 使用 psycopg2，postgresql+psycopg:// 使用 psycopg3
    # 统一转为 psycopg3，与 requirements.txt 中的 psycopg[binary] 对应
    if url.startswith("postgresql://") or url.startswith("postgres://"):
        return url.replace("://", "+psycopg://", 1)
    return url

engine = create_engine(
    _normalize_db_url(settings.database_url),
    pool_pre_ping=True,   # 每次获取连接前 ping 一次，避免使用已断开的连接
    poolclass=NullPool,   # Serverless 环境下不维护连接池，每次请求独立建连
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db() -> Generator[Session, None, None]:
    """FastAPI 依赖注入：每次请求创建一个数据库 Session，请求结束后关闭。"""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
