# Deployment Guide

## Recommended production stack

- GitHub for source control
- Vercel for deployment
- Supabase Postgres for storage

## Vercel

This project uses Vercel Services through [vercel.json](/Users/admin/Desktop/personal/translator/vercel.json).

Required services:

- `web` -> `frontend`
- `api` -> `backend/main.py`

Set the Framework Preset to `Services` in the Vercel dashboard.

## Environment variables

Configure these in Vercel:

- `DATABASE_URL`
- `OPENROUTER_API_KEY`
- `AUTH_SECRET`
- `DEFAULT_INVITE_CODES`
- `OPENROUTER_SITE_URL`
- `OPENROUTER_APP_NAME`

## Supabase

Use the Supabase Postgres connection string for `DATABASE_URL`.

If you use the Vercel Marketplace integration, finish provisioning in the Vercel project first, then copy or map the final Postgres URL into `DATABASE_URL`.

## Secret handling

- Do not use `NEXT_PUBLIC_OPENROUTER_API_KEY`.
- Do not expose database credentials to the browser.
- Rotate the current OpenRouter key before the first public deployment because it appeared in the chat transcript.
