"""File-backed persistence for the multi-module workspace.

Mirrors the relational design (Users, Projects, Project_Members, FileSystem)
without requiring a database server:

    <DATA_DIR>/
        users.json                        # Users   -> { "U-..." : {id,name,created_at} }
        projects/<project_id>/
            project.json                  # Projects + Project_Members + FileSystem tree
            content/<relative path>       # raw file text (seeded/saved by the collab server too)

Writes are atomic (temp file + os.replace) so the collab server and FastAPI can
safely share the same store on one machine.
"""
from __future__ import annotations
import json
import os
import re
import time
import uuid
from pathlib import Path
from typing import Any

DATA_DIR = Path(os.getenv("DATA_DIR", str(Path(__file__).resolve().parents[2] / "data"))).resolve()
PROJECTS_DIR = DATA_DIR / "projects"
USERS_FILE = DATA_DIR / "users.json"
_SAFE = re.compile(r"[^A-Za-z0-9._/ -]")


def init_store() -> None:
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)


def _read_json(path: Path, default: Any) -> Any:
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)


def _load_users() -> dict[str, dict[str, Any]]:
    return _read_json(USERS_FILE, {})


def upsert_user(user_id: str, name: str) -> dict[str, Any]:
    users = _load_users()
    now = time.time()
    user = users.get(user_id) or {"id": user_id, "created_at": now}
    user["name"] = name[:40]
    user["updated_at"] = now
    users[user_id] = user
    _write_json(USERS_FILE, users)
    return user


def get_user(user_id: str) -> dict[str, Any] | None:
    return _load_users().get(user_id)


def project_path(rid: str) -> Path:
    return PROJECTS_DIR / rid


def _project_meta(rid: str) -> dict[str, Any] | None:
    meta = _read_json(project_path(rid) / "project.json", None)
    return meta if isinstance(meta, dict) else None


def sanitize_path(path: str) -> str:
    """Normalize a workspace path and reject path traversal."""
    cleaned = _SAFE.sub("_", path).strip("/")
    if not cleaned or ".." in cleaned.split("/"):
        raise ValueError("Invalid path")
    return cleaned


def content_file(rid: str, path: str) -> Path:
    return project_path(rid) / "content" / sanitize_path(path)


def ensure_project(
    rid: str,
    owner_id: str,
    name: str,
    members: dict[str, Any] | None = None,
    language: str = "python",
) -> dict[str, Any]:
    """Load an existing project or create one. Never overwrites existing tree."""
    project = _project_meta(rid)
    if project is None:
        project = {
            "project_id": rid,
            "name": (name or rid)[:80],
            "owner_id": owner_id,
            "created_at": time.time(),
            "updated_at": time.time(),
            "language": language,
            "members": _member_payload(members or {}),
            "filesystem": [],
        }
        _save_project(rid, project)
    elif "language" not in project:
        project["language"] = language
        _save_project(rid, project)
    return project


