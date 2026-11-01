# Session Replay

Session Replay is a local web app for discovering agent transcripts, inspecting and editing their replay presentation, previewing playback, and exporting one standalone HTML file. The project is under active development.

## Requirements and quick start

- [Bun](https://bun.sh/) 1.3.14, pinned in `package.json`, for dependency management, development, tests, and builds.

```bash
bun install --frozen-lockfile
bun run dev
```

Open `http://127.0.0.1:5173`. Vite proxies `/api` to `http://127.0.0.1:4848` by default. Development startup reuses a healthy API at that address or starts one in watch mode, waits until it is ready, and stops the managed process when Vite closes.

Run the API alone when frontend and server processes need separate terminals:

```bash
bun run dev:server
```

The API listens only on `http://127.0.0.1:4848` by default.

## How it works

1. The local API scans supported transcript roots and incrementally indexes session metadata.
2. The browser sidebar groups sessions by project and supports text search, agent/project/date/turn-length filters, pinning, and ignoring projects.
3. Selecting a session loads its transcript into the editor. Individual turns can be included or excluded, and turns can receive bookmark labels.
4. Preview mode renders the edited transcript and supports stepped or timed playback at `1x`, `2x`, `4x`, or `8x`.
5. Export settings control the file name, title, tool calls, thinking text, default thinking visibility, and timestamps.
6. Export downloads one HTML file containing the selected transcript, styles, data, and playback code. The exported viewer starts paused and runs without the local API or external assets.

Editor preview and export share the prepared transcript layout, playback units, timeline, speed choices, and viewport state contract. The exported document embeds that model and uses a small inline browser runtime for playback controls.

## Supported sources

The default catalog scans these roots under the configured home directory:

| Source | Default root |
|---|---|
| Claude Code | `~/.claude/projects` |
| Codex CLI | `~/.codex/sessions` |
| Copilot CLI | `~/.copilot/session-state` |
| Cursor | `~/.cursor/projects` |
| Gemini | `~/.gemini/tmp` |

A missing provider root contributes no sessions; it does not prevent the app from starting. Invalid files can produce catalog warnings while healthy sessions remain available.

## Architecture

```text
provider filesystem scan
  -> incremental session catalog
  -> loopback HTTP API
  -> React editor and playback preview
  -> standalone HTML renderer
```

- `server/providers/`: provider-specific discovery and read-only transcript normalization.
- `server/catalog/`: incremental indexing, session lookup, and search.
- `server/api/`: local HTTP routes, request validation, and trust checks.
- `server/export/`: standalone document, payload, styles, and playback runtime.
- `src/features/`: session browser, editor preview, playback, and export settings.
- `src/lib/replay/`: shared transcript layout and playback model.
- `test/`: unit, API, export, and provider-to-export integration tests.

## Local trust and privacy

Session Replay is designed as a local tool, not a public server:

- The development API binds to `127.0.0.1` and rejects request URLs whose host is not loopback.
- Browser requests require an exact allowed origin. Defaults are `http://127.0.0.1:5173` for development and `http://127.0.0.1:4173` for preview. Scheme, host, and port must match exactly.
- Requests without an `Origin` header remain accepted for CLI and native clients.
- Explicit transcript paths are resolved and restricted to the configured home directory. `~` and `~/...` are supported; `~user` syntax is rejected.
- The API has no authentication. Do not expose it through a public bind, proxy, or tunnel.

Generated HTML contains the transcript and tool content selected in export settings. It may include prompts, responses, file paths, commands, tool inputs/results, or other sensitive data. Review the file before sharing it. Session Replay does not guarantee automatic secret or personal-data redaction.

## Configuration

| Variable | Default | Scope |
|---|---|---|
| `SESSION_REPLAY_API_PORT` | `4848` | API listen port used by `server/dev.ts` |
| `SESSION_REPLAY_HOME` | OS home directory | Provider scan root and allowed path boundary |
| `SESSION_REPLAY_ALLOWED_ORIGINS` | `http://127.0.0.1:5173,http://127.0.0.1:4173` | Comma-separated exact browser origins accepted by the API |
| `SESSION_REPLAY_API_URL` | `http://127.0.0.1:4848` | Vite proxy and managed-API health target |
| `VITE_SESSION_REPLAY_API_BASE` | dev: same origin; production: `http://127.0.0.1:4848` | Browser API host/base override; route paths already include `/api` |

If the API port changes, set matching API and Vite/browser values. Allowed origins are validated as exact origins; paths, credentials, query strings, and fragments are invalid.

## Commands and verification

| Command | Purpose |
|---|---|
| `bun run dev` | Start Vite on port `5173`; reuse or manage the local API |
| `bun run dev:app` | Start the same Vite development app explicitly |
| `bun run dev:server` | Start the loopback API in Bun watch mode |
| `bun run preview` | Preview the app build on port `4173` |
| `bun run preview:app` | Alias for the app preview command |
| `bun run typecheck` | Strict-check app, server, scripts, config, and tests without emit |
| `bun run lint` | Run ESLint across the repository |
| `bun run test` | Run the Vitest suite once |
| `bun run test:watch` | Run Vitest in watch mode |
| `bun run test:ui` | Open the Vitest UI |
| `bun run build` | Typecheck, build the frontend, then bundle the Bun server |
| `bun run build:app` | TypeScript project build plus Vite frontend build |
| `bun run build:server` | Bundle `server/index.ts` into `dist/server` for Bun |

For a clean verification pass:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run test
bun run build
```

## Optional local pre-push checks

After preparing Bun 1.3.14 and the frozen install, opt in with
`bun run hooks:install`. Nothing installs hooks automatically. The installer
refuses unrelated `core.hooksPath` settings or active default hooks. It sets
repository-local `core.hooksPath` to `.githooks`; linked worktrees share that
setting and need these tracked files. Repeating installation is safe.

The hook runs full existing ESLint and whole-project `typecheck` scopes. Full
scopes intentionally cover shared configs, lockfiles, renames, deletions and
unknown remote bases without an affected-file detector. It never formats,
installs dependencies, starts the app, reads live transcripts, or invokes a model.
No formatter policy is introduced. ESLint warnings retain their existing severity.

Every non-deleted pushed commit, including peeled tags, must equal checked-out
HEAD. The checkout must be clean, including untracked files. Use a separate clean
checkout for each different commit in a multi-ref push. Deletion-only pushes do
not run project checks; empty stdin runs all checks. Failed tools block the push
with their exit status. No stash or automatic checkout occurs.

`bun run test:hooks` exercises the executable hook and installer in disposable
Git fixtures with stubbed project commands and no outbound push. It does not
replace `bun run test` or `bun run build`; run those separately. No CI activation,
checker/linter replacement, or Vitest isolation change is included.

## Known limits

- Provider transcript formats are external and may drift as agent tools change.
- The API and editor workflow are local-only. There is no hosted sharing, authentication, or cloud storage.
- Exports are standalone files, not sanitized publications. Sensitive-data review remains the user's responsibility.
- Tests cover providers, catalog/API behavior, rendering, and export integration through Vitest/jsdom. The repository has no browser end-to-end suite or enforced coverage threshold.
