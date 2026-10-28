from __future__ import annotations
import json
import os
import time
from pathlib import Path
from typing import Any
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(override=True)

DATA_DIR = Path(os.getenv("DATA_DIR", str(Path(__file__).resolve().parents[2] / "data"))).resolve()
PROJECTS_DIR = DATA_DIR / "projects"
USERS_FILE = DATA_DIR / "users.json"

URI = os.getenv("MONGODB_URI")
DB_NAME = os.getenv("DATABASE_NAME") or "codefix_ai"

_client: MongoClient | None = None
_col_users = None
_col_projects = None


def _client_connect():
    global _client, _col_users, _col_projects
    if _client is not None:
        return
    if not URI:
        # fallback to file if no URI
        _client = None
        return
    _client = MongoClient(URI, serverSelectionTimeoutMS=1500)
    db = _client.get_database(DB_NAME)
    _col_users = db["users"]
    _col_projects = db["projects"]


def init_store() -> None:
    _client_connect()
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)


def _get_users_col():
    _client_connect()
    return _col_users


def _get_projects_col():
    _client_connect()
    return _col_projects


def upsert_user(user_id: str, name: str) -> dict[str, Any]:
    col = _get_users_col()
    now = time.time()
    if col is not None:
        col.update_one({"_id": user_id}, {"$set": {"name": name[:40], "updated_at": now}, "$setOnInsert": {"created_at": now}}, upsert=True)
        d = col.find_one({"_id": user_id}) or {"_id": user_id, "name": name[:40]}
        return {"id": d["_id"], "name": d["name"], "created_at": d.get("created_at", now)}
    # fallback file
    from . import store as disk
    return disk.upsert_user(user_id, name)


def list_projects(owner_id: str | None = None, **kwargs) -> list[dict[str, Any]]:
    col = _get_projects_col()
    if col is not None:
        q = {}
        if owner_id:
            q["owner_id"] = owner_id
        out = []
        for p in col.find(q, {"_id": 1, "name": 1, "filesystem": 1, "created_at": 1}).sort([("created_at", -1)]).limit(20):
            out.append({"project_id": p["_id"], "name": p.get("name") or p["_id"], "files": len(p.get("filesystem") or []), "created_at": p.get("created_at")})
        return out
    from . import store as disk
    try:
        return disk.list_projects(owner_id)
    except Exception:
        try:
            return disk.list_projects(**kwargs)
        except Exception:
            return disk.list_projects()


def create_project(host_id: str, name: str, starter: dict[str, Any]) -> dict[str, Any]:
    col = _get_projects_col()
    now = time.time()
    pid = __import__("random").choices("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", k=6)
    pid = "CFX-" + "".join(pid)
    # ensure unique
    if col is not None:
        while col.find_one({"_id": pid}):
            pid = "CFX-" + "".join(__import__("random").choices("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", k=6))
    else:
        from . import store as disk
        return disk.create_project(host_id, name, starter)
    doc = {"_id": pid, "name": name or pid, "owner_id": host_id, "host_id": host_id, "members": {host_id: {"id": host_id, "name": "Host", "role": "host"}}, "filesystem": starter.get("filesystem", []), "created_at": now, "updated_at": now}
    col.insert_one(doc)
    return {"id": pid, "project_id": pid, **doc}


def load_project(project_id: str) -> dict[str, Any] | None:
    col = _get_projects_col()
    if col is not None:
        p = col.find_one({"_id": project_id})
        if not p:
            return None
        return {"id": p["_id"], "project_id": p["_id"], "name": p["name"], "owner_id": p.get("owner_id"), "host_id": p.get("host_id"), "members": p.get("members", {}), "filesystem": p.get("filesystem", [])}
    from . import store as disk
    return disk.load_project(project_id)


def save_project(project: dict[str, Any]) -> None:
    col = _get_projects_col()
    if col is None:
        from . import store as disk
        return disk.save_project(project)
    pid = project["id"]
    col.update_one({"_id": pid}, {"$set": {"name": project.get("name"), "host_id": project.get("host_id"), "members": project.get("members", {}), "filesystem": project.get("filesystem", []), "updated_at": time.time()}}, upsert=True)


def save_file(project_id: str, path: str, content: str, language: str | None = None) -> None:
    col = _get_projects_col()
    if col is None:
        from . import store as disk
        return disk.save_file(project_id, path, content, language)
    p = col.find_one({"_id": project_id})
    if not p:
        return
    fs = p.get("filesystem") or []
    found = False
    for n in fs:
        if n["path"] == path:
            n["language"] = language or n.get("language")
            found = True
            break
    if not found:
        from pathlib import Path as P
        name = Path(path).name
        fs.append({"path": path, "name": name, "parent": str(P(path).parent).replace(".", "") if P(path).parent.name else "", "is_directory": False, "language": language or "text"})
    col.update_one({"_id": project_id}, {"$set": {"filesystem": fs, "updated_at": time.time()}})


def add_nodes(project_id: str, nodes: list[dict[str, Any]]) -> None:
    col = _get_projects_col()
    if col is None:
        from . import store as disk
        return disk.add_nodes(project_id, nodes)
    p = col.find_one({"_id": project_id})
    if not p:
        return
    fs = list(p.get("filesystem") or [])
    paths = {n["path"] for n in fs}
    for n in nodes:
        if n["path"] not in paths:
            fs.append(n); paths.add(n["path"])
    col.update_one({"_id": project_id}, {"$set": {"filesystem": fs, "updated_at": time.time()}})


def rename_node(project_id: str, from_path: str, to_path: str) -> None:
    col = _get_projects_col()
    if col is None:
        from . import store as disk
        return disk.rename_node(project_id, from_path, to_path)
    p = col.find_one({"_id": project_id})
    if not p:
        return
    fs = list(p.get("filesystem") or [])
    for n in fs:
        if n["path"] == from_path:
            n["path"] = to_path; n["name"] = Path(to_path).name; n["parent"] = str(Path(to_path).parent).replace(".", "") if Path(to_path).parent.name else ""
        elif n["path"].startswith(from_path + "/"):
            np = to_path + n["path"][len(from_path):]
            n["path"] = np; n["parent"] = str(Path(np).parent) if Path(np).parent.name else ""
    col.update_one({"_id": project_id}, {"$set": {"filesystem": fs, "updated_at": time.time()}})


def delete_node(project_id: str, path: str) -> None:
    col = _get_projects_col()
    if col is None:
        from . import store as disk
        return disk.delete_node(project_id, path)
    p = col.find_one({"_id": project_id})
    if not p:
        return
    fs = [n for n in p.get("filesystem") or [] if not (n["path"] == path or n["path"].startswith(path + "/"))]
    col.update_one({"_id": project_id}, {"$set": {"filesystem": fs, "updated_at": time.time()}})


def read_file_content(project_id: str, path: str) -> str | None:
    col = _get_projects_col()
    if col is not None:
        p = col.find_one({"_id": project_id}, {"content_files": 1})
        if p and p.get("content_files") and path in p["content_files"]:
            return p["content_files"][path]
    from . import store as disk
    return disk.read_file_content(project_id, path)


def write_file_content(project_id: str, path: str, content: str) -> None:
    col = _get_projects_col()
    if col is not None:
        col.update_one({"_id": project_id}, {"$set": {f"content_files.{path}": content, "updated_at": time.time()}}, upsert=False)
        return
    from . import store as disk
    return disk.write_file_content(project_id, path, content)
