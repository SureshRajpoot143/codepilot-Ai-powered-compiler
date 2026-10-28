"""CodeFix AI application API. Room permissions remain server authoritative."""
from __future__ import annotations
import asyncio, os, random, socket, string, time, json, shutil, subprocess, tempfile
from collections import defaultdict
from pathlib import Path
from typing import Any, Literal
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import store

load_dotenv()

app = FastAPI(title="CodeFix AI", version="0.2.0")
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("FRONTEND_URL", "http://localhost:5173").split(","), allow_methods=["*"], allow_headers=["*"], allow_credentials=True)
store.init_store()

Language = Literal["python", "c", "cpp", "java", "javascript"]
class Member(BaseModel):
    id: str; name: str = Field(max_length=40); device: str = "Desktop"
    role: Literal["host", "editor", "viewer"] = "viewer"
class CreateRoom(Member):
    language: Language = "python"
class Room(BaseModel):
    id: str; host_id: str; members: dict[str, Member] = {}; pending: dict[str, Member] = {}; language: Language = "python"
class Execute(BaseModel):
    code: str = Field(max_length=100_000); language: Literal["python", "c", "cpp", "java", "javascript"]; stdin: str = Field(default="", max_length=20_000)
class AiRequest(Execute):
    stderr: str = Field(max_length=20_000)
class AskRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=20_000)
class FileSave(BaseModel):
    path: str = Field(max_length=500); content: str = Field(default="", max_length=1_000_000); language: str | None = None
class NodeCreate(BaseModel):
    parent: str = Field(default="", max_length=500); name: str = Field(default="", max_length=200); is_directory: bool = False; language: str | None = None
class NodeRename(BaseModel):
    from_path: str = Field(max_length=500); to_path: str = Field(max_length=500); language: str | None = Field(default=None, max_length=40)
class LanguageChange(BaseModel):
    from_path: str = Field(max_length=500); to_path: str = Field(max_length=500); language: str = Field(max_length=40)
class ReopenRequest(BaseModel):
    project_id: str = Field(min_length=5, max_length=40); id: str; name: str = Field(max_length=40); device: str = "Desktop"
class ImportFile(BaseModel):
    path: str = Field(max_length=1000); content: str = Field(default="", max_length=1_000_000)
class ImportUpload(BaseModel):
    files: list[ImportFile] = Field(max_length=2000)
class ImportPathRequest(BaseModel):
    dir: str = Field(min_length=1, max_length=2000)
class ImportGithubRequest(BaseModel):
    url: str = Field(min_length=6, max_length=1000); branch: str | None = Field(default=None, max_length=200)
class RunProjectRequest(BaseModel):
    entry: str | None = Field(default=None, max_length=500); stdin: str = Field(default="", max_length=20_000)
# JDoodle language codes and their current version indexes. Update these when
# choosing a different runtime version from JDoodle's supported-languages list.
JDOODLE_LANGUAGES = {
    "python": ("python3", "6"),
    "c": ("c", "7"),
    "cpp": ("cpp", "7"),
    "java": ("java", "6"),
    "javascript": ("nodejs", "7"),
}

rooms: dict[str, Room] = {}
sockets: dict[str, dict[str, WebSocket]] = defaultdict(dict)
active_files: dict[str, dict[str, dict[str, str]]] = defaultdict(lambda: defaultdict(lambda: {"path": "", "name": ""}))
language_requests: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
def _member_color(uid: str) -> str:
    colors = ["#7c5cff","#00b894","#ff8a4c","#e056fd"]
    return colors[sum(ord(c) for c in uid) % len(colors)]
def room_id() -> str:
    rid = "CFX-" + "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
    if rooms.get(rid) or store.load_project(rid):
        return room_id()
    return rid
async def broadcast(rid: str, event: str, data: Any, except_id: str | None = None):
    payload = {"event": event, "data": data}
    for user, ws in list(sockets[rid].items()):
        if user != except_id:
            try: await ws.send_json(payload)
            except RuntimeError: sockets[rid].pop(user, None)
def get_room(rid: str) -> Room:
    r = rooms.get(rid)
    if not r:
        raise HTTPException(404, "Room not found")
    return r
