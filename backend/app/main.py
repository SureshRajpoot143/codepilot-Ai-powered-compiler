"""CodeFix AI application API. Room permissions remain server authoritative."""
from __future__ import annotations
import asyncio, os, random, socket, string, time, json
from collections import defaultdict
from typing import Any, Literal
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

load_dotenv()

app = FastAPI(title="CodeFix AI", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("FRONTEND_URL", "http://localhost:5173").split(","), allow_methods=["*"], allow_headers=["*"], allow_credentials=True)

class Member(BaseModel):
    id: str; name: str = Field(max_length=40); device: str = "Desktop"
    role: Literal["host", "editor", "viewer"] = "viewer"
class Room(BaseModel):
    id: str; host_id: str; members: dict[str, Member] = {}; pending: dict[str, Member] = {}; expires_at: float
class Execute(BaseModel):
    code: str = Field(max_length=100_000); language: Literal["python", "c", "cpp", "java", "javascript"]; stdin: str = Field(default="", max_length=20_000)
class AiRequest(Execute):
    stderr: str = Field(max_length=20_000)
class AskRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=20_000)
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
def room_id() -> str: return "CFX-" + "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
async def broadcast(rid: str, event: str, data: Any, except_id: str | None = None):
    payload={"event": event, "data": data}
    for user, ws in list(sockets[rid].items()):
        if user != except_id:
            try: await ws.send_json(payload)
            except RuntimeError: sockets[rid].pop(user, None)
def get_room(rid: str) -> Room:
    r=rooms.get(rid)
    if not r or r.expires_at < time.time(): raise HTTPException(404, "Room not found or expired")
    return r
@app.post("/api/rooms", response_model=Room)
async def create_room(host: Member):
    rid=room_id(); host.role="host"; room=Room(id=rid,host_id=host.id,members={host.id:host},expires_at=time.time()+7200); rooms[rid]=room; return room
@app.get("/api/rooms/{rid}", response_model=Room)
async def room(rid: str): return get_room(rid)
@app.post("/api/rooms/{rid}/join")
async def request_join(rid: str, member: Member):
    r=get_room(rid); r.pending[member.id]=member; await broadcast(rid,"room:join_request",member.model_dump()); return {"status":"pending"}
@app.post("/api/rooms/{rid}/members/{uid}/approve")
async def approve(rid: str, uid: str, host_id: str, role: Literal["editor","viewer"]="editor"):
    r=get_room(rid)
    if r.host_id != host_id: raise HTTPException(403,"Host permission required")
    m=r.pending.pop(uid,None)
    if not m: raise HTTPException(404,"Join request not found")
    m.role=role;r.members[uid]=m;await broadcast(rid,"room:join_accepted",m.model_dump());return m
@app.post("/api/rooms/{rid}/members/{uid}/reject")
async def reject(rid: str, uid: str, host_id: str):
    r=get_room(rid)
    if r.host_id != host_id: raise HTTPException(403,"Host permission required")
    m=r.pending.pop(uid,None)
    if not m: raise HTTPException(404,"Join request not found")
    await broadcast(rid,"room:join_rejected",m.model_dump()); return {"status":"rejected"}
@app.delete("/api/rooms/{rid}/members/{uid}")
async def remove_member(rid: str, uid: str, host_id: str):
    """Host kicks any member: they are removed, disconnected, and notified."""
    r=get_room(rid)
    if r.host_id != host_id: raise HTTPException(403,"Host permission required")
    if uid == host_id: raise HTTPException(400,"The host cannot remove themself")
    m=r.members.pop(uid,None)
    if not m: raise HTTPException(404,"Member not found")
    await broadcast(rid,"room:removed",m.model_dump())
    ws=sockets[rid].pop(uid,None)
    if ws:
        try: await ws.close(code=4000)
        except RuntimeError: pass
    return {"status":"removed"}
@app.delete("/api/rooms/{rid}")
async def close_room(rid: str, host_id: str):
    """Host leaves and closes the room: everyone is disconnected and the room is deleted."""
    r=get_room(rid)
    if r.host_id != host_id: raise HTTPException(403,"Host permission required")
    rooms.pop(rid, None)
    await broadcast(rid,"room:closed",{"id": rid})
    for ws in list(sockets[rid].values()):
        try: await ws.close(code=1000)
        except RuntimeError: pass
    sockets.pop(rid, None)
    return {"status":"closed"}
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
    await ws.accept(); sockets[rid][uid]=ws
    if is_member:
        await ws.send_json({"event":"room:members","data":[m.model_dump() for m in r.members.values()]})
        await broadcast(rid,"room:user_joined",r.members[uid].model_dump(),uid)
    try:
        while True:
            event=await ws.receive_json()
            # Event payloads are bounded and permissions are enforced for state-changing actions.
            if event.get("event") in {"chat:message","editor:cursor","editor:selection","typing","execution:start","execution:result","ai:fix_ready"}:
                await broadcast(rid,event["event"],event.get("data",{}),uid)
    except WebSocketDisconnect: pass
    finally:
        if sockets[rid].get(uid) is ws: sockets[rid].pop(uid,None)
        if is_member: await broadcast(rid,"room:user_left",{"id":uid})
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