def _member_payload(members: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for uid, member in members.items():
        out[uid] = {
            "id": uid,
            "name": getattr(member, "name", member.get("name") if isinstance(member, dict) else uid),
            "device": getattr(member, "device", member.get("device", "Desktop") if isinstance(member, dict) else "Desktop"),
            "role": getattr(member, "role", member.get("role", "viewer") if isinstance(member, dict) else "viewer"),
        }
    return out


def _save_project(rid: str, project: dict[str, Any]) -> None:
    project["updated_at"] = time.time()
    _write_json(project_path(rid) / "project.json", project)


def save_project(rid: str, project: dict[str, Any]) -> None:
    _save_project(rid, project)


def load_project(rid: str) -> dict[str, Any] | None:
    """Full project meta (including filesystem) or None."""
    return _project_meta(rid)


def list_projects(owner_id: str, owner_name: str = "") -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if not PROJECTS_DIR.exists():
        return out
    for folder in PROJECTS_DIR.iterdir():
        if not folder.is_dir():
            continue
        meta = _read_json(folder / "project.json", None)
        if not isinstance(meta, dict):
            continue
        members = meta.get("members", {})
        name_match = any(
            isinstance(member, dict) and member.get("name", "").strip().casefold() == owner_name.strip().casefold()
            for member in members.values()
        ) if owner_name.strip() else False
        if (not owner_id and not owner_name) or meta.get("owner_id") == owner_id or name_match:
            out.append({
                "project_id": meta["project_id"],
                "name": meta.get("name"),
                "created_at": meta.get("created_at"),
                "files": sum(
                    0 if n.get("is_directory") else 1 for n in meta.get("filesystem", [])
                ),
            })
    out.sort(key=lambda p: p.get("updated_at", p.get("created_at", 0)) or 0, reverse=True)
    return out


def sync_members(rid: str, members: dict[str, Any]) -> None:
    project = _project_meta(rid)
    if project is None:
        return
    project["members"] = _member_payload(members)
    _save_project(rid, project)


def save_file(rid: str, path: str, content: str, language: str | None = None) -> None:
    path = sanitize_path(path)
    target = content_file(rid, path)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(target.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(content)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, target)
    project = _project_meta(rid)
    if project is None:
        return
    nodes = project["filesystem"]
    if not any(n.get("path") == path and not n.get("is_directory") for n in nodes):
        nodes.append({
            "id": uuid.uuid4().hex[:12],
            "parent_id": _parent_of(path),
            "name": path.rsplit("/", 1)[-1],
            "path": path,
            "is_directory": False,
            "language": language or _language_for(path),
        })
    _save_project(rid, project)


def read_file(rid: str, path: str) -> str | None:
    target = content_file(rid, path)
    try:
        return target.read_text(encoding="utf-8")
    except OSError:
        return None


def create_node(
    rid: str,
    parent: str,
    name: str,
    is_directory: bool,
    language: str | None = None,
    owner_id: str = "system",
) -> dict[str, Any]:
    """Create a file or folder in the filesystem tree, returning the node."""
    project = ensure_project(rid, owner_id, "")
    nodes = project["filesystem"]
    name = _SAFE.sub("_", name).strip()
    if not name or name in {".", ".."}:
        raise ValueError("Invalid name")
    parent = sanitize_path(parent) if parent else ""
    path = f"{parent}/{name}" if parent else name
    if any(n.get("path") == path for n in nodes):
        raise ValueError(f"'{path}' already exists")
    node = {
        "id": uuid.uuid4().hex[:12],
        "parent_id": _parent_of(path),
        "name": name,
        "path": path,
        "is_directory": is_directory,
        "language": ("folder" if is_directory else language) or _language_for(path),
        "created_at": time.time(),
    }
    nodes.append(node)
    _save_project(rid, project)
    if is_directory:
        (project_path(rid) / "content" / path).mkdir(parents=True, exist_ok=True)
    else:
        target = content_file(rid, path)
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            target.write_text("", encoding="utf-8")
    return node


def rename_node(rid: str, path: str, to: str, owner_id: str = "system", language: str | None = None) -> dict[str, Any]:
    """Move a file/folder (with all children) and its disk content to a new path."""
    project = ensure_project(rid, owner_id, "")
    nodes = project["filesystem"]
    path = sanitize_path(path)
    to = sanitize_path(to)
    if path == to:
        return {"path": to}
    if not any(n.get("path") == path for n in nodes):
        raise ValueError(f"'{path}' not found")
    if any(n.get("path") == to and n.get("path") != path for n in nodes):
        raise ValueError(f"'{to}' already exists")
    moved: dict[str, Any] | None = None
    for node in nodes:
        if node.get("path") == path or node.get("path", "").startswith(path + "/"):
            new_path = to + node["path"][len(path):]
            node["path"] = new_path
            node["parent_id"] = _parent_of(new_path)
            node["name"] = new_path.rsplit("/", 1)[-1]
            if new_path == to:
                moved = node
    if language and moved is not None and not moved.get("is_directory"):
        moved["language"] = language
    _save_project(rid, project)
    _move_content(rid, path, to)
    return moved or {"path": to}


def _move_content(rid: str, path: str, to: str) -> None:
    src = project_path(rid) / "content" / path
    dst = project_path(rid) / "content" / to
    if not src.exists():
        return
    if src.is_dir():
        dst.parent.mkdir(parents=True, exist_ok=True)
        if dst.exists():
            dst.unlink()
        tmp = dst.with_name(f".rename-{uuid.uuid4().hex[:6]}")
        src.rename(tmp)
        tmp.rename(dst)
    else:
        dst.parent.mkdir(parents=True, exist_ok=True)
        src.rename(dst)


def delete_node(rid: str, path: str, owner_id: str = "system") -> None:
    project = ensure_project(rid, owner_id, "")
    nodes = project["filesystem"]
    path = sanitize_path(path)
    project["filesystem"] = [n for n in nodes if not (n.get("path") == path or n.get("path", "").startswith(path + "/"))]
    _save_project(rid, project)
    target = project_path(rid) / "content" / path
    if target.exists():
        if target.is_dir():
            import shutil
            shutil.rmtree(target, ignore_errors=True)
        else:
            target.unlink(missing_ok=True)


IGNORED_DIR_NAMES = {
    "node_modules", ".git", "__pycache__", ".venv", "venv", "env",
    "dist", "build", "out", "target", ".next", ".nuxt", ".svelte-kit",
    ".idea", ".vscode", ".svn", ".hg", ".pytest_cache", ".mypy_cache", ".ruff_cache",
}
IGNORED_FILE_EXTS = (
    ".pyc", ".pyo", ".class", ".exe", ".dll", ".dylib", ".so", ".a", ".o",
    ".obj", ".jar", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp",
    ".pdf", ".zip", ".tar", ".gz", ".tgz", ".7z", ".rar", ".bin", ".woff",
    ".woff2", ".ttf", ".eot", ".map", ".deb", ".rpm", ".ipynb",
)


def import_files(
    rid: str,
    entries: list[tuple[str, str]],
    owner_id: str = "system",
) -> dict[str, Any]:
    """Merge an external project into a room's workspace.

    `entries` is a list of ``(relative_path, text_content)``. Parent folder
    nodes are created as needed; existing files are overwritten in place.
    Junk/build/binary files are skipped and reported back.
    """
    ensure_project(rid, owner_id, "")
    added: list[str] = []
    skipped: list[str] = []
    for raw_path, content in entries:
        try:
            rel = sanitize_path(raw_path)
        except ValueError:
            skipped.append(raw_path)
            continue
        if not rel or rel in {".", ".."}:
            skipped.append(raw_path)
            continue
        parts = rel.split("/")
        if any(p in IGNORED_DIR_NAMES for p in parts):
            skipped.append(rel)
            continue
        if rel.endswith(IGNORED_FILE_EXTS) or rel in {".env", "package-lock.json"}:
            skipped.append(rel)
            continue
        if len(content) > 1_000_000:
            skipped.append(rel)
            continue
        nodes = load_project(rid).get("filesystem", []) if load_project(rid) else []
        for i in range(1, len(parts)):
            ppath = "/".join(parts[:i])
            if not any(n.get("path") == ppath for n in nodes):
                create_node(rid, "/".join(parts[: i - 1]) if i > 1 else "", parts[i - 1], True, owner_id=owner_id)
        save_file(rid, rel, content, _language_for(rel))
        added.append(rel)
    return {"added": added, "skipped": skipped}


def _parent_of(path: str) -> str:
    return path.rsplit("/", 1)[0] if "/" in path else ""


def _language_for(path: str) -> str:
    ext = path.rsplit(".", 1)[-1].lower() if "." in path else ""
    return {
        "py": "python", "js": "javascript", "c": "c", "cpp": "cpp",
        "java": "java", "md": "markdown", "txt": "text", "json": "json",
        "ts": "typescript", "html": "html", "css": "css",
    }.get(ext, "text")