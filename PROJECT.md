# CodeFix AI

> Real-time collaborative coding platform where teams write, compile, debug, and AI-fix code across devices in one shared room.

## Highlights

- Real-time editor built on **React + Monaco + Yjs** (`y-monaco`, `y-websocket`) — edits are CRDT deltas, not whole-document polling.
- Authoritative **FastAPI** service: room creation, join approval, role checks, execution, and AI-fix orchestration.
- **JDoodle** remote compiler (Python, JavaScript, C, C++, Java) with stdout/compile-error/runtime-error output and inline Monaco error markers.
- **Gemini** AI debugger that reads the last compiler output and proposes an applied-in-one-click fix.
- **AI Ask** sidebar: a separate Gemini chat where you can ask any question or request a program, then import the answer's code into the shared editor with one click.
- Cross-device sharing via room link, QR code, and one-tap copy; guest joins require the host's approval.
- Chat, activity log, live online list, and room expiry — all relayed over a validated WebSocket.

## Architecture

```mermaid
flowchart LR
  A[Laptop: Monaco + Yjs] <-- WebSocket CRDT --> C[y-websocket collaboration service :1234]
  B[Mobile: Monaco + Yjs] <-- WebSocket CRDT --> C
  A & B <-- room events /api + /ws --> F[FastAPI :8000]
  F --> J[JDoodle compiler API]
  F --> G[Gemini API]
  F --> M[(MongoDB - optional)]
  F --> R[(Redis - optional)]
  A & B <-- UI --> V[Vite dev server :5173]:::v
  V /api + /ws --> F
  classDef v fill:#2c3e50,color:#fff
```

- **Vite dev server (5173)** proxies `/api` and `/ws` to FastAPI (8000) so phones on the LAN work without CORS setup.
- **FastAPI (8000)** owns room membership and permissions. Guests who are not yet approved can connect to the room socket to receive their approval/rejection in real time.
- **Collab server (1234)** synchronizes the shared Yjs document; the URL is derived from the page hostname so LAN devices reach the host machine.

## Directory layout

```
auto-compiler/
├── backend/
│   ├── app/main.py          FastAPI: rooms, join/approve/reject, execute, AI fix, room WS
│   └── requirements.txt
├── frontend/
│   ├── src/main.tsx         Single-page app: editor, rooms, share, join, chat, AI fix
│   ├── src/styles.css
│   └── vite.config.ts       Port 5173, /api and /ws proxies to :8000
├── .env / .env.example      Credentials and configuration
├── package.json             Root scripts (dev, build, collab)
└── README.md                Quick start
```

## Requirements

- Node.js 18+ and npm
- Python 3.12+
- No Docker, no MongoDB/Redis needed for normal use (backend keeps room state in memory)

## Setup

```bash
cp .env.example .env
```

Edit `.env`:

| Variable | Purpose |
|---|---|
| `JDOODLE_CLIENT_ID` / `JDOODLE_CLIENT_SECRET` | Real compiler output via JDoodle (create a free account at jdoodle.com) |
| `GEMINI_API_KEY` | AI Debugger (create at aistudio.google.com); the key must be valid for `gemini-3.6-flash` |
| `MONGODB_URI` / `REDIS_URL` | Optional persistence/pub-sub for multi-instance deployments; unused in single-server mode |

Then start the three processes (each in its own terminal):

**Frontend (5173)**
```bash
cd frontend
npm install
npm run dev
```

**Backend (8000)**
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
```

**Collaboration server (1234)** — needed for real-time multi-device editing
```bash
npm install
npm run collab
```

Open `http://localhost:5173`.

> To run everything at once (3 background processes with logs in /tmp): `npm --prefix frontend run dev`, `uvicorn backend.app.main:app --reload`, and `npm run collab`.

## Using the app

1. **Create a room** — enter your name and click **＋ Create Coding Room**. You become the Host and get a room code like `CFX-8A72KD`.
2. **Share** — click **↗ Share**. If you are on `localhost`, the app now **auto-detects your LAN IP** and fills it in, so the QR/link are immediately valid for phones (e.g. `http://192.168.1.2:5173/room/CFX-...`). Copy the link or scan the QR.
3. **Others join** — phones can join two ways: scan the QR/open the shared link, **or** open the bare app URL (`http://192.168.1.2:5173`) and use **"already have a room? → Join Room"** with the room code. Either way they enter **their name** and request access. The Host sees a live **"X wants to join"** prompt and can **Accept** (Editor) or **Reject**.
4. **Edit together** — every approved member edits the same document; cursors/selection are not synced, but content changes propagate as CRDT deltas.
5. **Run** — the Run button sends the exact editor snapshot to JDoodle. Output/errors appear for everyone, with error lines marked in the editor.
6. **AI Fix** — click **✦ AI Fix**. The backend sends the code plus the last compiler error to Gemini and shows a proposal (root cause, explanation, changed file). **Apply Fix** replaces the shared document; **Reject** dismisses it.
7. **AI Ask** — click **✦ AI Ask** (sidebar or header) to open a left slide-out chat. Ask anything or request a program; Gemini replies in the panel. When an answer contains a code block, an **⇩ Import to Code** button appears under it — clicking it replaces the shared document with that code and closes the panel.
8. **Members & leaving** — everyone in the room sees the full online list (names, devices, roles) in the sidebar; the host is always visible too. **⏻ Leave** (guests/editors) disconnects cleanly and notifies the room. The host's button shows **⏻ Close Room**, which deletes the room and disconnects everyone.
9. **Host controls** — only the host receives and can **Accept/Reject** join requests (non-hosts get HTTP 403). The host can also **✕ remove any member** directly from the ONLINE list; the removed member is notified and returned to the landing screen.

