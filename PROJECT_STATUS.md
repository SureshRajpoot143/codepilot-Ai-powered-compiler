# CodeFix AI — Implementation Checklist

## Working now

- Multi-module workspace UI: virtual file tree with folders, expand/collapse, and inline
  new-file / new-folder creation (sidebar) plus a multi-tab editor with close buttons.
- Per-file Yjs sub-rooms: each open file is a separate `{room}:{b64url(path)}` CRDT doc, so
  only users with the same file open sync keystrokes; the shared tree uses `{room}:tree`.
- Presence: colored dots next to files being edited right now (tree rows + tab badges) and a
  sidebar list showing who edits what; driven by `editor:activefile` WebSocket events and the
  FastAPI `active_files` snapshot.
- Project persistence: file-backed store (`data/projects/{room}/...`) with atomic writes.
  New rooms are bootstrapped with `main.py`, `utils.py`, `src/auth/login.py`,
  `database/connection.py`, and `README.md`. Auto-save via collab-server debounce (2s/10s)
  plus Ctrl/⌘+S.
- Reopen flow: landing screen lists saved projects (`/api/projects`); opening one restores the
  tree and file contents through `/api/rooms/open`.
- Callback cursors (y-monaco) and awareness colors inside the shared editor.
- FastAPI room/presence/workspace API and JDoodle execution endpoint.

## Required configuration

1. Start the collab server: `npm run collab` (y-websocket on port 1234).
2. Start FastAPI: `uvicorn backend.app.main:app --reload --port 8000`.
3. Create a free JDoodle Compiler API plan and copy the Client ID/Secret from its dashboard;
   put them in `.env` as `JDOODLE_CLIENT_ID` and `JDOODLE_CLIENT_SECRET`.
4. Start the frontend: `npm run dev --prefix frontend`.

The Run action submits the current editor content and reports an unavailable compiler rather
than returning made-up output when JDoodle is not configured.

## Next production work

- Move the disk store (`backend/app/store.py`) to MongoDB/PostgreSQL; add JWT/guest-session
  auth and signed WebSocket tokens.
- Redis pub/sub + persistence for scaled y-websocket instances.
- Room expiry jobs, rate limits, and viewer/editor enforcement on the collab path.
- JDoodle language mapping tests and end-to-end collaboration tests.
- Structured AI provider response and base-version conflict protection before Apply Fix.