def _snapshot(rid: str) -> list[dict[str, str]]:
    active = active_files.get(rid, {})
    members = rooms[rid].members if rid in rooms else {}
    return [{"id": uid, "name": members[uid].name, "activeFile": active[uid].get("path", "")} for uid in active if uid in members]
@app.post("/api/rooms", response_model=Room)
async def create_room(host: CreateRoom):
    rid = room_id(); host.role = "host"
    room = Room(id=rid, host_id=host.id, members={host.id: host}, language=host.language)
    rooms[rid] = room
    store.upsert_user(host.id, host.name)
    project = store.ensure_project(rid, host.id, f"{host.name}'s workspace", {host.id: host}, language=host.language)
    if not project["filesystem"]:
        bootstrap_workspace(rid, host.id, host.name, host.language)
    return room

STARTER_CODES: dict[str, tuple[str, str]] = {
    "python": ("main.py", "# Welcome to CodeFix AI\n# Invite teammates and edit together in real time.\ndef hello():\n    print(\"Hello, World!\")\n\n\nhello()\n"),
    "javascript": ("main.js", '// Welcome to CodeFix AI\nfunction hello() {\n  console.log("Hello, World!");\n}\n\nhello();\n'),
    "c": ("main.c", '#include <stdio.h>\n\nint main(void) {\n    printf("Hello, World!\\n");\n    return 0;\n}\n'),
    "cpp": ("main.cpp", '#include <iostream>\n\nint main() {\n    std::cout << "Hello, World!" << std::endl;\n    return 0;\n}\n'),
    "java": ("Main.java", 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}\n'),
}

def bootstrap_workspace(rid: str, owner: str, name: str, language: str = "python") -> None:
    """Seed a fresh project whose starter file uses the chosen starting language."""
    filename, code = STARTER_CODES.get(language, STARTER_CODES["python"])
    node = store.create_node(rid, "", filename, False, language, owner_id=owner)
    store.save_file(rid, filename, code, node.get("language"))
    readme = "# CodeFix AI workspace\n\nA shared project. Starter language: **%s** — any member can switch\nlanguage, with the host approving the file rename.\n" % language
    node = store.create_node(rid, "", "README.md", False, "markdown", owner_id=owner)
    store.save_file(rid, "README.md", readme, "markdown")
@app.post("/api/rooms/open", response_model=Room)
async def open_room(body: ReopenRequest):
    """Reopen a saved project: it becomes a live room again with its members."""
    project = store.load_project(body.project_id)
    if not project:
        raise HTTPException(404, "Saved project not found")
    host_id = project["owner_id"]
    cached = rooms.get(body.project_id)
    if cached:
        members = dict(cached.members)
    else:
        members = {}
        for uid, m in project.get("members", {}).items():
            member = Member(id=uid, name=m.get("name", uid), device=m.get("device", "Desktop"), role=m.get("role", "viewer"))
            if uid == host_id:
                member.role = "host"
            members[uid] = member
    # Reopening must admit the current browser as a member even if this project
    # was last used by a different device/session id, otherwise workspace calls
    # and the room socket reject them and the file tree never appears.
    if body.id not in members:
        members[body.id] = Member(
            id=body.id,
            name=body.name,
            device=body.device,
            role="host" if body.id == host_id else "editor",
        )
        store.upsert_user(body.id, body.name)
    else:
        members[body.id].name = body.name
        members[body.id].device = body.device
        if body.id == host_id:
            members[body.id].role = "host"
    store.sync_members(body.project_id, members)
    language = project.get("language", "python")
    if language not in STARTER_CODES:
        language = "python"
    room = Room(id=body.project_id, host_id=host_id, members=members, language=language)
    rooms[body.project_id] = room
    return room
@app.get("/api/projects")
async def projects(owner_id: str = "", owner_name: str = ""):
    """Saved projects owned by this user (for the 'reopen' landing flow)."""
    return {"projects": store.list_projects(owner_id, owner_name) if owner_id or owner_name else store.list_projects("")}
@app.get("/api/rooms/{rid}", response_model=Room)
async def room(rid: str): return get_room(rid)
@app.post("/api/rooms/{rid}/join")
async def request_join(rid: str, member: Member):
    r = get_room(rid); r.pending[member.id] = member
    store.upsert_user(member.id, member.name)
    await broadcast(rid, "room:join_request", member.model_dump()); return {"status": "pending"}
