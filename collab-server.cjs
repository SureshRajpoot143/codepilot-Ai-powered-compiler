#!/usr/bin/env node
/**
 * CodeFix AI collaboration server.
 *
 * A thin wrapper around y-websocket that turns the stateless CRDT relay into a
 * multi-module workspace backend:
 *
 *   - Document naming mirrors the workspace model:
 *       <project_id>:tree           -> shared file-tree Y.Doc (presence + tree sync)
 *       <project_id>:<b64url(path)> -> per-file sub-room Y.Doc (keystroke sync only
 *                                      happens between users with the file open)
 *   - setContentInitializor() seeds a freshly-loaded file doc from the disk store
 *     written by FastAPI (backend is authoritative; no client-side seeding races).
 *   - Per-file debounced persistence: 2s trailing (10s max) after any keystroke,
 *     file text is written back to data/projects/<pid>/content/<path> atomically.
 *
 * Start with:   npm run collab   (or node collab-server.cjs)
 */
const http = require('http')
const fs = require('fs')
const path = require('path')
const Y = require('yjs')
const { setContentInitializor, setupWSConnection } = require('y-websocket/bin/utils')

const HOST = process.env.HOST || '0.0.0.0'
const PORT = parseInt(process.env.PORT || '1234', 10)
const DATA_DIR = process.env.DATA_DIR || (path.join(__dirname, 'data'))
const SAVE_DEBOUNCE_WAIT = parseInt(process.env.SAVE_DEBOUNCE_WAIT || '2000', 10)
const SAVE_DEBOUNCE_MAXWAIT = parseInt(process.env.SAVE_DEBOUNCE_MAXWAIT || '10000', 10)

const contentDir = pid => path.join(DATA_DIR, 'projects', pid, 'content')
const safeRel = p => p.replace(/[^A-Za-z0-9._/ -]/g, '_').replace(/^\/+/, '')

// docName -> { rid, path } for file sub-rooms. Tree docs and anything else are left alone.
function parseFileDoc(docName) {
  if (docName.endsWith(':tree')) return null
  const i = docName.indexOf(':')
  if (i <= 0) return null
  const rid = docName.slice(0, i)
  const b64 = docName.slice(i + 1)
  if (!b64 || !/^[A-Za-z0-9_-]+$/.test(b64)) return null
  let raw
  try { raw = Buffer.from(b64, 'base64url').toString('utf8') } catch { return null }
  return { rid, file: safeRel(raw) }
}

function readContent(rid, file) {
  try {
    return fs.readFileSync(path.join(contentDir(rid), file), 'utf8')
  } catch { return null }
}

function writeContent(rid, file, text) {
  const target = path.join(contentDir(rid), file)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tmp, text, 'utf8')
  fs.renameSync(tmp, target)
}

// Seed a fresh file doc directly from disk (runs once per doc creation).
setContentInitializor(ydoc => {
  const parsed = parseFileDoc(ydoc.name)
  if (!parsed) return Promise.resolve()
  const text = readContent(parsed.rid, parsed.file)
  if (text === null) return Promise.resolve()
  const ytext = ydoc.getText('content')
  if (ytext.length === 0) ytext.insert(0, text)
  return Promise.resolve()
})

const pendingSaves = new Map() // key -> { timer, first }

function scheduleSave(ydoc) {
  const parsed = parseFileDoc(ydoc.name)
  if (!parsed) return
  const key = ydoc.name
  const now = Date.now()
  const p = pendingSaves.get(key) || { timer: null, first: now }
  clearTimeout(p.timer)
  const remaining = SAVE_DEBOUNCE_MAXWAIT - (now - p.first)
  const delay = remaining > 0 ? Math.min(SAVE_DEBOUNCE_WAIT, remaining) : 0
  p.timer = setTimeout(() => {
    pendingSaves.delete(key)
    if (ydoc.destroyed) return
    writeContent(parsed.rid, parsed.file, ydoc.getText('content').toString())
  }, delay)
  pendingSaves.set(key, p)
}

const WebSocket = require('ws')
const wss = new WebSocket.Server({ noServer: true })

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('okay')
})

wss.on('connection', (ws, req) => {
  const docName = (req.url || '').slice(1).split('?')[0]
  setupWSConnection(ws, req, { docName })
  if (parseFileDoc(docName)) {
    const { docs } = require('y-websocket/bin/utils')
    const ydoc = docs.get(docName)
    if (ydoc && !ydoc._cfxPersistenceBound) {
      ydoc._cfxPersistenceBound = true
      ydoc.on('update', () => scheduleSave(ydoc))
    }
  }
})

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, ws => {
    wss.emit('connection', ws, request)
  })
})

server.listen(PORT, HOST, () => {
  console.log(`[collab] running at ${HOST}:${PORT} — persistence dir ${DATA_DIR}`)
})