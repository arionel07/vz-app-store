# Vizaje Staff Admin

Desktop-first visual foundation for the internal Vizaje Staff management interface. The current milestone is intentionally frontend-only: all overview content is demo data and no API, authentication, CRUD, quiz, or photo workflow is connected.

## Run locally

From the repository root:

```bash
bun install --frozen-lockfile
VIZAJE_API_URL=http://127.0.0.1:3000 bun run --cwd apps/admin dev -- --port 3001
```

Open `http://localhost:3001`. The visual component catalogue is available at `/design-system` in development only and is excluded from production through a server-side `notFound()` guard.

## Checks

```bash
bun run --cwd apps/admin typecheck
bun run --cwd apps/admin test
bun run --cwd apps/admin build
```

The UI supports light, dark, and system themes. Theme preference is local to the browser; no server-side user preference is persisted yet.
