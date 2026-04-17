from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class User(Base):
    """用户表：存储账号基本信息。"""
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)          # UUID
    username: Mapped[str] = mapped_column(String(20), unique=True, index=True)  # 唯一用户名（小写）
    password_hash: Mapped[str] = mapped_column(String(255))                 # argon2 哈希
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    sessions: Mapped[list["Session"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    invite_code: Mapped["InviteCode | None"] = relationship(back_populates="used_by")
    translation_threads: Mapped[list["TranslationThread"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    translation_messages: Mapped[list["TranslationMessage"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class Session(Base):
    """会话表：存储用户登录 token（服务端 session）。"""
    __tablename__ = "sessions"
    __table_args__ = (
        Index("ix_sessions_user_id", "user_id"),
        Index("ix_sessions_expires_at", "expires_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)           # UUID
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)  # HMAC-SHA256
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped[User] = relationship(back_populates="sessions")


class InviteCode(Base):
    """邀请码表：每个邀请码只能使用一次。"""
    __tablename__ = "invite_codes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True)  # 规范化（小写+去空格）
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))   # None 表示未使用
    used_by_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), unique=True
    )

    used_by: Mapped[User | None] = relationship(back_populates="invite_code")


class TranslationThread(Base):
    """翻译会话表：每个会话包含多条翻译消息，支持上下文连续翻译。"""
    __tablename__ = "translation_threads"
    __table_args__ = (
        Index("ix_translation_threads_user_id", "user_id"),
        Index("ix_translation_threads_updated_at", "updated_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(120))     # 取自第一条原文的前 42 个字符
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped[User] = relationship(back_populates="translation_threads")
    messages: Mapped[list["TranslationMessage"]] = relationship(
        back_populates="thread", cascade="all, delete-orphan"
    )


class TranslationMessage(Base):
    """翻译消息表：每条记录是一次完整的原文→译文。"""
    __tablename__ = "translation_messages"
    __table_args__ = (
        Index("ix_translation_messages_thread_id", "thread_id"),
        Index("ix_translation_messages_user_id", "user_id"),
        Index("ix_translation_messages_created_at", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    thread_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("translation_threads.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    model: Mapped[str] = mapped_column(String(120))         # OpenRouter 模型 ID
    source_language: Mapped[str] = mapped_column(String(60))  # 原文语言（"auto" 或具体语言名）
    target_language: Mapped[str] = mapped_column(String(60))  # 目标语言
    translation_style: Mapped[str] = mapped_column(String(30))  # "natural" 或 "faithful"
    source_text: Mapped[str] = mapped_column(Text)           # 原文
    translated_text: Mapped[str] = mapped_column(Text)       # 完整译文（流式结束后存储）
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    thread: Mapped[TranslationThread] = relationship(back_populates="messages")
    user: Mapped[User] = relationship(back_populates="translation_messages")
