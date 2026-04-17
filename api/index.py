# api/index.py
# Vercel Python Serverless 入口文件
# Vercel 会将 /api/* 的请求全部路由到这里，由 FastAPI 内部处理具体路径
import sys
import os

# 将 backend/ 目录加入 Python 路径，使 `from app.xxx import ...` 可以正常解析
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))

from app.main import app  # noqa: E402 — 路径注入必须在 import 前完成

__all__ = ["app"]
