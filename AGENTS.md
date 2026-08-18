# AGENTS.md

Next.js 16 (App Router) + React 19 + TypeScript chat app that runs an agent loop against **YandexGPT** with tool calls served by an **external MCP server**, plus RAG over MCP resources.

## Commands

- `npm run dev` — dev server (http://localhost:3000)
- `npm run lint` — ESLint (flat config; runs on the whole repo)
- `npm run build` / `npm run start` — production
- No test framework exists. For typechecking: `npx tsc --noEmit` (there is no npm script for it)

## Runtime prerequisites

- An MCP server must be reachable at `MCP_SERVER_URL` (default `http://localhost:3001/mcp`). It is **not part of this repo** — without it `POST /api/chat` fails at `getMCPTools()`.
- Env in `.env.local` (gitignored): `YC_FOLDER_ID`, `YC_API_KEY` (Yandex Cloud — used for chat and embeddings), `MCP_SERVER_URL`. `OPENROUTER_API_KEY` / `GITHUB_TOKEN` are present in `.env.local` but unused by code.
- `data/rag-index.json` is generated and gitignored; never commit it.

## Architecture

- `app/api/chat/route.ts` is the only backend entrypoint. It filters history (`filterHistory`), fetches MCP tools, optionally injects RAG context, then runs an agent loop (max 5 iterations) calling `callYandex` (model `yandexgpt-lite/latest`) and executes tool calls through MCP until Yandex returns a final text answer.
- `lib/mcp.ts` — MCP client (`@modelcontextprotocol/client`, v2). Tools are cached; `withReconnect` retries once by resetting the client. Injects synthetic tools `read_resource` and `get_prompt` on top of the server's tools. `callMCPTool` handles these two locally.
- `lib/rag.ts` — builds an embedding index from all MCP resources into `data/rag-index.json`; `searchRag` embeds the query via Yandex and returns top chunks (min score 0.33). Index is built lazily on first query — if it's stale, delete `data/rag-index.json` to force a rebuild.
- `app/page.tsx` — single client page; `components/ui/` are shadcn primitives.

## SSE protocol (keep client and server in sync)

`route.ts` streams NDJSON over SSE; `app/page.tsx` parses it. Event types: `iteration`, `tool-call`, `tool-result`, `text`, `error`, `done`, terminated by `data: [DONE]`. Changing this contract means editing both files.

## Conventions

- Logs, UI strings, and comments are in Russian; keep that style.
- Commit messages follow `feat: <area>` / `fix: <area>` (e.g. `feat: add RAG`).
- Path alias `@/*` → repo root. Types live in `types/chat.ts`; imports use `@/types`.
