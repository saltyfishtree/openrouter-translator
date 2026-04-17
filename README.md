# OpenRouter Translator

An open-source streaming translation app with:

- TypeScript frontend in `frontend/`
- Python FastAPI backend in `backend/`
- secure server-side OpenRouter integration
- invite-only username/password registration
- Supabase Postgres ready storage
- Vercel Services deployment support

## Highlights

- Streaming translation over OpenRouter
- Context-aware translation with thread continuity
- Persistent source/translation storage
- Queryable translation history and thread timeline
- Supported models:
  - `openai/gpt-4o`
  - `openai/gpt-4o-mini`
  - `openai/gpt-5.4-nano`
  - `openai/gpt-5.4-mini`
  - `google/gemini-3-flash-preview`
- Password hashing with Argon2
- HttpOnly session cookies
- One-time invite codes with default seed `zjxai`
- Frontend and backend separated for clearer ownership and deployment

## Project Structure

- [frontend](/Users/admin/Desktop/personal/translator/frontend)
- [backend](/Users/admin/Desktop/personal/translator/backend)
- [docs/architecture.md](/Users/admin/Desktop/personal/translator/docs/architecture.md)
- [docs/deployment.md](/Users/admin/Desktop/personal/translator/docs/deployment.md)
- [SECURITY.md](/Users/admin/Desktop/personal/translator/SECURITY.md)

## Architecture

- Frontend: Next.js 16 + React 19 + TypeScript
- Backend: FastAPI + SQLAlchemy + psycopg + httpx
- Database: Postgres, designed to work cleanly with Supabase Postgres
- Deployment: Vercel Services
  - `web` service serves the frontend at `/`
  - `api` service serves the Python backend at `/api`

Requests flow like this:

1. Browser sends UI actions to the frontend.
2. Frontend calls `/api/...` on the same origin.
3. Vercel routes `/api/*` to the Python backend service.
4. Backend validates the session, talks to Postgres, and securely proxies OpenRouter.
5. Translation turns are persisted and can be replayed as context in future requests.

## Security Model

- `OPENROUTER_API_KEY` never reaches the browser.
- Passwords are stored as Argon2 hashes only.
- Session tokens are random, stored hashed in the database, and sent as HttpOnly cookies.
- Invite codes are normalized server-side and become unusable after one successful registration.
- Frontend uses no client-exposed secret environment variables.
- Error responses are intentionally generic so upstream provider details are not leaked.

Important:

- The OpenRouter key you pasted into this chat should be considered exposed.
- Rotate it in OpenRouter before you publish or deploy.

## Local Development

### 1. Install frontend dependencies

```bash
npm install --prefix frontend
```

### 2. Install backend dependencies

Using a virtualenv is recommended:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cd ..
```

### 3. Configure environment variables

Copy [.env.example](/Users/admin/Desktop/personal/translator/.env.example) to `.env` and fill in:

- `DATABASE_URL`
- `OPENROUTER_API_KEY`
- `AUTH_SECRET`
- `DEFAULT_INVITE_CODES`
- `OPENROUTER_SITE_URL`
- `OPENROUTER_APP_NAME`

### 4. Run backend

```bash
npm run backend:dev
```

### 5. Run frontend

```bash
npm run frontend:dev
```

The frontend proxies `/api/*` to `http://127.0.0.1:8000` during local development, so the browser still talks to a single origin.

## Supabase Setup

This project is intentionally compatible with Supabase Postgres through `DATABASE_URL`.

Recommended production setup:

1. Create a Supabase project.
2. Use its Postgres connection string as `DATABASE_URL`.
3. Install the Supabase integration from Vercel Marketplace if you want project-linked provisioning and secret management.
4. Keep all database and OpenRouter credentials server-side only.

You do not need to expose `SUPABASE_ANON_KEY` to the frontend for this project, because authentication and data access are handled by the Python backend.

## Vercel Deployment

This repo uses [vercel.json](/Users/admin/Desktop/personal/translator/vercel.json) with Vercel Services.

Before deploying:

1. Import the repository into Vercel.
2. Set the project Framework Preset to `Services`.
3. Add environment variables in Vercel Project Settings:
   - `DATABASE_URL`
   - `OPENROUTER_API_KEY`
   - `AUTH_SECRET`
   - `DEFAULT_INVITE_CODES`
   - `OPENROUTER_SITE_URL`
   - `OPENROUTER_APP_NAME`
4. Point `OPENROUTER_SITE_URL` to your actual production domain.

See [docs/deployment.md](/Users/admin/Desktop/personal/translator/docs/deployment.md) for details.

## Quality Checks

Frontend:

```bash
npm run frontend:lint
npm run frontend:build
```

Backend:

```bash
npm run backend:check
```

Repository-level:

```bash
npm run lint
```

## Translation Persistence

The backend now stores:

- translation threads (`translation_threads`)
- translation messages (`translation_messages`)
- full source text and translated text for every turn

When you continue translating in an existing thread, recent turns are automatically injected as context before sending the next prompt to OpenRouter.

## License

MIT. See [LICENSE](/Users/admin/Desktop/personal/translator/LICENSE).