@app.post("/api/rooms/{rid}/members/{uid}/approve")
async def approve(rid: str, uid: str, host_id: str, role: Literal["editor", "viewer"] = "editor"):
    r = get_room(rid)
    if r.host_id != host_id: raise HTTPException(403, "Host permission required")
    m = r.pending.pop(uid, None)
    if not m: raise HTTPException(404, "Join request not found")
    m.role = role; r.members[uid] = m
    store.upsert_user(uid, m.name); store.sync_members(rid, r.members)
    await broadcast(rid, "room:join_accepted", m.model_dump()); return m
@app.post("/api/rooms/{rid}/members/{uid}/reject")
async def reject(rid: str, uid: str, host_id: str):
    r = get_room(rid)
    if r.host_id != host_id: raise HTTPException(403, "Host permission required")
    m = r.pending.pop(uid, None)
    if not m: raise HTTPException(404, "Join request not found")
    await broadcast(rid, "room:join_rejected", m.model_dump()); return {"status": "rejected"}
@app.delete("/api/rooms/{rid}/members/{uid}")
async def remove_member(rid: str, uid: str, host_id: str):
    """Host kicks any member: they are removed, disconnected, and notified."""
    r = get_room(rid)
    if r.host_id != host_id: raise HTTPException(403, "Host permission required")
    if uid == host_id: raise HTTPException(400, "The host cannot remove themself")
    m = r.members.pop(uid, None)
    if not m: raise HTTPException(404, "Member not found")
    store.sync_members(rid, r.members)
    active_files[rid].pop(uid, None); language_requests[rid].pop(uid, None)
    await broadcast(rid, "room:removed", m.model_dump())
    await broadcast(rid, "presence:update", _snapshot(rid))
    ws = sockets[rid].pop(uid, None)
    if ws:
        try: await ws.close(code=4000)
        except RuntimeError: pass
    return {"status": "removed"}
@app.delete("/api/rooms/{rid}")
async def close_room(rid: str, host_id: str):
    """Host leaves and closes the room: everyone is disconnected and the room is deleted."""
    r = get_room(rid)
    if r.host_id != host_id: raise HTTPException(403, "Host permission required")
    store.sync_members(rid, r.members)
    rooms.pop(rid, None)
    await broadcast(rid, "room:closed", {"id": rid})
    for ws in list(sockets[rid].values()):
        try: await ws.close(code=1000)
        except RuntimeError: pass
    sockets.pop(rid, None); active_files.pop(rid, None); language_requests.pop(rid, None)
    return {"status": "closed"}

def _member(rid: str, actor_id: str | None) -> Member:
    r = get_room(rid)
    if not actor_id:
        raise HTTPException(401, "actor_id is required")
    m = r.members.get(actor_id)
    if not m:
        raise HTTPException(403, "You are not a member of this room")
    return m

@app.get("/api/workspace/{rid}")
async def workspace(rid: str, actor_id: str | None = None):
    """Project state: file tree, members, and live presence snapshot."""
    _member(rid, actor_id)
    project = store.load_project(rid) or store.ensure_project(rid, rooms[rid].host_id, f"{rooms[rid].host_id}'s workspace", rooms[rid].members)
    members = [m.model_dump() for m in rooms[rid].members.values()]
    return {"project": project, "filesystem": project.get("filesystem", []), "members": members, "presence": _snapshot(rid)}

@app.get("/api/workspace/{rid}/file")
async def workspace_file(rid: str, path: str, actor_id: str | None = None):
    _member(rid, actor_id)
    content = store.read_file(rid, path)
    project = store.load_project(rid) or {}
    language = next((n.get("language") for n in project.get("filesystem", []) if n.get("path") == path), None)
    return {"path": path, "content": content or "", "language": language}

@app.put("/api/workspace/{rid}/file")
async def workspace_save(rid: str, body: FileSave, actor_id: str | None = None):
    _member(rid, actor_id)
    if rooms[rid].members[actor_id].role == "viewer":
        raise HTTPException(403, "Viewers cannot edit files")
    store.save_file(rid, body.path, body.content, body.language)
    return {"saved": True}

