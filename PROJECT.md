# CodeFix AI

> Real-time collaborative coding platform where teams write, compile, debug, and AI-fix code across devices in one shared room.

## Highlights

- Real-time editor built on **React + Monaco + Yjs** (`y-monaco`, `y-websocket`) — edits are CRDT deltas, not whole-document polling. A shared **virtual file tree** plus **one CRDT sub-room per open file** keeps keystroke sync scoped to people editing the same module.
- Authoritative **FastAPI** service: room creation, join approval, role checks, workspace/persistence API, execution, and AI-fix orchestration. Rooms/projects are stored on disk (`backend/app/store.py`), so saved projects can be reopened later.
- **JDoodle** remote compiler (Python, JavaScript, C, C++, Java) with stdout/compile-error/runtime-error output and inline Monaco error markers.
- **Gemini** AI debugger that reads the last compiler output and proposes an applied-in-one-click fix.
- **AI Ask** sidebar: a separate Gemini chat where you can ask any question or request a program, then import the answer's code as a new file in the shared workspace with one click.
- **Presence**: colored dots on the file tree and editor tabs show exactly who is editing each module; the sidebar lists everyone and their current file.
- **Import Project**: bring any external project into a room three ways — pick a folder/files from the browser, give a folder path on the backend machine, or clone a GitHub URL (`git clone`) — files merge into the room store and are shared with everyone in real time.
- **Run Project**: besides the single-file "Run" (JDoodle), a "Run Project" button executes the whole multi-file project like VS Code, directly on the backend machine, so sibling imports/headers/stdin work — with an entry-file dropdown (auto-detects `main.*`).
- Cross-device sharing via room link, QR code, and one-tap copy; guest joins require the host's approval.
- Chat, activity log, live online list — all relayed over a validated WebSocket.

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
- **FastAPI (8000)** owns room membership, permissions, and project persistence. New rooms are bootstrapped with working starter files (`main.py`, `utils.py`, `src/auth/login.py`, `database/connection.py`, `README.md`); file trees, contents, and members live under `data/projects/{room}/`.
- **Collab server (1234)** synchronizes the shared tree doc (`{room}:tree`) and a per-file sub-room doc per open file (`{room}:{b64url(path)}`). File content is seeded from disk on first load and auto-saved back (debounced, 2s trailing / 10s max); the URL is derived from the page hostname so LAN devices reach the host machine.

## Document model

| Doc name | Scope | Syncs |
|---|---|---|
| `{room}:tree` | shared session | file tree (names, parents, folders, language) + tree `meta` |
| `{room}:{b64url(path)}` | per open file | keystrokes (`.content` text) — only among users with that file open |

The disk store is authoritative: `collab-server.cjs` seeds a fresh file doc from `data/projects/{room}/content/{path}` and writes edits back on a debounce (plus Ctrl/⌘+S → `PUT /api/workspace/{rid}/file`). The tree doc is ephemeral and re-seeded from REST by the first connected member, so restarting the servers never loses work.

## Directory layout

```
auto-compiler/
├── backend/
│   ├── app/main.py          FastAPI: rooms, joins, presence, workspace REST, execute, AI fix, room WS
│   ├── app/store.py         File-backed persistence (users, projects, filesystem tree, contents)
│   └── requirements.txt
├── frontend/
│   ├── src/main.tsx         Single-page app: workspace tree, tabs, editor, share, join, chat, AI fix
│   ├── src/styles.css
│   └── vite.config.ts       Port 5173, /api and /ws proxies to :8000
├── collab-server.cjs        y-websocket service: tree doc + per-file sub-rooms, disk seed/persist
├── data/                    Runtime store (users.json, projects/{room}/…) — created on first run
├── .env / .env.example      Credentials and configuration
├── package.json             Root scripts (dev, build, collab)
└── README.md                Quick start
```

## Requirements

- Node.js 18+ and npm
- Python 3.12+
- No Docker, no MongoDB/Redis needed: rooms/projects persist to disk via `backend/app/store.py`

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

1. **Create a room** — enter your name and click **＋ Create Coding Room**. You become the Host and get a room code like `CFX-8A72KD`. A starter workspace is created automatically: `main.py`, `utils.py`, folders `src/auth/` and `database/`, and `README.md`.
2. **Share** — click **↗ Share**. If you are on `localhost`, the app now **auto-detects your LAN IP** and fills it in, so the QR/link are immediately valid for phones (e.g. `http://192.168.1.2:5173/room/CFX-...`). Copy the link or scan the QR.
3. **Others join** — phones can join two ways: scan the QR/open the shared link, **or** open the bare app URL (`http://192.168.1.2:5173`) and use **"already have a room? → Join Room"** with the room code. Either way they enter **their name** and request access. The Host sees a live **"X wants to join"** prompt and can **Accept** (Editor) or **Reject**.
4. **Work on modules together** — the sidebar shows the shared file tree. Everyone can open files (they become tabs), create files/folders, rename, and delete. Different people can edit **different modules simultaneously**; presence dots on the tree and tabs show who is where. Editing the **same file** shows colored cursors and merges via CRDT.
5. **Open content in sync** — new rooms are bootstrapped from disk; files open with saved content instantly (before the collab relay initializes). Edits auto-save while you type.
6. **Reopen saved projects** — on the landing screen, saved projects appear under **"reopen a saved project"**. Opening one restores the whole workspace (tree, contents, members).
7. **Run** — the Run button sends the exact active-editor snapshot to JDoodle. Output/errors appear for everyone, with error lines marked in the editor.
8. **AI Fix** — click **✦ AI Fix**. The backend sends the code plus the last compiler error to Gemini and shows a proposal (root cause, explanation, changed file). **Apply Fix** replaces the shared document; **Reject** dismisses it.
9. **AI Ask** — click **✦ AI Ask** (sidebar or header) to open a left slide-out chat. Ask anything or request a program; Gemini replies in the panel. When an answer contains a code block, an **⇩ Import to Workspace** button appears under it — it saves the code as a new file (unique name, matching language) and opens it for everyone.
10. **Members & leaving** — everyone in the room sees the full online list (names, devices, roles, current file) in the sidebar; the host is always visible too. **⏻ Leave** (guests/editors) disconnects cleanly and notifies the room. The host's button shows **⏻ Close Room**, which deletes the room and disconnects everyone.
11. **Host controls** — only the host receives and can **Accept/Reject** join requests (non-hosts get HTTP 403). The host can also **✕ remove any member** directly from the ONLINE list; the removed member is notified and returned to the landing screen. Hosts can also rename/delete files and folders.
12. **Import an external project** — click **⇩ Import** in the header: pick a folder/files from your device, paste a path on the backend machine, or clone a GitHub repo. Files (minus junk like `node_modules`/`.git`/binaries) merge into the workspace and appear for everyone instantly.
13. **Run the whole project** — the workspace toolbar shows a **▶ Run Project** button with an entry-file dropdown (defaults to `main.py`/`main.js`/`Main.java`/…). It executes the project directly on the backend machine (like VS Code), so cross-file imports/headers and stdin all work; output/errors stream to everyone. The plain **▶ Run** still runs just the active file via JDoodle. Local runtimes needed on the backend: `python3`, `node`, `cc`/`c++`, `javac`.

