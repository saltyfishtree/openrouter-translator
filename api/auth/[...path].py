import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "backend"))

from app.main import app as fastapi_app  # noqa: E402


async def app(scope, receive, send):
    if scope["type"] == "http" and scope.get("path", "").startswith("/api"):
        adjusted = dict(scope)
        adjusted["path"] = scope["path"][4:] or "/"
        return await fastapi_app(adjusted, receive, send)
    return await fastapi_app(scope, receive, send)


__all__ = ["app"]