@app.post("/api/workspace/{rid}/nodes")
async def workspace_create(rid: str, body: NodeCreate, actor_id: str | None = None):
    m = _member(rid, actor_id)
    if m.role not in ("host", "editor"):
        raise HTTPException(403, "Only editors may create files")
    node = store.create_node(rid, body.parent, body.name, body.is_directory, body.language or None, owner_id=rooms[rid].host_id)
    return node

@app.put("/api/workspace/{rid}/nodes")
async def workspace_rename(rid: str, body: NodeRename, actor_id: str | None = None):
    m = _member(rid, actor_id)
    if m.role not in ("host", "editor"):
        raise HTTPException(403, "Only editors may rename files")
    try:
        return store.rename_node(rid, body.from_path, body.to_path, owner_id=rooms[rid].host_id, language=body.language)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc

@app.post("/api/workspace/{rid}/language")
async def workspace_language(rid: str, body: LanguageChange, actor_id: str | None = None):
    """Change a file's language (and extension). Host applies immediately;
    editors send a request that only the host can approve."""
    m = _member(rid, actor_id)
    if m.role == "viewer":
        raise HTTPException(403, "Viewers cannot change language")
    request = {"id": m.id, "name": m.name, "from": body.from_path, "to": body.to_path, "language": body.language}
    if m.role == "host":
        try:
            store.rename_node(rid, body.from_path, body.to_path, owner_id=rooms[rid].host_id, language=body.language)
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc
        language_requests[rid].pop(m.id, None)
        await broadcast(rid, "file:renamed", request)
        return {"status": "applied", **request}
    language_requests[rid][m.id] = request
    await broadcast(rid, "language:request", request, m.id)
    return {"status": "pending", **request}

@app.get("/api/workspace/{rid}/language/requests")
async def list_language_requests(rid: str, host_id: str):
    r = get_room(rid)
    if r.host_id != host_id:
        raise HTTPException(403, "Host permission required")
    return list(language_requests[rid].values())

@app.post("/api/rooms/{rid}/language/{uid}/approve")
async def approve_language(rid: str, uid: str, host_id: str):
    r = get_room(rid)
    if r.host_id != host_id:
        raise HTTPException(403, "Host permission required")
    request = language_requests[rid].pop(uid, None)
    if not request:
        raise HTTPException(404, "Language change request not found")
    try:
        store.rename_node(rid, request["from"], request["to"], owner_id=r.host_id, language=request["language"])
    except ValueError as exc:
        await broadcast(rid, "language:rejected", {"id": uid, "from": request["from"], "to": request["to"], "language": request["language"], "reason": str(exc)})
        raise HTTPException(409, str(exc)) from exc
    await broadcast(rid, "file:renamed", {**request, "approved": True})
    return {"status": "approved", **request}

@app.post("/api/rooms/{rid}/language/{uid}/reject")
async def reject_language(rid: str, uid: str, host_id: str):
    r = get_room(rid)
    if r.host_id != host_id:
        raise HTTPException(403, "Host permission required")
    request = language_requests[rid].pop(uid, None)
    if not request:
        raise HTTPException(404, "Language change request not found")
    await broadcast(rid, "language:rejected", {"id": uid, "from": request["from"], "to": request["to"], "language": request["language"]})
    return {"status": "rejected"}

@app.delete("/api/workspace/{rid}/nodes")
async def workspace_delete(rid: str, path: str, actor_id: str | None = None):
    m = _member(rid, actor_id)
    if m.role not in ("host", "editor"):
        raise HTTPException(403, "Only editors may delete files")
    store.delete_node(rid, path, owner_id=rooms[rid].host_id)
    return {"deleted": path}

MAX_IMPORT_BYTES = 8_000_000

def _require_editor(rid: str, actor_id: str | None):
    m = _member(rid, actor_id)
    if m.role not in ("host", "editor"):
        raise HTTPException(403, "Only editors may import files")
    return m

