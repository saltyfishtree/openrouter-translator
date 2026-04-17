from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import NullPool

from app.config import get_settings


class Base(DeclarativeBase):
    """所有 ORM 模型的基类。"""
    pass


settings = get_settings()

engine = create_engine(
    settings.database_url,
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
