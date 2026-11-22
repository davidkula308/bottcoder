<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

## Architecture
- The whole app UI lives in `src/app/` (Dashboard) and is mounted both by `src/routes/index.tsx` (web preview) and `electron/renderer/main.tsx` (desktop), so both stay identical.
- All PC access (terminal, files, processes, startup, editors, AI streaming) goes through `window.nightshift` exposed by `electron/preload.cjs`; `src/app/bridge.ts` defines the contract and a simulated bridge for the browser preview. Never use Node APIs in `src/`.
- Pure rules (session timing, schedules, prompt building, code parsing) stay in `src/app/engine.ts` with tests in `engine.test.ts`.
- Desktop UI is built with `vite.electron.config.ts` (`base: "./"` for file://) and packaged with @electron/packager from a clean staging folder outside the project.
- AI runs from the Electron main process (no CORS, keys never reach the page); default engine is a CPU-friendly local Ollama model, NVIDIA NIM is optional.
- "Real project" mode keeps its plan and progress in `<workspace>/.nightshift/state.json` (git-ignored) plus a visible `PLAN.md`; rules live in `src/app/project.ts`, the round loop in `src/app/project-runner.ts`. Why: sessions resume across restarts and rollbacks never touch the bot's memory.
- Live typing goes through `src/app/live.ts` sinks: the VS Code add-on (`vscode-extension/`, HTTP on 127.0.0.1:47615, packaged to `electron/nightshift-live.vsix`) or real keystrokes via `electron/typer.ps1` (Windows SendInput, types only while the target window title matches). The disk write after typing is always the source of truth.
- Themes are class-based (`.theme-day` on <html>) overriding the same CSS tokens, including `--syn-*` code colours; never hardcode colours per theme in components.
- Windows builds: `scripts/build-windows.sh` (packager + NSIS `installer/nightshift.nsi`, per-user install, no admin).
- In-app updates: `scripts/build-windows.sh` also writes `public/updates` (manifest with sha256 + app files); the installed app downloads changed files from the published site's `/updates`, swaps them into `resources/app` and restarts. Why: no reinstall per release; only the Electron runtime itself needs a new installer. Bump VERSION each release and publish.
- Activity apps rules live in `src/app/activity.ts`; `sys:blink` closes only process IDs it started. Why: never close windows the user already had open.
- Session settings, history, unfinished-session checkpoints, and the last code screen persist in localStorage after hydration; practice signatures persist separately. Why: desktop sessions survive restarts without a cloud account and fallback coding never needs an AI service.
- Surface practice code never touches disk; AI discard mode uses the Electron scratch folder and removes it on stop. Why: throwaway sessions cannot modify the user's saved workspace.
- Setup and speed dialogs plus history presentation live in `src/app/panels-session.tsx`, while Dashboard coordinates bridge actions. Why: web and desktop share the same session controls without duplicating PC access.
- Manual Fetch updates uses the update rules in `src/app/update.ts`, shares an operation lock with automatic installation, and queues installation until coding stops. Why: concurrent checks cannot trigger duplicate updates or restart an active coding session.
- Focus presentation reuses the CodeSurface action slot and TerminalPanel output-only variant. Why: it preserves the same live code and terminal output without duplicating session logic or terminal controls.