async def _import_and_broadcast(rid: str, entries: list[tuple[str, str]]) -> dict[str, Any]:
    stats = store.import_files(rid, entries, owner_id=rooms[rid].host_id)
    await broadcast(rid, "workspace:imported", {"count": len(stats["added"]), "skipped": stats["skipped"]})
    return {"added": len(stats["added"]), "skipped": stats["skipped"]}

def _collect_dir(src: Path) -> list[tuple[str, str]]:
    """Read every text file under ``src`` as (relative path, content)."""
    entries: list[tuple[str, str]] = []
    for p in sorted(src.rglob("*")):
        if p.is_dir():
            continue
        rel = p.relative_to(src).as_posix()
        try:
            text = p.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        entries.append((rel, text))
        if sum(len(c) for _, c in entries) > MAX_IMPORT_BYTES:
            raise HTTPException(413, "Project too large to import")
    return entries

@app.post("/api/workspace/{rid}/import/json")
async def workspace_import_json(rid: str, body: ImportUpload, actor_id: str | None = None):
    """Import files uploaded from the browser (source-only text files)."""
    _require_editor(rid, actor_id)
    if sum(len(f.content) for f in body.files) > MAX_IMPORT_BYTES:
        raise HTTPException(413, "Project too large to import")
    return await _import_and_broadcast(rid, [(f.path, f.content) for f in body.files])

@app.post("/api/workspace/{rid}/import/path")
async def workspace_import_path(rid: str, body: ImportPathRequest, actor_id: str | None = None):
    """Import a project folder that already exists on the backend machine."""
    _require_editor(rid, actor_id)
    src = Path(body.dir).expanduser()
    if not src.is_dir():
        raise HTTPException(404, f"Folder not found on server: {src}")
    return await _import_and_broadcast(rid, _collect_dir(src))

@app.post("/api/workspace/{rid}/import/github")
async def workspace_import_github(rid: str, body: ImportGithubRequest, actor_id: str | None = None):
    """Clone a GitHub/git repository and import its files into the workspace."""
    _require_editor(rid, actor_id)
    url = body.url.strip()
    if not url or "://" not in url and not url.startswith("git@"):
        raise HTTPException(400, "Invalid repository URL")
    tmp = tempfile.mkdtemp(prefix="cfx-import-")
    try:
        cmd = ["git", "clone", "--depth", "1"]
        if body.branch:
            cmd += ["--branch", body.branch]
        cmd += [url, "repo"]
        proc = subprocess.run(cmd, cwd=tmp, capture_output=True, text=True, timeout=180)
        if proc.returncode != 0:
            raise HTTPException(502, f"git clone failed: {proc.stderr.strip()[:600]}")
        src = Path(tmp) / "repo"
        if not src.is_dir():
            raise HTTPException(502, "Repository clone returned no folder")
        return await _import_and_broadcast(rid, _collect_dir(src))
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(504, "git clone timed out") from exc
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

@app.post("/api/rooms/{rid}/execute")
async def execute(rid: str, actor_id: str, body: Execute):
    r=get_room(rid); member=r.members.get(actor_id)
    if not member or member.role=="viewer": raise HTTPException(403,"Run permission denied")
    await broadcast(rid,"execution:start",{"user":member.name})
    result = await run_with_jdoodle(body)
    await broadcast(rid,"execution:result",result); return result

async def run_with_jdoodle(body: Execute) -> dict[str, Any]:
    """Run code remotely through JDoodle without exposing credentials to browsers."""
    client_id = os.getenv("JDOODLE_CLIENT_ID", "")
    client_secret = os.getenv("JDOODLE_CLIENT_SECRET", "")
    if not client_id or not client_secret:
        raise HTTPException(503, "JDoodle is not configured. Set JDOODLE_CLIENT_ID and JDOODLE_CLIENT_SECRET in .env.")

    language, version_index = JDOODLE_LANGUAGES[body.language]
    payload = {
        "clientId": client_id,
        "clientSecret": client_secret,
        "script": body.code,
        "stdin": body.stdin,
        "language": language,
        "versionIndex": version_index,
        "compileOnly": False,
    }
    try:
        async with httpx.AsyncClient(timeout=25) as client:
            response = await client.post("https://api.jdoodle.com/v1/execute", json=payload)
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text
        raise HTTPException(502, f"JDoodle rejected the execution request: {detail}") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"JDoodle request failed: {exc}") from exc
    except ValueError as exc:
        raise HTTPException(502, "JDoodle returned an invalid response.") from exc

    success = data.get("isExecutionSuccess")
    status = "Success" if success else "Failed"
    if data.get("compilationStatus") not in (None, 0):
        status = "Compilation Error"
    output = data.get("output") or ""
    error = data.get("error") or ""
    # JDoodle returns compiler/runtime text in `output` for failed executions.
    # Expose it as stderr so the UI can render diagnostics instead of treating it
    # as successful program output.
    return {
        "status": status,
        "stdout": output if success else "",
        "stderr": error or (output if not success else ""),
        "time": data.get("cpuTime"),
        "memory": data.get("memory"),
    }
