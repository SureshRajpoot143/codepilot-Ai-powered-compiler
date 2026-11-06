// Downloads the Pyodide runtime into public/pyodide (same-origin requirement
// for SharedArrayBuffer/interactive stdin under cross-origin isolation).
import {existsSync, statSync} from 'node:fs'
import {mkdirSync, createWriteStream, writeFileSync} from 'node:fs'
import {pipeline} from 'node:stream/promises'
import {Readable} from 'node:stream'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const VERSION = '0.26.2'
const FILES = ['pyodide.js', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']
const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'public', 'pyodide')

mkdirSync(outDir, {recursive: true})
let existing = 0
for (const f of FILES) {
  const p = join(outDir, f)
  if (existsSync(p) && statSync(p).size > 0) existing++
}
if (existing === FILES.length) {
  console.log('[pyodide] already downloaded')
  process.exit(0)
}
for (const f of FILES) {
  const url = `https://cdn.jsdelivr.net/pyodide/v${VERSION}/full/${f}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`[pyodide] failed to download ${url}: HTTP ${res.status}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(join(outDir, f)))
  console.log(`[pyodide] ${f} ✓`)
}
writeFileSync(join(outDir, '.version'), VERSION)
console.log('[pyodide] ready')
process.exit(0)
