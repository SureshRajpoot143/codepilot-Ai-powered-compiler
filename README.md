# CodeFix AI

> A real-time collaborative coding platform where teams write, compile, debug, and AI-fix code across devices in one shared room.

## What is included

- Responsive React + Monaco workspace with files, output, chat, activity, sharing QR code, join approval, roles, and AI-fix preview.
- CRDT editing through **Yjs**, `y-monaco`, and a `y-websocket` synchronization service. Updates are binary CRDT deltas—not whole-document polling or replacement.
- FastAPI authority service: room creation, pending joins, approval, role checking, execution/AI orchestration endpoints, and validated room event WebSocket.


## Architecture

```mermaid
flowchart LR
  A[Laptop: Monaco + Yjs] <-- WebSocket CRDT --> C[y-websocket collaboration service]
  B[Mobile: Monaco + Yjs] <-- WebSocket CRDT --> C
  A & B <-- room events --> F[FastAPI]
  F --> J[JDoodle]
  F --> L[AI provider]
  F --> M[(MongoDB)]
  F --> R[(Redis)]
```

Yjs merges concurrent inserts/deletes deterministically. Presence lives in Yjs awareness; application events such as approvals, chat, execution, and AI suggestions use the FastAPI room socket. The API is deliberately the authority for all roles—clients cannot grant themselves access.

## Start

```bash
cp .env.example .env
```

**Frontend:**

```bash
cd frontend
npm install
npm run dev
```

**Backend:**

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
```

**Collaboration server (for real-time editing):**

```bash
npm run collab
```

Open `http://localhost:5173`.

For real compiler output, create a JDoodle Compiler API account and put its credentials in `.env` as `JDOODLE_CLIENT_ID` and `JDOODLE_CLIENT_SECRET`. The Run button sends the current editor snapshot to FastAPI and displays the returned stdout, compilation errors, runtime errors, time, and memory. Credentials stay in the backend and must never be exposed in the frontend.

For live collaboration, start the Yjs server in a separate terminal:

```bash
npm run collab
```

It listens on port `1234` for devices on your Wi-Fi. Share the app using your computer's LAN address (for example `192.168.1.20:5173`), not `localhost`; the shared link identifies the same room and connects both editors to that room's Yjs document.

When opening a QR code from a phone on the same Wi-Fi, use the Share dialog to enter the laptop's LAN address (for example `192.168.1.20:5173`). `localhost` always means the device that scanned the code, so it cannot be used to reach the laptop.

## API and socket events

REST: `POST /api/rooms`, `POST /api/rooms/{id}/join`, `POST /api/rooms/{id}/members/{user}/approve`, `POST /api/rooms/{id}/execute`, `POST /api/rooms/{id}/ai-fix`.

Room socket: `room:join_request`, `room:join_accepted`, `room:user_joined`, `room:user_left`, `editor:cursor`, `editor:selection`, `typing`, `chat:message`, `execution:start`, `execution:result`, `ai:fix_ready`.

## Production notes

Configure JDoodle and an AI provider in the backend services before deployment; never expose their keys to the frontend. Replace in-memory room state with MongoDB snapshots plus Redis pub/sub for multi-instance deployment, persist version snapshots (not keystrokes), add JWT guest/session tokens, rate limits, and endpoint-level tests. AI suggestions carry a base document version and must be rejected/re-analysed if the document advanced before apply.