@app.post("/api/execute")
async def execute_current(body: Execute):
    """Run the exact editor snapshot through JDoodle; never fabricate output."""
    return await run_with_jdoodle(body)

ENTRY_PREFERENCES = ["main.py", "main.js", "index.js", "app.js", "Main.java", "main.c", "main.cpp", "main.cc", "main.cxx"]

def _project_dir(rid: str) -> Path:
    return store.project_path(rid) / "content"

def detect_project_entry(rid: str) -> str | None:
    project = store.load_project(rid) or {}
    paths = {n.get("path") for n in project.get("filesystem", []) if not n.get("is_directory")}
    for preferred in ENTRY_PREFERENCES:
        if preferred in paths:
            return preferred
    for p in sorted(paths):
        if p.rsplit(".", 1)[-1].lower() in {"py", "js", "c", "cpp", "cc", "cxx", "java"} and "/" not in p:
            return p
    return None

def _find(*progs: str) -> str | None:
    for prog in progs:
        found = shutil.which(prog)
        if found:
            return found
    return None

def run_project_locally(rid: str, entry: str, stdin: str) -> dict[str, Any]:
    """Execute a whole multi-file project from disk, VS Code style.

    Runs in the project's content directory so sibling imports/headers resolve
    naturally. Falls back engines are resolved via PATH; a 503 is raised when the
    required runtime is not installed on the backend machine.
    """
    content_root = _project_dir(rid)
    entry_path = content_root / store.sanitize_path(entry)
    if not entry_path.is_file():
        raise HTTPException(404, f"Entry file not found: {entry}")
    ext = entry_path.suffix.lower()
    started = time.time()
    tmpdir = tempfile.mkdtemp(prefix="cfx-run-")
    try:
        try:
            if ext == ".py":
                engine = _find("python3", "python")
                if not engine:
                    raise HTTPException(503, "python3 is not installed on the backend machine")
                result = subprocess.run([engine, str(entry_path)], cwd=content_root, input=stdin, capture_output=True, text=True, timeout=20)
            elif ext == ".js":
                engine = _find("node")
                if not engine:
                    raise HTTPException(503, "node is not installed on the backend machine")
                result = subprocess.run([engine, str(entry_path)], cwd=content_root, input=stdin, capture_output=True, text=True, timeout=20)
            elif ext == ".c":
                engine = _find("cc", "clang", "gcc")
                if not engine:
                    raise HTTPException(503, "A C compiler (cc/clang/gcc) is not installed on the backend machine")
                exe = str(Path(tmpdir) / "a.out")
                built = subprocess.run([engine, str(entry_path), "-o", exe], capture_output=True, text=True, timeout=30)
                if built.returncode != 0:
                    return {"status": "Compilation Error", "stdout": "", "stderr": built.stderr or built.stdout, "time": round(time.time() - started, 2), "memory": "local"}
                result = subprocess.run([exe], cwd=content_root, input=stdin, capture_output=True, text=True, timeout=20)
            elif ext in {".cpp", ".cc", ".cxx"}:
                engine = _find("c++", "clang++", "g++")
                if not engine:
                    raise HTTPException(503, "A C++ compiler (c++/clang++/g++) is not installed on the backend machine")
                exe = str(Path(tmpdir) / "a.out")
                built = subprocess.run([engine, str(entry_path), "-o", exe], capture_output=True, text=True, timeout=30)
                if built.returncode != 0:
                    return {"status": "Compilation Error", "stdout": "", "stderr": built.stderr or built.stdout, "time": round(time.time() - started, 2), "memory": "local"}
                result = subprocess.run([exe], cwd=content_root, input=stdin, capture_output=True, text=True, timeout=20)
            elif ext == ".java":
                engine = _find("javac")
                if not engine:
                    raise HTTPException(503, "javac is not installed on the backend machine")
                java_files = [str(p) for p in content_root.rglob("*.java")]
                built = subprocess.run([engine, "-d", tmpdir, *java_files], capture_output=True, text=True, timeout=30)
                if built.returncode != 0:
                    return {"status": "Compilation Error", "stdout": "", "stderr": built.stderr or built.stdout, "time": round(time.time() - started, 2), "memory": "local"}
                main_class = entry_path.stem
                java = _find("java")
                if not java:
                    raise HTTPException(503, "java is not installed on the backend machine")
                result = subprocess.run([java, "-cp", tmpdir, main_class], cwd=content_root, input=stdin, capture_output=True, text=True, timeout=20)
            else:
                raise HTTPException(400, f"Unsupported entry language: .{ext}")
        except subprocess.TimeoutExpired:
            return {"status": "Timeout", "stdout": "", "stderr": "Execution timed out after 20 seconds", "time": "20", "memory": "local"}
        return {
            "status": "Success" if result.returncode == 0 else "Failed",
            "stdout": result.stdout,
            "stderr": result.stderr,
            "time": round(time.time() - started, 2),
            "memory": "local",
        }
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

