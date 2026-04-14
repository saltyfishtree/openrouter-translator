# Architecture

## Overview

The repository is intentionally split by responsibility:

- `frontend/`: user interface and browser interactions
- `backend/`: authentication, session handling, invite validation, translation proxying, and database access

## Why this split

- The frontend stays TypeScript-only.
- The backend stays Python-only.
- Secrets remain on the backend boundary.
- Vercel Services can deploy both pieces under one domain.

## Data model

The backend stores:

- users
- sessions
- invite codes

Passwords are stored as Argon2 hashes. Session tokens are stored as SHA-256 hashes derived from a server secret.

## Translation flow

1. Frontend submits translation settings and source text to `/api/translate`.
2. Backend validates the session.
3. Backend validates the selected model against an allowlist.
4. Backend sends a streaming request to OpenRouter.
5. Backend parses Server-Sent Events from OpenRouter and forwards plain text chunks back to the browser.

## Authentication flow

1. User registers with username, password, and invite code.
2. Backend validates the invite code and consumes it exactly once.
3. Backend creates a user and hashed password record.
4. Backend creates a session row and sends an HttpOnly cookie.
5. Subsequent authenticated requests resolve the user from the hashed session token.
