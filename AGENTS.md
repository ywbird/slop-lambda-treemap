# AGENTS.md

## Project

Lambda calculus visualizer web app: parse lambda expressions into ASTs, perform beta reduction step by step, and render the AST as a colored 2D binary treemap on `<canvas>`, with the substituted expression animating (interpolating) into variable positions during reduction. The implementation plan lives in `TODO.md`.

## Conventions

- No external libraries or frameworks — plain HTML, vanilla JS (ES modules), CSS only. **Exception:** GIF encoding uses [gif.js](https://github.com/jnordberg/gif.js) v0.2.0 (MIT) vendored under `vendor/`. Everything else stays library-free.
- Follow the checklist in `TODO.md`; mark items off as they are completed.
- Git: one commit per change / feature addition (small, logical commits). The workspace has no git repo yet — run `git init` before the first commit.

## Tooling (set up 2026-08)

### context-mode
Knowlege-base / session-memory layer. Use for recall instead of re-reading raw sources:
- `ctx_search` — search indexed content + auto-captured session memory (batch all questions in one call).
- `ctx_batch_execute` — run multiple shell commands in one call, auto-indexes output, returns matching sections inline.
- `ctx_execute` / `ctx_execute_file` — run code in a sandbox; only what you `console.log()` enters the conversation (think-in-code, keeps raw bytes out).
- `ctx_index` / `ctx_fetch_and_index` — store content/URLs for later search; `ctx_stats` — usage; `ctx_doctor` — diagnose install.
- `ctx purge` wipes the knowledge base (irreversible); `ctx upgrade` updates context-mode.
- Context-mode session memory persists across `/clear` and `/compact`; searchable via `ctx_search(sort: "timeline")`.

### graphify
Knowledge-graph extraction of this repo. Output lives in `graphify-out/` (gitignored, regenerate locally):
- `graph.html` — interactive graph (open in browser), `graph.json` — raw data, `GRAPH_REPORT.md` — audit report (God Nodes, Surprising Connections, Suggested Questions).
- The graph is already built. For natural-language questions about the codebase, do NOT rebuild — run `graphify query "<question>"` (fallback: inline NetworkX traversal of `graphify-out/graph.json`).
- Rebuild after a substantial change: `graphify add` / `graphify <path> --update` (incremental) or a full `graphify .` rebuild.

### Node / test
Run tests with `npm test` (see `package.json`).