@app.post("/api/rooms/{rid}/execute-project")
async def execute_project(rid: str, actor_id: str, body: RunProjectRequest):
    """Run the whole project (multi-file) directly on the backend machine."""
    r = get_room(rid); member = r.members.get(actor_id)
    if not member or member.role == "viewer":
        raise HTTPException(403, "Run permission denied")
    entry = (body.entry or "").strip() or detect_project_entry(rid)
    if not entry:
        raise HTTPException(400, "No runnable entry file in this project")
    await broadcast(rid, "execution:start", {"user": member.name})
    try:
        result = await asyncio.to_thread(run_project_locally, rid, entry, body.stdin)
    except HTTPException as exc:
        result = {"status": "Failed", "stdout": "", "stderr": str(exc.detail), "time": "—", "memory": "local"}
    result["entry"] = entry
    await broadcast(rid, "execution:result", result)
    return result
async def run_ai_fix(body: AiRequest) -> dict[str, Any]:
    """Ask Gemini to diagnose the code plus its compiler output and propose a fix."""
    key = os.getenv("GEMINI_API_KEY", "")
    if not key or key.startswith("your-gemini"):
        raise HTTPException(503, "AI is not configured. Set GEMINI_API_KEY in .env.")
    stderr = body.stderr.strip() or "(no error output — code did not run yet)"
    prompt = f"""You are the AI debugger inside a shared coding room on a collaborative platform.
Language: {body.language}

The last run produced this compiler/runtime output:
---
{stderr}
---

Current source code:
```{body.language}
{body.code}
```

Diagnose the problem and respond with STRICT JSON only (no markdown fences, no commentary) with this exact shape:
{{
  "root_cause": "short root-cause explanation",
  "explanation": "what the fix changes and why",
  "changes": ["concrete change 1", "concrete change 2"],
  "fixed_code": "the complete corrected source code"
}}
If there is no real problem, say so in root_cause and return the original code unchanged in fixed_code."""
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            response = await client.post(
                "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
                params={"key": key},
                json={"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"temperature": 0.2}},
            )
            response.raise_for_status()
            text = response.json()["candidates"][0]["content"]["parts"][0]["text"]
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"AI request failed: {exc}") from exc
    except (KeyError, IndexError) as exc:
        raise HTTPException(502, "AI returned an unexpected response.") from exc
    text = text.strip()
    if "```" in text:
        text = text.split("```", 2)[1]
        if text.startswith("json"): text = text[4:]
        text = text.split("```", 1)[0].strip()
    try:
        data = json.loads(text)
    except ValueError as exc:
        raise HTTPException(502, "AI did not return a valid JSON fix.") from exc
    return {
        "base_version": int(time.time()),
        "root_cause": data.get("root_cause", "Review required."),
        "explanation": data.get("explanation", ""),
        "changes": data.get("changes", []),
        "fixed_code": data.get("fixed_code", body.code),
    }
