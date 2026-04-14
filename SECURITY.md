# Security Policy

## Supported scope

This project treats the following as security-sensitive:

- OpenRouter credentials
- database credentials
- password hashes
- session cookies
- invite code integrity

## Reporting

Please report vulnerabilities privately to the maintainer rather than opening a public issue.

## Operational rules

- Use server-only environment variables for secrets.
- Rotate any key that has been pasted into chat logs, screenshots, or public terminals.
- Use separate secrets for local, preview, and production environments.
- Prefer managed Postgres providers with TLS enabled, such as Supabase.