Roles: `Host` (created the room), `Editor` (approved, can edit/create/rename/run/AI), `Viewer` (read-only, reserved). Rooms have no session time limit — they stay live until the host closes them.

## API reference

Base URL: `http://localhost:8000` (proxied through Vite at `/api`).

### REST

| Method | Path | Purpose |
|---|---|---|
| POST | `/rooms` | Create a room + bootstrapped project. Body: `{id, name, device}` → room object |
| GET | `/rooms/{rid}` | Fetch room state |
| POST | `/rooms/open` | Reopen a saved project. Body: `{project_id, id, name, device}` → room object |
| POST | `/rooms/{rid}/join` | Request to join. Body: `{id, name, device}` |
| POST | `/rooms/{rid}/members/{uid}/approve?host_id=...&role=editor` | Host approves a pending member |
| POST | `/rooms/{rid}/members/{uid}/reject?host_id=...` | Host rejects a pending member |
| DELETE | `/rooms/{rid}/members/{uid}?host_id=...` | Host removes a member (kicked + disconnected) |
| DELETE | `/rooms/{rid}?host_id=...` | Host closes the room (persists members, disconnects all) |
| GET | `/projects?owner_id=...` | Saved projects for the reopen list |
| GET | `/workspace/{rid}?actor_id=...` | Project state: filesystem tree, members, presence snapshot |
| GET | `/workspace/{rid}/file?path=...&actor_id=...` | Read a file |
| PUT | `/workspace/{rid}/file` | Save a file. Body: `{path, content, language?}` |
| POST | `/workspace/{rid}/nodes` | Create node. Body: `{parent, name, is_directory, language?}` |
| POST | `/workspace/{rid}/import/json` | Import files uploaded from the browser. Body: `{files: [{path, content}]}` |
| POST | `/workspace/{rid}/import/path` | Import a project folder already on the backend machine. Body: `{dir}` |
| POST | `/workspace/{rid}/import/github` | Clone a repo and import it. Body: `{url, branch?}` |
| PUT | `/workspace/{rid}/nodes` | Rename/move node. Body: `{from_path, to_path}` |
| DELETE | `/workspace/{rid}/nodes?path=...&actor_id=...` | Delete a file or folder (recursive) |
| POST | `/rooms/{rid}/execute` | Execute inside a room (permission-checked) |
| POST | `/rooms/{rid}/execute-project` | Run the whole multi-file project on the backend machine (VS Code style). Body: `{entry?, stdin?}` |
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
| `presence:states` | `[{id,name,activeFile}]` | Initial presence snapshot on connect |
| `workspace:imported` | `{count, skipped}` | A project was imported — re-seed the tree |
| `presence:update` | `[{id,name,activeFile}]` | A member switched the active file |
| `room:removed` | member | Member was removed by the host |
| `room:closed` | `{id}` | Host closed the room |

Client presence events: send `editor:activefile` with `{path}` whenever you open/switch/close a file; the server tracks `active_files` per room and rebroadcasts `presence:update`. Cursor/selection awareness additionally flows over the collab WebSocket (y-protocols awareness).

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

`POST /api/ask` sends the user's prompt to the same `gemini-3.6-flash` model (conversation context is kept client-side in the panel). The answer is returned as plain text that may contain one markdown fenced code block. The frontend extracts the block with a regex and renders an **⇩ Import to Workspace** button under the message (only for `Host`/`Editor` roles). Import saves the code as a new file named `ai_<language>[N].<ext>` (unique, matching language), seeds the shared Yjs tree + REST store, and opens it — so everyone in the room sees the new module appear in real time.

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
- Rooms/projects persist to disk via `backend/app/store.py` (atomic writes under `data/`); the collab server shares that store for seeding and auto-save. For multi-instance deployment, swap the disk store for MongoDB/PostgreSQL and add Redis pub/sub for y-websocket.
- Persist version snapshots (not keystrokes), add JWT guest/session tokens, rate limits, and endpoint-level tests.
- AI suggestions carry a `base_version`; on apply, reject/re-analyse if the document has advanced.