async def run_ai_ask(prompt: str) -> dict[str, str]:
    """Answer any question / write a program through the AI Ask chat."""
    key = os.getenv("GEMINI_API_KEY", "")
    if not key or key.startswith("your-gemini"):
        raise HTTPException(503, "AI is not configured. Set GEMINI_API_KEY in .env.")
    prompt_text = (f"You are the AI assistant inside a collaborative coding platform. "
                   f"Answer the question helpfully and concisely. When you include code, put the complete "
                   f"program inside a single markdown fenced code block. Do not interleave multiple blocks.\n\n"
                   f"User question:\n{prompt}")
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            response = await client.post(
                "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
                params={"key": key},
                json={"contents": [{"parts": [{"text": prompt_text}]}], "generationConfig": {"temperature": 0.4}},
            )
            response.raise_for_status()
            text = response.json()["candidates"][0]["content"]["parts"][0]["text"]
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"AI request failed: {exc}") from exc
    except (KeyError, IndexError) as exc:
        raise HTTPException(502, "AI returned an unexpected response.") from exc
    return {"answer": text.strip()}
@app.post("/api/ask")
async def ai_ask(body: AskRequest):
    """AI Ask sidebar: answer any question or write a program."""
    return await run_ai_ask(body.prompt)
@app.post("/api/ai-fix")
async def ai_fix_current(body: AiRequest):
    """Analyze the exact editor snapshot with AI and return a fix proposal."""
    return await run_ai_fix(body)
@app.post("/api/rooms/{rid}/ai-fix")
async def ai_fix(rid: str, actor_id: str, body: AiRequest):
    r=get_room(rid); member=r.members.get(actor_id)
    if not member or member.role=="viewer": raise HTTPException(403,"AI permission denied")
    suggestion = await run_ai_fix(body)
    await broadcast(rid,"ai:fix_ready",suggestion); return suggestion
@app.websocket("/ws/rooms/{rid}/{uid}")
async def websocket(ws: WebSocket, rid: str, uid: str):
    r=get_room(rid)
    is_member=uid in r.members; is_pending=uid in r.pending
    if not (is_member or is_pending): await ws.close(code=4403); return
    await ws.accept(); sockets[rid][uid] = ws
    if is_member:
        await ws.send_json({"event": "room:members", "data": [m.model_dump() for m in r.members.values()]})
        await ws.send_json({"event": "presence:states", "data": _snapshot(rid)})
        await broadcast(rid, "room:user_joined", r.members[uid].model_dump(), uid)
    try:
        while True:
            event = await ws.receive_json()
            # Event payloads are bounded and permissions are enforced for state-changing actions.
            ev = event.get("event")
            data = event.get("data", {}) or {}
            if ev == "editor:activefile" and uid in r.members:
                path = data.get("path") or data.get("file") or ""
                if path:
                    active_files[rid][uid] = {"path": path, "name": r.members[uid].name}
                else:
                    active_files[rid].pop(uid, None)
                await broadcast(rid, "presence:update", _snapshot(rid))
            elif ev in {"chat:message", "editor:cursor", "editor:selection", "typing", "execution:start", "execution:result", "ai:fix_ready", "file:renamed", "file:deleted"}:
                await broadcast(rid, ev, data, uid)
    except WebSocketDisconnect: pass
    finally:
        if sockets[rid].get(uid) is ws: sockets[rid].pop(uid, None)
        if is_member:
            active_files[rid].pop(uid, None)
            await broadcast(rid, "room:user_left", {"id": uid})
            await broadcast(rid, "presence:update", _snapshot(rid))
@app.get("/health")
async def health(): return {"status":"ok"}
@app.get("/api/network")
async def network():
    """Report the LAN IP of the machine the backend runs on, so localhost users
    can generate a share link/QR that phones on the same Wi-Fi can open."""
    ip = "0.0.0.0"; s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80)); ip = s.getsockname()[0]
    except OSError: pass
    finally: s.close()
    return {"ip": ip, "port": 5173}
