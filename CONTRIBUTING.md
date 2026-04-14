# Contributing

## Development flow

1. Create a feature branch.
2. Keep frontend changes in `frontend/`.
3. Keep backend changes in `backend/`.
4. Run the checks before opening a pull request.

## Checks

```bash
npm run frontend:lint
npm run frontend:build
npm run backend:check
```

## Security-sensitive areas

- Never expose `OPENROUTER_API_KEY` in client-side code.
- Never log raw passwords or session tokens.
- Do not return database internals or upstream provider responses directly to the browser.
- Keep any new secrets out of version control.
