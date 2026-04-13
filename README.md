# Session Replay v1 (Foundations)

## Scope

This repository ships a Vite + React 19 editor with a local API server in the same repo.

## Scripts

- `bun run dev`, `bun run vite`, `bun run dev:app`: starts Vite on `http://127.0.0.1:5173` and auto-starts local API on `http://127.0.0.1:4848` when needed.
- `bun run dev:server`: starts API server only on `http://127.0.0.1:4848`.
- `bun run build`: runs app build.
- `bun run build:app`: build frontend bundle only.
- `bun run build:server`: app-level wrapper for future Bun server entry `server/index.ts`.
- `bun run preview` / `bun run preview:app`: run Vite preview.
- `bun run lint`: ESLint (app workspace).
- `bun run test`, `bun run test:watch`, `bun run test:ui`: Vitest + Testing Library.

## Contracts (setup only)

- Backend path contract is expected at `/api` and forwarded to `SESSION_REPLAY_API_URL` (default `http://127.0.0.1:4848`).
- Vite dev mode reuses an already-running API if `/api/health` responds; otherwise it starts and manages the local API process automatically.
- `/api/health` stays cheap so dev startup is not blocked by initial session catalog scans.
- Session discovery degrades per provider/file: `/api/sessions` can return partial results plus `warnings` when some session files fail to scan or index.
- Client-side editing stack includes `zustand` and `zod` and is intended to keep edits local.
- UI baseline prepared for shadcn with Lucide icons (`components.json`).

## Install

```bash
bun install
```

## Notes

- `build:server` requires `server/index.ts` before it becomes useful.
- `src` is intentionally left untouched in this setup phase; component and style implementation is expected from later workers.