Roles: `Host` (created the room), `Editor` (approved, can edit/run/AI), `Viewer` (read-only, reserved). Rooms expire after 2 hours.

## API reference

Base URL: `http://localhost:8000` (proxied through Vite at `/api`).

### REST

| Method | Path | Purpose |
|---|---|---|
| POST | `/rooms` | Create a room. Body: `{id, name, device}` → room object |
| GET | `/rooms/{rid}` | Fetch room state |
| POST | `/rooms/{rid}/join` | Request to join. Body: `{id, name, device}` |
| POST | `/rooms/{rid}/members/{uid}/approve?host_id=...&role=editor` | Host approves a pending member |
| POST | `/rooms/{rid}/members/{uid}/reject?host_id=...` | Host rejects a pending member |
| POST | `/rooms/{rid}/execute` | Execute inside a room (permission-checked) |
| POST | `/rooms/{rid}/ai-fix` | AI-fix inside a room (permission-checked) |
| POST | `/ask` | AI Ask chat. Body: `{prompt}` → `{answer}` |
| POST | `/execute` | Execute arbitrary snapshot. Body: `{code, language}` |
| POST | `/ai-fix` | AI-fix arbitrary snapshot. Body: `{code, language, stderr}` |
| GET | `/health` | Liveness check |

`language` is one of `python`, `javascript`, `c`, `cpp`, `java`.

### Room WebSocket

`ws://hostname:5173/ws/rooms/{rid}/{uid}` (proxied to FastAPI).

Client sends: `{"event": "...", "data": {...}}`.

Server broadcasts:

| Event | Payload | Meaning |
|---|---|---|
| `room:join_request` | `{id,name,device,role}` | Someone pending approval |
| `room:join_accepted` | member | Guest was approved (guest switches to member) |
| `room:join_rejected` | member | Guest was rejected |
| `room:user_joined` / `room:user_left` | member / `{id}` | Membership changed |
| `chat:message` | `{who,text}` | Chat message |
| `execution:start` / `execution:result` | result | Someone ran the code |
| `ai:fix_ready` | suggestion | AI proposal ready |
| `editor:cursor`, `editor:selection`, `typing` | — | Presence (accepted, minimal) |

Permissions are enforced server-side: only the Host may approve/reject; only Editor/Host may run code or request AI fixes; viewers are rejected with HTTP 403.

## AI fix details

The backend calls:

```
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=GEMINI_API_KEY
```

with a prompt containing the language, the last compiler/runtime `stderr`, and the source code, requesting strict JSON:

```json
{
  "root_cause": "...",
  "explanation": "...",
  "changes": ["..."],
  "fixed_code": "..."
}
```

If `GEMINI_API_KEY` is missing or still a placeholder, the API returns `503` and the UI shows **"AI is not configured. Set GEMINI_API_KEY in .env."** The suggestion is only applied when the user clicks **Apply Fix** — it is never written back automatically.

## AI Ask details

`POST /api/ask` sends the user's prompt to the same `gemini-3.6-flash` model (conversation context is kept client-side in the panel). The answer is returned as plain text that may contain one markdown fenced code block. The frontend extracts the block with a regex and renders an **⇩ Import to Code** button under the message (only for `Host`/`Editor` roles). Import writes the code into the shared Yjs document (`main.py`), switches the active tab to it, logs an activity entry, and broadcasts a chat notice — so everyone in the room sees it appear in real time.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Execution unavailable" | Set `JDOODLE_CLIENT_ID` / `JDOODLE_CLIENT_SECRET` and restart the backend. |
| "AI is not configured" | Set a real `GEMINI_API_KEY` in `.env` and **restart the backend** (env is read at startup). |
| AI returns the same code / odd fixes | Old keys may lack access to `gemini-3.6-flash`; regenerate a key at aistudio.google.com. |
| Phone cannot open the link | Share dialog → enter the laptop's LAN IP like `192.168.1.2:5173`. `localhost` always means the scanning device. |
| Phones can't join/edit | The collab server binds `0.0.0.0:1234`; it must be running (`npm run collab`) and reachable over Wi-Fi. |
| After changing `.env`, AI still says not configured | Restart uvicorn — `--reload` reloads Python modules but the already-loaded environment persists. |

## Production notes

- Configure JDoodle and Gemini credentials server-side; never expose them in the frontend.
- In-memory room state is fine for local/LAN use; for multi-instance deployment replace it with MongoDB snapshots plus Redis pub/sub.
- Persist version snapshots (not keystrokes), add JWT guest/session tokens, rate limits, and endpoint-level tests.
- AI suggestions carry a `base_version`; on apply, reject/re-analyse if the document has advanced.