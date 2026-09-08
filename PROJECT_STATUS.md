# CodeFix AI — Implementation Checklist

## Working now

- Responsive coding-room interface with Monaco Editor.
- File tabs for source files and Markdown.
- Language selector updates the active file extension (for example, `main.py` → `main.cpp`) without deleting the code.
- Room sharing modal and QR code with LAN-address support.
- Join-request, approval, presence, chat, activity, output, and AI-fix interface flows.
- Yjs + y-websocket client integration for CRDT editor synchronization when the collaboration service is running.
- FastAPI room API and a JDoodle execution endpoint.

## Required configuration for real execution

1. Start FastAPI: `uvicorn backend.app.main:app --reload --port 8000`.
2. Create a free JDoodle Compiler API plan and copy the Client ID and Client Secret from its API dashboard.
3. Put them in `.env` as `JDOODLE_CLIENT_ID` and `JDOODLE_CLIENT_SECRET`.
4. Start the frontend: `npm run dev --prefix frontend`.

The Run action submits the current editor content. It reports an unavailable compiler rather than returning made-up output when JDoodle is not configured.

## Next production work

- Persist rooms, members, history, chat, executions, and AI fixes in MongoDB.
- Add JWT/guest-session authentication and signed WebSocket tokens.
- Use Redis pub/sub and persistence for scaled y-websocket instances.
- Implement cursor awareness, typing debounce, room expiry jobs, rate limits, and member removal.
- Add JDoodle language mapping tests and end-to-end collaboration tests.
- Connect a structured AI provider response and enforce base-version conflict protection before Apply Fix.
