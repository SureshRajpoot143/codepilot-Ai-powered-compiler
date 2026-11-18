import React, {useEffect, useMemo, useRef, useState} from 'react'
import {createRoot} from 'react-dom/client'
import Editor, {OnMount} from '@monaco-editor/react'
import {QRCodeSVG} from 'qrcode.react'
import * as Y from 'yjs'
import {WebsocketProvider} from 'y-websocket'
import {MonacoBinding} from 'y-monaco'
import FileTree from './components/workspace/FileTree'
import EditorTabs from './components/workspace/EditorTabs'
import AiPanel from './components/workspace/AiPanel'
import TerminalPanel from './components/workspace/TerminalPanel'
import {type PanelName} from './components/workspace/TerminalPanel'
import ResizeHandle from './components/workspace/ResizeHandle'
import {usePanelResize} from './hooks/usePanelResize'
import './styles.css'
import './ide-refinements.css'

type Role='host'|'editor'|'viewer'|'guest'
type Member={id:string;name:string;device:string;role:Role}
type User={id:string;name:string;device:string;role:Role;color:string}
type TreeNode={path:string;name:string;parent:string;isDir:boolean;language:string}
type FileTab={path:string;name:string;language:string;code:string}
type Presence={id:string;name:string;activeFile:string}
type ProviderGroup={doc:Y.Doc;provider:WebsocketProvider;yt:Y.Text}
type ExplainData={program_summary?:string;how_it_works?:string[];key_parts?:string[];root_cause?:string;explanation?:string;changes?:string[];fixed_code?:string;verified?:boolean|null;verification_error?:string;needs_input?:boolean;attempts?:number}
const ExplainResult=({data,currentCode,onApply,onDismiss}:{data:ExplainData;currentCode:string;onApply:()=>void;onDismiss:()=>void})=><div className="fix explanation-result">
 <strong>Program explanation</strong>
 <p>{data.program_summary||'A detailed program explanation is unavailable.'}</p>
 {!!data.how_it_works?.length&&<><b>How it works</b><ol>{data.how_it_works.map((step,index)=><li key={index}>{step}</li>)}</ol></>}
 {!!data.key_parts?.length&&<><b>Important parts</b><ul>{data.key_parts.map((part,index)=><li key={index}>{part}</li>)}</ul></>}
 <p><b>Code check:</b> {data.root_cause||'Review complete.'}</p>
 {data.verified===true&&<p className="ok">✓ Verified — the fixed code was executed and runs successfully.</p>}
 {data.verified===false&&<p className="warning">⚠ The AI fix was executed and still fails: {data.verification_error||'unknown error'}</p>}
 {data.needs_input&&<p className="hint">This program waits for keyboard input. Add the values it needs in the <b>Input</b> tab, then press ▶ Run.</p>}
 {data.explanation&&<p><b>Suggested fix:</b> {data.explanation}</p>}
 {!!data.changes?.length&&<p><b>Changes:</b> {data.changes.join(', ')}</p>}
 <button className="ghost" onClick={onDismiss}>Close</button>
 {data.fixed_code&&data.fixed_code!==currentCode&&<button onClick={onApply}>Apply Fix</button>}
</div>
const initial=`# Welcome to CodeFix AI\n# Invite teammates and edit together in real time.\ndef hello():\n    print("Hello, World!")\n\nhello()\n`
const extensions:Record<string,string>={python:'py',javascript:'js',cpp:'cpp',c:'c',java:'java',markdown:'md',typescript:'ts',json:'json',text:'txt'}
const extToLang:Record<string,string>={py:'python',js:'javascript',jsx:'javascript',ts:'typescript',tsx:'typescript',c:'c',h:'c',cpp:'cpp',java:'java',md:'markdown',txt:'text',json:'json',css:'css',html:'html'}
const iconOf:Record<string,string>={folder:'▸',folderOpen:'▾',python:'ᵖ',javascript:'ᴊ',typescript:'ᵗ',c:'ᶜ',cpp:'⁺⁺',java:'ᵍ',markdown:'ᵐ',json:'{}',text:'◫'}
 const linkedRoom=location.pathname.match(/^\/room\/([^/]+)\/?$/)?.[1]
 // Empty on localhost (Vite proxy handles /api and /ws); set to the deployed
 // backend origin (e.g. https://codefix-ai-backend.onrender.com) in production.
 const apiBase=import.meta.env.VITE_BACKEND_URL||''
 const apiWsBase=apiBase?apiBase.replace(/^http/,'ws'):`${location.protocol==='https:'?'wss':'ws'}://${location.host}`
 const collabUrl=import.meta.env.VITE_COLLAB_URL || `${location.protocol==='https:'?'wss':'ws'}://${location.hostname}:1234`
const wsProto=location.protocol==='https:'?'wss':'ws'
const meId=(()=>{let id=localStorage.getItem('cfx_me')||'';if(!id){id='U-'+Math.random().toString(36).slice(2,10).toUpperCase();localStorage.setItem('cfx_me',id)};return id})()
const savedTheme=(localStorage.getItem('cfx_theme')==='light'?'light':'dark') as 'light'|'dark'
document.documentElement.dataset.theme=savedTheme
const myDevice=/Mobi|Android|iPhone/i.test(navigator.userAgent)?'Mobile':'This device'
const starterPrograms:Record<string,string>={
 python:initial,
 javascript:`// Welcome to CodeFix AI\n// Invite teammates and edit together in real time.\n\nfunction hello() {\n  console.log("Hello, World!");\n}\n\nhello();\n`,
 c:`#include <stdio.h>\n\nint main(void) {\n    printf("Hello, World!\\n");\n    return 0;\n}\n`,
 cpp:`#include <iostream>\n\nint main() {\n    std::cout << "Hello, World!" << std::endl;\n    return 0;\n}\n`,
 java:`public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}\n`,
 markdown:'# CodeFix AI workspace\n\nInvite teammates and write together.\n',
}
const colors=['#7c5cff','#00b894','#ff8a4c','#e056fd']
const colorFor=(id:string)=>colors[Array.from(id).reduce((a,c)=>a+c.charCodeAt(0),0)%colors.length]
const roleLabel:Record<Role,string>={host:'Host',editor:'Editor',viewer:'Viewer',guest:'Guest'}
const baseName=(p:string)=>p.split('/').pop()||p
const parentOf=(p:string)=>p.includes('/')?p.slice(0,p.lastIndexOf('/')):''
const langOf=(p:string)=>extToLang[(p.split('.').pop()||'').toLowerCase()]||'text'
const b64u=(s:string)=>btoa(unescape(encodeURIComponent(s))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
const fileDocName=(r:string,p:string)=>`${r}:${b64u(p)}`
const treeDocName=(r:string)=>`${r}:tree`
async function api(path:string,opts:RequestInit={}){
  const res=await fetch(`${apiBase}/api${path}`,{headers:{'Content-Type':'application/json'},...opts})
 const raw=await res.text();let data:any={};try{data=raw?JSON.parse(raw):{}}catch{}
 if(!res.ok){
    // FastAPI validation errors are arrays of {loc,msg}; stringifying them
    // directly used to surface as "[object Object]" in the UI.
    let detail=data?.detail??data?.error??`Request failed (${res.status})`
    if(Array.isArray(detail))detail=detail.map((d:any)=>[Array.isArray(d?.loc)?d.loc[d.loc.length-1]:d?.loc,d?.msg].filter(Boolean).join(': ')||String(d)).join('; ')
    else if(detail&&typeof detail==='object')detail=JSON.stringify(detail)
    throw new Error(String(detail))
  }
  return data
}
// ---- Browser-side execution fallback (no JDoodle needed) ----
type ExecResult={status:string;stdout:string;stderr:string;time?:string;memory?:string}
let interactiveEnv:{sendLine:(text:string)=>void}|null=null
const setInteractiveCurrent=(e:{sendLine:(text:string)=>void}|null)=>{interactiveEnv=e}
let pyodideLoading:Promise<any>|null=null
const loadPyodideOnce=()=>{
 if(pyodideLoading)return pyodideLoading
 pyodideLoading=new Promise((resolve,reject)=>{
  const s=document.createElement('script')
  s.src='https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js'
  s.onload=async()=>{
   try{resolve(await (window as any).loadPyodide({indexURL:'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/'}))}
   catch(e){reject(e);pyodideLoading=null}}
  s.onerror=()=>{reject(new Error('Could not download the in-browser Python runtime'));pyodideLoading=null}
  document.head.appendChild(s)})
 return pyodideLoading}

// Preloaded-lines pyodide run (no real-time input). Used when SharedArrayBuffer
// is unavailable on the page.
const baseRunWasmPython=async(code:string,stdin:string):Promise<ExecResult>=>{
 const py=await loadPyodideOnce()
 const out:string[]=[],errs:string[]=[]
 py.setStdout({batched:(s:any)=>{if(out.length&&!out[out.length-1].endsWith('\n'))out.push('\n');out.push(String(s)+'\n')}})
 py.setStderr({batched:(s:any)=>{const l=String(s).trim();if(l)errs.push(l)}})
 const lines=stdin.split(/\r?\n/).filter(l=>l.length>0)
 py.globals.set('__cfx_code',code)
 py.globals.set('__cfx_lines',JSON.stringify(lines))
 try{
  try{await py.loadPackagesFromImports(code)}catch{}
  py.runPython(`import json, sys, builtins
_l=json.loads(__cfx_lines)
_i=[0]
def _cfx_input(prompt=''):
    sys.stdout.write(prompt)
    if _i[0] >= len(_l):
        raise EOFError("input(): no more lines - put one input value per line in the Input box")
    v=_l[_i[0]]; _i[0]+=1
    sys.stdout.write(v); sys.stdout.write("\\n")
    return v
builtins.input=_cfx_input
exec(compile(__cfx_code, "main.py", "exec"), {"__name__": "__main__"})
`)
  return {status:'Success',stdout:out.join(''),stderr:errs.join('\n'),time:'—',memory:'—'}
 }catch(e:any){
  let err=e?.message?e.message:String(e)
  err=err.replace(/^PythonError: /,'')
  if(/EOFError/i.test(err))err+='\n\nTip: put one input value per line in the Input box, then Run again.'
  return {status:'Failed',stdout:out.join(''),stderr:err,time:'—',memory:'—'}
 }
}

// Interactive Python in a Worker: input() blocks the worker thread via
// SharedArrayBuffer while the page keeps collecting what the user types.
const runWasmPython=(code:string,stdin:string,onInteractive:(active:boolean)=>void,onChunk?:(chunk:string)=>void):Promise<ExecResult>=>{
 if(!(window as any).crossOriginIsolated||typeof SharedArrayBuffer==='undefined')
  return baseRunWasmPython(code,stdin)
 return new Promise(resolve=>{
  const sab=new SharedArrayBuffer(16384)
  const out:string[]=[],errs:string[]=[]
  const pending:string[]=[]
  for(const l of stdin.split(/\r?\n/))if(l.length>0)pending.push(l)
  let waitingForInput=false,done=false
  const ctl=new Int32Array(sab,0,4),data=new Uint8Array(sab,32)
  const writeTo=(text:string)=>{
   const bytes=new TextEncoder().encode(text)
   if(bytes.length>16000)return
   data.set(bytes);Atomics.store(ctl,1,bytes.length)
   Atomics.store(ctl,0,1);Atomics.notify(ctl,0)
  }
  const pump=()=>{
   if(done||!waitingForInput)return
   if(!pending.length)return
   waitingForInput=false;writeTo(pending.shift()!)
  }
  const sendLine=(text:string)=>{
   if(done)return
   if(waitingForInput){waitingForInput=false;writeTo(text)}
   else pending.push(text)
  }
  setInteractiveCurrent({sendLine})
  const finish=(r:ExecResult)=>{
   if(done)return;done=true
   setInteractiveCurrent(null);onInteractive(false)
   try{Atomics.store(ctl,2,1);Atomics.notify(ctl,0)}catch{}
   try{w.terminate()}catch{}
   resolve(r)
  }
  const wsrc=`let SAB=null,pyr=null,ctl=null,data=null
self.onmessage=async e=>{const d=e.data||{}
 if(d.type==='init'){SAB=d.sab;ctl=new Int32Array(SAB,0,4);data=new Uint8Array(SAB,32)}
 else if(d.type==='run'){
  try{
   // Load the Emscripten module explicitly so Pyodide does not have to
   // resolve its asm.js dependency from the blob worker URL.
   let indexURL=d.pyIdx
   try{importScripts(d.pyAsmUrl,d.pyUrl)}
   catch{
    // A deployment may serve worker scripts with headers that reject nested
    // same-origin imports; the official CDN provides the same version with CORS.
    indexURL=d.fallbackIdx
    importScripts(d.fallbackAsmUrl,d.fallbackUrl)
   }
   pyr=await loadPyodide({indexURL})
   pyr.setStdout({batched:s=>postMessage({chunk:String(s)+'\\n'})})
   pyr.setStderr({batched:s=>{const l=String(s);if(l.trim())postMessage({errchunk:l})}})
   const blockingLine=()=>{
    postMessage({need:true})
    for(;;){
     Atomics.wait(ctl,0,0,1500)
     if(Atomics.load(ctl,2))throw new Error('__cfx_abort__')
     if(Atomics.load(ctl,0)===1){
      const n=Atomics.load(ctl,1)
      const s=new TextDecoder().decode(data.slice(0,n))
      Atomics.store(ctl,0,0)
      return s
     }
    }
   }
   pyr.globals.set('__cfx_line',blockingLine)
   pyr.globals.set('__cfx_code',d.code)
   try{await pyr.loadPackagesFromImports(d.code)}catch{}
   pyr.runPython("import builtins, sys\\ndef _in(p=''):\\n    sys.stdout.write(p); sys.stdout.flush()\\n    return __cfx_line()\\nbuiltins.input=_in\\nexec(compile(__cfx_code, 'main.py', 'exec'), {'__name__': '__main__'})")
   postMessage({done:true,traceback:null})
  }catch(e){
   postMessage({done:true,traceback:String(e?.message||e).replace('PythonError: ','')||String(e?.message||e)})
  }
 }
}`
  const w=new Worker(URL.createObjectURL(new Blob([wsrc],{type:'text/javascript'})))
  w.onmessage=(m:any)=>{
   const d=m.data as {chunk?:string;errchunk?:string;need?:boolean;done?:boolean;traceback?:string|null}
    if(d.chunk){out.push(d.chunk);onChunk?.(d.chunk)}
   if(d.errchunk){errs.push(d.errchunk)}
   if(d.need){waitingForInput=true;onInteractive(true);pump()}
   if(d.done){
    if(d.traceback&&d.traceback!=='__cfx_abort__'){
     let err=d.traceback
     if(/__cfx_abort__/i.test(err))err=''
     finish({status:'Failed',stdout:out.join(''),stderr:(errs.join('')+'\n'+err).trim(),time:'—',memory:'—'})
    }else finish({status:'Success',stdout:out.join(''),stderr:errs.join('').trim(),time:'—',memory:'—'})
   }
  }
  w.onerror=(e:any)=>finish({status:'Failed',stdout:out.join(''),stderr:e.message||'Worker error',time:'—',memory:'—'})
  w.postMessage({type:'init',sab})
  const origin=location.origin
  const pyodideCdn='https://cdn.jsdelivr.net/pyodide/v0.26.2/full/'
  w.postMessage({type:'run',code,pyUrl:`${origin}/pyodide/pyodide.js`,pyAsmUrl:`${origin}/pyodide/pyodide.asm.js`,pyIdx:`${origin}/pyodide/`,fallbackUrl:`${pyodideCdn}pyodide.js`,fallbackAsmUrl:`${pyodideCdn}pyodide.asm.js`,fallbackIdx:pyodideCdn})
 })
}
const runWasmJs=(code:string,stdin:string):Promise<ExecResult>=>{
 return new Promise(resolve=>{
  const out:string[]=[]
  const lines=stdin.split(/\r?\n/).filter(l=>l.length>0)
  const src=`const out=[];const flush=()=>{if(out.length)postMessage({cfx:out.splice(0)})};
const show=(...a)=>{out.push(a.map(v=>{try{return typeof v==='object'?JSON.stringify(v,null,2):String(v)}catch{return String(v)}}).join(' '));flush()};
console.log=show;console.info=show;console.warn=show;console.error=show;
const stdinLines=${JSON.stringify(lines)};let _i=0;
const input=()=>{const v=stdinLines[_i++];if(v===undefined)throw new Error("input: no more lines - one value per line in the Input box");return v};
try{(0,eval)(CODE_PLACEHOLDER);flush();postMessage({err:null})}
catch(e){flush();postMessage({err:e.stack||String(e)})}
`.replace('CODE_PLACEHOLDER',JSON.stringify(code))
  const w=new Worker(URL.createObjectURL(new Blob([src],{type:'text/javascript'})))
  const finish=(r:ExecResult)=>{clearTimeout(kill);w.terminate();resolve(r)}
  const kill=setTimeout(()=>finish({status:'Failed',stdout:out.join('\n'),stderr:'Timed out after 10 s — or an infinite loop.'}),10000)
  w.onmessage=(m:any)=>{
   const d=m.data as {cfx?:string[];err?:string|null}
   if(d.cfx)out.push(...d.cfx)
   if(d.err)finish({status:'Failed',stdout:out.join('\n'),stderr:String(d.err).replace(/^Uncaught /,'')})
   else if(d.err!==undefined)finish({status:'Success',stdout:out.join('\n'),stderr:'',time:'—',memory:'—'})
  }
  w.onerror=(e:any)=>finish({status:'Failed',stdout:out.join('\n'),stderr:e.message||'Worker error'})
 })
}
function App(){
 const [room,setRoom]=useState(linkedRoom||''),[created,setCreated]=useState(false)
  const [route,setRoute]=useState<'landing'|'guest'>(linkedRoom?'guest':'landing'),[joinCode,setJoinCode]=useState('')
 const [name,setName]=useState('You'),[role,setRole]=useState<Role>('guest'),[joined,setJoined]=useState(false)
 const [theme,setTheme]=useState<'light'|'dark'>(savedTheme)
 useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem('cfx_theme',theme)},[theme])
 const [createLanguage,setCreateLanguage]=useState('python'),[sessionLanguage,setSessionLanguage]=useState('python')
 useEffect(()=>{if(!joined||!room)return;api(`/rooms/${room}`).then((r:any)=>setSessionLanguage(r.language||'python')).catch(()=>{})},[joined,room])
 useEffect(()=>{if(!joined||role!=='host'||!room)return;api(`/workspace/${room}/language/requests?host_id=${meId}`).then((rs:any)=>setLangPending(Array.isArray(rs)?rs:[])).catch(()=>{})},[joined,role,room])
 const [guestStep,setGuestStep]=useState<'form'|'waiting'|'rejected'>('form'),[guestMsg,setGuestMsg]=useState(''),[createError,setCreateError]=useState('')
 const [share,setShare]=useState(false),[shareHost,setShareHost]=useState(location.hostname==='localhost'?'':location.host)
 const [tabs,setTabs]=useState<FileTab[]>([]),[active,setActive]=useState(0)
 const [nodes,setNodes]=useState<TreeNode[]>([]),[presence,setPresence]=useState<Presence[]>([])
 const [expanded,setExpanded]=useState<Set<string>>(new Set())
 const [users,setUsers]=useState<User[]>([]),[pending,setPending]=useState<Member[]>([]),[langPending,setLangPending]=useState<{id:string;name:string;from:string;to:string;language:string}[]>([])
 const [output,setOutput]=useState('Run code to see compiler output.'),[running,setRunning]=useState(false),[panel,setPanel]=useState<PanelName>('Output'),[stdin,setStdin]=useState(''),[canDownload,setCanDownload]=useState(false)
 const [chat,setChat]=useState<{id?:string;who:string;text:string}[]>([]),[message,setMessage]=useState(''),[ai,setAi]=useState(false),[fix,setFix]=useState(false),[fixData,setFixData]=useState<any>(null),[aiError,setAiError]=useState(''),[errors,setErrors]=useState('')
 const [aiProviderStatus,setAiProviderStatus]=useState<{provider:string;model:string;configured:boolean}|null>(null)
 const [askChat,setAskChat]=useState<{role:'user'|'assistant';text:string}[]>([]),[askMsg,setAskMsg]=useState(''),[asking,setAsking]=useState(false),[askIntent,setAskIntent]=useState<'ask'|'generate'>('ask')
 const [aiTool,setAiTool]=useState<'home'|'test'|'translate'|'fix'|'ask'>('home'),[translateLanguage,setTranslateLanguage]=useState('javascript')
 const [version,setVersion]=useState(1),[activity,setActivity]=useState<string[]>(['Workspace created'])
 const [entry,setEntry]=useState('')
 const [importOpen,setImportOpen]=useState(false),[importTab,setImportTab]=useState<'upload'|'path'|'github'>('upload'),[importPath,setImportPath]=useState(''),[importUrl,setImportUrl]=useState(''),[importBranch,setImportBranch]=useState(''),[importing,setImporting]=useState(false),[importMsg,setImportMsg]=useState('')
 const [newNode,setNewNode]=useState<null|{parent:string;isDir:boolean}>(null),[newNodeName,setNewNodeName]=useState(''),[renaming,setRenaming]=useState<string|null>(null),[renameValue,setRenameValue]=useState(''),[fsError,setFsError]=useState(''),[treeReady,setTreeReady]=useState(false)
 const [interactive,setInteractive]=useState(false),[consoleIn,setConsoleIn]=useState(''),[needsInput,setNeedsInput]=useState(false)
 const [aiPanelOpen,setAiPanelOpen]=useState(false),[sidebarOpen,setSidebarOpen]=useState(false)
 const maxTerminalHeight=Math.max(120,window.innerHeight-(window.innerWidth<=860?321:294))
 const terminalResize=usePanelResize(Math.min(230,maxTerminalHeight),{min:120,max:maxTerminalHeight},'vertical')
 const aiResize=usePanelResize(330,{min:270,max:520},'horizontal')
 const editorRef=useRef<any>();const monacoRef=useRef<any>();const wsRef=useRef<WebSocket>();const creatorRef=useRef(false)
 const saveTimerRef=useRef<number>()
 const treeDoc=useMemo(()=>new Y.Doc(),[room]);const ytree=useMemo(()=>treeDoc.getMap('nodes'),[treeDoc])
 useEffect(()=>{let active=true;api('/ai-status').then(status=>{if(active)setAiProviderStatus(status)}).catch(()=>{if(active)setAiProviderStatus(null)});return()=>{active=false}},[])
 const openDocsRef=useRef<Map<string,ProviderGroup>>(new Map());const bindRef=useRef<{path:string;binding:MonacoBinding}|null>(null)
 const cursorStyleRef=useRef<HTMLStyleElement>()
 const tabsRef=useRef(tabs);tabsRef.current=tabs;const activeRef=useRef(active);activeRef.current=active;const roleRef=useRef(role);roleRef.current=role
 const roomRef=useRef(room);roomRef.current=room;const usersRef=useRef(users);usersRef.current=users
 const typingOffRef=useRef<any>();const typingSentRef=useRef(0)
 const [typing,setTyping]=useState<{id:string;name:string;path?:string;until:number}[]>([])
 const [rcursors,setRcursors]=useState<{cid:number;name:string;color:string;left:number;top:number;height:number;below:boolean;typing:boolean}[]>([])
 const typingRef=useRef(typing);typingRef.current=typing
 const colorOf=(id?:string)=>id?(usersRef.current.find(u=>u.id===id)?.color||colorFor(id)):'#7c5cff'
 const markTyping=(id:string,who:string,on:boolean,path?:string)=>{
  if(!id)return
  if(on)setTyping(ts=>[...ts.filter(t=>t.id!==id),{id,name:who||'Teammate',path,until:Date.now()+3500}])
  else setTyping(ts=>ts.filter(t=>t.id!==id))
 }
const notifyTyping=()=>{
   if(!joined)return;const now=Date.now()
   if(now-typingSentRef.current>400){typingSentRef.current=now;sendRoom('typing',{id:meId,name:name||'You',on:true,path:activePath()})}
   markTyping(meId,name||'You',true,activePath())
   clearTimeout(typingOffRef.current)
   typingOffRef.current=setTimeout(()=>{sendRoom('typing',{id:meId,name:name||'You',on:false});markTyping(meId,name||'You',false)},2200)
  }
  const typingNames=(list:{id:string;name:string}[])=>{
   if(!list.length)return''
   const names=list.map(t=>t.id===meId?'You':t.name)
   if(names.length===1)return`${names[0]} ${names[0]==='You'?'are':'is'} typing`
   if(names.length===2)return`${names[0]} and ${names[1]} are typing`
   return`${names.slice(0,-1).join(', ')} and ${names[names.length-1]} are typing`
  }
  const othersTyping=()=>typing.filter(t=>t.id!==meId)
  const typingIn=(list:{path?:string}[])=>{const cur=activePath();const f=[...new Set(list.filter(t=>t.path&&t.path!==cur).map(t=>baseName(t.path as string)))];return f.length?` in ${f.join(', ')}`:''}
 const addActivity=(text:string)=>setActivity(a=>[`${new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} — ${text}`,...a].slice(0,30))
 const sendRoom=(event:string,data:any)=>{if(wsRef.current?.readyState===WebSocket.OPEN)wsRef.current.send(JSON.stringify({event,data}))}
 const upsertUser=(m:Member)=>{setUsers(us=>{const i=us.findIndex(x=>x.id===m.id);if(i>=0){const next=[...us];next[i]={...next[i],name:m.name,device:m.device,role:m.role};return next}const color=colors[(us.length-1)%colors.length];return [...us,{id:m.id,name:m.name,device:m.device,role:m.role,color}]})}
 const showResult=(r:any,opts:{project?:boolean}={})=>{setCanDownload(r?.status==='Success');if(r?.stderr){setCompilerMarkers(r.stderr);setErrors(r.stderr)};const stderr=String(r?.stderr||'');const missingInput=/(?:EOFError|no more (?:lines|input)|NoSuchElementException|No line found|unexpected end of input|EOF when reading|end of file|EOF on stdin)/i.test(stderr);if(missingInput&&!opts.project){setNeedsInput(true);setPanel('Input');setTimeout(()=>document.querySelector<HTMLTextAreaElement>('textarea.stdin')?.focus(),60)}else if(r?.status==='Success')setNeedsInput(false);const tip=missingInput?'\n\nThis program asked for input. Add one value per line in the Input box, then press ▶ Run with this input — or type a value below and press Enter.':'';setOutput(`Status: ${r?.status||'—'}\n\n${r?.stdout||''}${r?.stderr?`\nErrors:\n${r.stderr}`:''}\nTime: ${r?.time||'—'} sec  •  Memory: ${r?.memory||'—'}${r?.note==='local'?'  •  Local fallback (online compilers unavailable)':''}${r?.note==='onlinecompiler'?'  •  OnlineCompiler.io':''}${tip}`)}
 const activePath=()=>tabsRef.current[activeRef.current]?.path||''
const tabsOn=(path:string)=>presence.filter(p=>p.activeFile===path)
useEffect(()=>{if(location.hostname!=='localhost'&&location.hostname!=='127.0.0.1')return;fetch(`${apiBase}/api/network`).then(r=>r.json()).then((d:any)=>{if(d?.ip&&d.ip!=='0.0.0.0')setShareHost(`${d.ip}:5173`)}).catch(()=>{})},[])
 useEffect(()=>{const connected=Boolean(room)&&(joined||guestStep==='waiting');if(!connected)return
   const ws=new WebSocket(`${apiWsBase}/ws/rooms/${room}/${meId}`);wsRef.current=ws
  ws.onmessage=(e)=>{const msg=JSON.parse(e.data)
   switch(msg.event){
    case 'room:join_request':if(role==='host')setPending(p=>p.some(x=>x.id===msg.data.id)?p:[...p,msg.data]);break
    case 'room:join_accepted':
     if(msg.data.id===meId){setRole(msg.data.role==='host'?'host':msg.data.role as Role);setJoined(true);setGuestStep('form');addActivity(`Approved — you can now edit`)}break
    case 'room:members':setUsers(msg.data.map((m:any,i:number)=>({id:m.id,name:m.name,device:m.device,role:m.role,color:colors[i%colors.length]})));break
    case 'room:join_rejected':
     if(msg.data.id===meId)setGuestStep('rejected');break
    case 'room:user_joined':upsertUser(msg.data);if(msg.data.id!==meId){setChat(c=>[...c,{who:'CodeFix AI',text:`${msg.data.name} joined the room.`}])}addActivity(`${msg.data.name} joined`);break
    case 'room:user_left':markTyping(msg.data.id,'',false);setUsers(us=>{const u=us.find(x=>x.id===msg.data.id);if(u){setChat(c=>[...c,{who:'CodeFix AI',text:`${u.name} left the room.`}]);addActivity(`${u.name} left`)}return us.filter(x=>x.id!==msg.data.id)});break
    case 'room:removed':
     if(msg.data.id===meId){setActivity(a=>[`You were removed by the host`, ...a]);resetToLanding()}
     else{setUsers(us=>us.filter(x=>x.id!==msg.data.id));setChat(c=>[...c,{who:'CodeFix AI',text:`${msg.data.name} was removed by the host.`}]);addActivity(`${msg.data.name} removed`)}
     break
    case 'room:closed':resetToLanding();break
    case 'chat:message':setChat(c=>[...c,{...msg.data,who:msg.data?.who||'Teammate',id:msg.data?.id||usersRef.current.find(u=>u.name===msg.data?.who)?.id}]);break
    case 'execution:start':setRunning(true);setOutput(`${msg.data?.user||'Someone'} is running the code…`);setPanel('Output');break
    case 'execution:result':setRunning(false);showResult(msg.data);addActivity(`Code executed`);break
    case 'ai:fix_ready':setFixData(msg.data);setFix(true);setPanel('AI Debugger');break
    case 'workspace:imported':resyncTree();addActivity(`Project imported — ${msg.data?.count||0} files`);break
    case 'file:renamed':
     if(msg.data?.from&&msg.data?.to){
      applyRenameLocal(msg.data.from,msg.data.to,msg.data.language)
      const mine=msg.data.id===meId||msg.data.by===meId
      addActivity(msg.data.approved&&mine?`Host approved your change: ${baseName(msg.data.from)} → ${baseName(msg.data.to)} (${msg.data.language})`:`${msg.data.name||'A teammate'} renamed ${baseName(msg.data.from)} → ${baseName(msg.data.to)}${msg.data.language?` (${msg.data.language})`:''}`)
     }
     break
    case 'language:request':
     if(role==='host'&&msg.data?.id)setLangPending(p=>[...p.filter(x=>x.id!==msg.data.id),msg.data])
     addActivity(`${msg.data?.name||'A teammate'} requested ${baseName(msg.data?.from||'')} → ${baseName(msg.data?.to||'')} (${msg.data?.language||'?'})`)
     break
    case 'language:rejected':
     if(msg.data?.id===meId){setFsError(`The host rejected the language change to ${msg.data?.language||'your request'}`);addActivity(`Host rejected ${baseName(msg.data?.to||'')} — file kept as is`)}
     break
    case 'file:deleted':
     if(msg.data?.path&&msg.data.by!==meId){closePathsLocal(msg.data.path);addActivity(`${msg.data.name||'A teammate'} deleted ${msg.data.path}`)}
     break
case 'presence:states':
     case 'presence:update':setPresence((msg.data||[]).filter((p:any)=>p.activeFile));break
     case 'typing':
      if(msg.data?.id!==meId)markTyping(msg.data?.id,msg.data?.name,msg.data?.on!==false,msg.data?.path)
      break
   }}
  return()=>{ws.close();if(wsRef.current===ws)wsRef.current=undefined}
 },[room,joined,guestStep,role])
const remoteStates=(awareness:any,doc?:Y.Doc)=>{
   const out:{cid:number;id?:string;name:string;color:string;head?:number;anchor?:number}[]=[]
   awareness.getStates().forEach((state:any,cid:number)=>{
    if(cid===awareness.doc.clientID||!state||!state.user)return
    const uid=state.user.id as string|undefined
    const sel=state.selection
    let head:number|undefined,anchor:number|undefined
    if(sel&&doc){const h=Y.createAbsolutePositionFromRelativePosition(sel.head,doc);const a=Y.createAbsolutePositionFromRelativePosition(sel.anchor,doc);if(h&&typeof h.index==='number')head=h.index;if(a&&typeof a.index==='number')anchor=a.index}
    out.push({cid,id:uid,name:state.user.name||'Teammate',color:(uid?colorOf(uid):state.user.color)||colors[0],head,anchor})
   })
   return out
  }
  const paintCursors=(awareness:any)=>{
   const el=cursorStyleRef.current;if(!el)return;el.textContent=''
   remoteStates(awareness).forEach(u=>{el.textContent+=`.yRemoteSelection-${u.cid}{background-color:${u.color}33;border-radius:2px}`})}
  const paintPresence=()=>{
   const editor=editorRef.current,path=tabsRef.current[activeRef.current]?.path
   const entry=path?openDocsRef.current.get(path):undefined
   const model=editor?.getModel()
   if(!editor||!model||!entry){setRcursors([]);return}
   const txt=entry.yt
   const next:any[]=[]
   remoteStates(entry.provider.awareness,entry.doc).forEach(u=>{
    if(u.head===undefined)return
    const head=Math.max(0,Math.min(u.head,txt.length))
    const scr=editor.getScrolledVisiblePosition(model.getPositionAt(head))
    if(!scr)return
    next.push({cid:u.cid,name:u.name,color:u.color,left:scr.left,top:scr.top,height:scr.height||19,below:scr.top<(scr.height||19)+4,typing:typingRef.current.some(t=>t.id===u.id)})
   })
   setRcursors(next)
  }
  useEffect(()=>{
   const el=document.createElement('style');el.setAttribute('data-cfx','cursors');document.head.appendChild(el);cursorStyleRef.current=el
   openDocsRef.current.forEach(e=>paintCursors(e.provider.awareness))
   return()=>{el.remove();if(cursorStyleRef.current===el)cursorStyleRef.current=undefined}
  },[])
  useEffect(()=>{const iv=setInterval(()=>setTyping(ts=>{const now=Date.now();const next=ts.filter(t=>t.until>now);paintPresence();return next}),700);return()=>clearInterval(iv)},[])
 const setTreeNodes=()=>setNodes(Array.from(ytree.entries()).map(([path,m]:any)=>{const mm=m as Y.Map<unknown>;return {path,name:(mm.get('name') as string)||baseName(path),parent:(mm.get('parent') as string)||'',isDir:!!mm.get('isDir'),language:(mm.get('language') as string)||langOf(path)}}))
 const seedNode=(n:any)=>{const path=n.path as string;if(ytree.has(path))return;const m=new Y.Map();m.set('name',n.name||baseName(path));m.set('parent',n.parent||'');m.set('isDir',!!n.is_directory);m.set('language',n.language||langOf(path));ytree.set(path,m)}
  const resyncTree=async()=>{try{const w=await api(`/workspace/${roomRef.current}?actor_id=${meId}`);const fsNodes:any[]=w.filesystem||[];if(fsNodes.length>0)fsNodes.forEach(seedNode);setTreeNodes()}catch{}}
 useEffect(()=>{if(!room||!joined)return
  const loadFromServer=async()=>{
   try{
    const w=await api(`/workspace/${roomRef.current}?actor_id=${meId}`)
    const fsNodes:any[]=w.filesystem||[]
    if(fsNodes.length>0&&ytree.size===0)fsNodes.forEach(seedNode)
   }catch{}
  }
  loadFromServer()
  const p=new WebsocketProvider(collabUrl,treeDocName(room),treeDoc)
  p.on('sync',(synced:boolean)=>{if(synced){loadFromServer();setTreeReady(true)}})
  ytree.observe(()=>setTreeNodes())
  return()=>{ytree.unobserve(()=>setTreeNodes());p.destroy()}
 },[room,joined,treeDoc,ytree])
 const openPath=(path:string,languageOverride?:string)=>{
  const existing=tabsRef.current.findIndex(t=>t.path===path)
  if(existing>=0){setActive(existing);sendRoom('editor:activefile',{path});return}
  const nm=ytree.get(path) as Y.Map<unknown>|undefined
  const language=languageOverride||(nm?((nm.get('language') as string)||langOf(path)):langOf(path))
  const doc=new Y.Doc();const provider=new WebsocketProvider(collabUrl,fileDocName(room,path),doc)
  provider.awareness.setLocalStateField('user',{id:meId,name:name||'You',color:colorFor(meId)})
  const yt=doc.getText('content')
  provider.on('sync',(synced:boolean)=>{if(!synced)return;setTabs(ts=>ts.map(t=>t.path===path?{...t,code:yt.toString()}:t))})
  provider.awareness.on('change',()=>{paintCursors(provider.awareness);paintPresence()})
  openDocsRef.current.set(path,{doc,provider,yt})
  setTabs(ts=>[...ts,{path,name:baseName(path),language,code:''}])
  setActive(tabsRef.current.length);setTimeout(()=>sendRoom('editor:activefile',{path}),200)
 }
 const removeTab=(path:string)=>{
  const current=tabsRef.current
  const idx=current.findIndex(t=>t.path===path)
  if(idx<0)return
  if(bindRef.current?.path===path){bindRef.current.binding.destroy();bindRef.current=null}
  const entry=openDocsRef.current.get(path)
  if(entry){entry.provider.destroy();entry.doc.destroy();openDocsRef.current.delete(path)}
  const next=current.filter((_,i)=>i!==idx)
  setTabs(next)
  const act=activeRef.current
  if(idx===act){const ni=Math.min(idx,next.length-1);setActive(ni);setTimeout(()=>sendRoom('editor:activefile',{path:next[ni]?.path||''}),100)}
  else if(idx<act)setActive(act-1)
 }
 const syncBinding=()=>{
  const editor=editorRef.current,path=tabsRef.current[activeRef.current]?.path
  if(!editor||!path){if(bindRef.current){bindRef.current.binding.destroy();bindRef.current=null}return}
  const entry=openDocsRef.current.get(path)
  const model=editor.getModel()
  if(!model||!entry){if(bindRef.current){bindRef.current.binding.destroy();bindRef.current=null}return}
  if(bindRef.current?.path===path)return
  if(bindRef.current){bindRef.current.binding.destroy();bindRef.current=null}
  bindRef.current={path,binding:new MonacoBinding(entry.yt,model,new Set([editor]),entry.provider.awareness)}
  const sel=editor.getSelection()
  if(sel)entry.provider.awareness.setLocalStateField('selection',{anchor:Y.createRelativePositionFromTypeIndex(entry.yt,model.getOffsetAt(sel.getStartPosition())),head:Y.createRelativePositionFromTypeIndex(entry.yt,model.getOffsetAt(sel.getEndPosition()))})
  paintCursors(entry.provider.awareness);paintPresence()
 }
 const setCompilerMarkers=(error:string)=>{const model=editorRef.current?.getModel();const monaco=monacoRef.current;if(!model||!monaco)return;const requestedLine=Number(error.match(/(?:line\s+|:)(\d+)/i)?.[1]||1);const line=Math.max(1,Math.min(requestedLine,model.getLineCount()));monaco.editor.setModelMarkers(model,'jdoodle',error?[{severity:monaco.MarkerSeverity.Error,message:error,startLineNumber:line,startColumn:1,endLineNumber:line,endColumn:model.getLineMaxColumn(line)}]:[])}
 const persistFile=async(path:string,content:string,language:string)=>{if(!room||!path)return;try{await api(`/workspace/${room}/file?actor_id=${meId}`,{method:'PUT',body:JSON.stringify({path,content,language})})}catch{}}
 // Run Project reads the files on the backend disk, so everything open in the
 // editor must be written out first — otherwise the run uses the old version
 // and reports the error the user just fixed.
 const flushOpenDocs=async()=>{
  if(!room)return
  await Promise.all(tabsRef.current.map(t=>{const e=openDocsRef.current.get(t.path);return persistFile(t.path,e?e.yt.toString():t.code,t.language)}))
 }
 const updateCode=(value?:string)=>{if(role==='viewer')return;notifyTyping();setCompilerMarkers('');setCanDownload(false);const code=value??'';const idx=activeRef.current;setTabs(ts=>ts.map((t,i)=>i===idx?{...t,code}:t));setVersion(v=>v+1)
  const tab=tabsRef.current[idx]
  if(tab){clearTimeout(saveTimerRef.current);saveTimerRef.current=window.setTimeout(()=>{void persistFile(tab.path,code,tab.language)},900)}}
 const addNodeInTree=(parent:string,name:string,isDir:boolean,language?:string)=>{const path=parent?`${parent}/${name}`:name;if(ytree.has(path))return path;const m=new Y.Map();m.set('name',name);m.set('parent',parent);m.set('isDir',isDir);m.set('language',language||(isDir?'folder':langOf(path)));ytree.set(path,m);return path}
 const createNode=async(parent:string,name:string,isDir:boolean,language?:string)=>{const path=addNodeInTree(parent,name,isDir,language);try{await api(`/workspace/${room}/nodes`,{method:'POST',body:JSON.stringify({parent,name,is_directory:isDir,language:language||undefined})});addActivity(`Created ${path}`)}catch(e){setFsError(e instanceof Error?e.message:String(e))}return path}
 const commitNewNode=async()=>{
  if(!newNode||!newNodeName.trim())return
  let name=newNodeName.trim()
  if(!newNode.isDir&&!name.includes('.')&&extensions[sessionLanguage])name+='.'+extensions[sessionLanguage]
  const lang=newNode.isDir?undefined:langOf(name)
  setNewNodeName('');setNewNode(null)
  const path=await createNode(newNode.parent,name,newNode.isDir,lang)
  if(!newNode.isDir)openPath(path);else setExpanded(s=>{const x=new Set(s);if(newNode.parent)x.add(newNode.parent);x.add(path);return x})
 }
 const renamePathInTree=(from:string,to:string)=>{
   const affected=Array.from(ytree.entries()).filter(([p])=>(p as string)===from||(p as string).startsWith(from+'/'))
   affected.forEach(([p,m])=>{const mm=m as Y.Map<unknown>;const np=to+(p as string).slice(from.length);const copy=new Y.Map();copy.set('name',mm.get('name'));copy.set('parent',parentOf(np));copy.set('isDir',mm.get('isDir'));copy.set('language',mm.get('language')||langOf(np));ytree.set(np,copy);ytree.delete(p as string)})
  }
  const flushPaths=async(prefix:string)=>{
   const affected=tabsRef.current.filter(t=>t.path===prefix||t.path.startsWith(prefix+'/'))
   await Promise.all(affected.map(async t=>{const e=openDocsRef.current.get(t.path);const content=e?e.yt.toString():t.code;try{await api(`/workspace/${room}/file?actor_id=${meId}`,{method:'PUT',body:JSON.stringify({path:t.path,content,language:t.language})})}catch{}}))
  }
  const closePathsLocal=(prefix:string)=>{
   const affected=tabsRef.current.filter(t=>t.path===prefix||t.path.startsWith(prefix+'/'))
   if(!affected.length)return false
   if(bindRef.current&&(bindRef.current.path===prefix||bindRef.current.path.startsWith(prefix+'/'))){bindRef.current.binding.destroy();bindRef.current=null}
   affected.forEach(t=>{const e=openDocsRef.current.get(t.path);if(e){e.provider.destroy();e.doc.destroy();openDocsRef.current.delete(t.path)}})
   const activeOld=tabsRef.current[activeRef.current]?.path
   const next=tabsRef.current.filter(t=>!(t.path===prefix||t.path.startsWith(prefix+'/')))
   setTabs(next)
   const i=activeOld?next.findIndex(t=>t.path===activeOld):-1
   if(i>=0)setActive(i);else setActive(Math.max(0,Math.min(activeRef.current,next.length-1)))
   return true
  }
  const applyRenameLocal=(from:string,to:string,language?:string)=>{
   setEntry(cur=>cur&&(cur===from||cur.startsWith(from+'/'))?to+cur.slice(from.length):cur)
   const activeOld=tabsRef.current[activeRef.current]?.path
   const affected=tabsRef.current.filter(t=>t.path===from||t.path.startsWith(from+'/'))
   if(!affected.length)return
   const wasActive=!!(activeOld&&(activeOld===from||activeOld.startsWith(from+'/')))
   closePathsLocal(from)
   affected.forEach(t=>openPath(to+t.path.slice(from.length),t.path===from?language:undefined))
   if(wasActive&&activeOld){const target=to+activeOld.slice(from.length);setTimeout(()=>{const i=tabsRef.current.findIndex(t=>t.path===target);if(i>=0)setActive(i)},80)}
  }
  const renamePath=async(from:string,to:string,language?:string)=>{
   if(from===to)return
   const src=ytree.get(from) as Y.Map<unknown>|undefined
   const nextLanguage=language||(src&&!src.get('isDir')?langOf(to):undefined)
   const srcLanguage=src&&!src.get('isDir')?String(src.get('language')||langOf(from)):undefined
   const languageChanged=Boolean(srcLanguage&&nextLanguage&&nextLanguage!==srcLanguage)
   await flushPaths(from)
   if(languageChanged&&role!=='host'){
    try{const r=await api(`/workspace/${room}/language?actor_id=${meId}`,{method:'POST',body:JSON.stringify({from_path:from,to_path:to,language:nextLanguage})});setFsError('');addActivity(r.status==='pending'?`Requested ${baseName(from)} → ${baseName(to)} (${nextLanguage}) — waiting for host approval`:`Changed ${baseName(from)} → ${baseName(to)} (${nextLanguage})`)}catch(e){setFsError(e instanceof Error?e.message:String(e))}
    return
   }
   try{await api(`/workspace/${room}/nodes`,{method:'PUT',body:JSON.stringify({from_path:from,to_path:to,language:nextLanguage})})}catch(e){setFsError(e instanceof Error?e.message:String(e));return}
   renamePathInTree(from,to)
   if(nextLanguage){const m=ytree.get(to);if(m)(m as Y.Map<unknown>).set('language',nextLanguage)}
   sendRoom('file:renamed',{from,to,language:nextLanguage,by:meId,name:name||'You'})
   applyRenameLocal(from,to,nextLanguage)
   addActivity(`Renamed ${baseName(from)} → ${baseName(to)}${nextLanguage?` (${nextLanguage})`:''}`)
  }
  const deletePath=async(path:string)=>{
   try{await api(`/workspace/${room}/nodes?path=${encodeURIComponent(path)}`,{method:'DELETE'})}catch(e){setFsError(e instanceof Error?e.message:String(e));return}
   Array.from(ytree.entries()).forEach(([p])=>{if((p as string)===path||(p as string).startsWith(path+'/'))ytree.delete(p as string)})
   closePathsLocal(path)
   sendRoom('file:deleted',{path,by:meId,name:name||'You'})
   addActivity(`Deleted ${path}`)
  }
  const changeLanguage=async(language:string)=>{
   if(role==='viewer')return
   const t=tabs[active];if(!t||language===t.language)return
   const from=t.path;const folder=from.slice(0,from.lastIndexOf('/')+1)
   const to=folder+t.name.replace(/\.[^.]+$/,'')+'.'+extensions[language]
   if(from===to){setTabs(ts=>ts.map((x,i)=>i===active?{...x,language}:x));return}
   await renamePath(from,to,language)
  }
 const create=async()=>{setCreateError('');try{
  if(room&&role==='host'){try{await api(`/rooms/${room}?host_id=${meId}`,{method:'DELETE'})}catch{}}
  setJoined(false);setChat([]);setPending([]);setLangPending([]);setActivity([]);setFix(false);setFixData(null)
  const r=await api('/rooms',{method:'POST',body:JSON.stringify({id:meId,name:name.trim()||'You',device:myDevice,language:createLanguage})});creatorRef.current=true;enterRoom(r)
 }catch(error){setCreateError(error instanceof Error?error.message:String(error))}}
 const enterRoom=(r:any)=>{
  const self=r.members?.[meId];const nextRole:Role=r.host_id===meId?'host':((self?.role as Role)||'editor')
  openDocsRef.current.forEach(e=>{e.provider.destroy();e.doc.destroy()});openDocsRef.current.clear()
  if(bindRef.current){bindRef.current.binding.destroy();bindRef.current=null}
  setTabs([]);setActive(0);setNodes([]);setPresence([]);setExpanded(new Set());setEntry('');setTreeReady(false)
  history.pushState({},'',`/room/${r.id}`);setRoom(r.id);setCreated(true);setJoined(true);setRole(nextRole);setSessionLanguage(r.language||'python')
  setUsers([{id:meId,name:self?.name||name.trim()||'You',device:myDevice,role:nextRole,color:colors[0]}])}
 const joinByCode=()=>{const code=(joinCode||'').trim().toUpperCase();if(!code)return;setRoute('guest');setRoom(code);setCreated(false);history.pushState({},'',`/room/${code}`)}
 const resetToLanding=()=>{setJoined(false);setRole('guest');setUsers([]);setPending([]);setLangPending([]);setRoom('');setRoute('landing');setGuestStep('form');setGuestMsg('');setCreateError('');setCreated(false);setChat([]);setTyping([]);setFix(false);setFixData(null);setActivity(['Left the room']);history.pushState({},'', '/')}
 const leave=async()=>{if(!room)return;if(role==='host'){try{await api(`/rooms/${room}?host_id=${meId}`,{method:'DELETE'})}catch{}}resetToLanding()}
 const kick=async(m:User)=>{if(role!=='host'||m.id===meId)return;try{await api(`/rooms/${room}/members/${m.id}?host_id=${meId}`,{method:'DELETE'})}catch{}}
  const requestJoin=async()=>{if(!name.trim()||!room)return;setGuestMsg('');try{await api(`/rooms/${room}/join`,{method:'POST',body:JSON.stringify({id:meId,name:name.trim(),device:myDevice})});setGuestStep('waiting')}catch(error){setGuestMsg(error instanceof Error?error.message:String(error))}}
  useEffect(()=>{
    if(linkedRoom && route==='guest' && !joined && guestStep==='form' && room===linkedRoom){
      const t=setTimeout(()=>{requestJoin()},200)
      return ()=>clearTimeout(t)
    }
  },[])
 const accept=async(m:Member)=>{try{await api(`/rooms/${room}/members/${m.id}/approve?host_id=${meId}&role=editor`,{method:'POST'});setPending(p=>p.filter(x=>x.id!==m.id))}catch{setPending(p=>p.filter(x=>x.id!==m.id))}}
 const rejectJoin=async(m:Member)=>{try{await api(`/rooms/${room}/members/${m.id}/reject?host_id=${meId}`,{method:'POST'})}catch{}setPending(p=>p.filter(x=>x.id!==m.id))}
 const approveLanguage=async(req:{id:string;name:string;from:string;to:string;language:string})=>{try{await api(`/rooms/${room}/language/${req.id}/approve?host_id=${meId}`,{method:'POST'});setFsError('');renamePathInTree(req.from,req.to);const m=ytree.get(req.to) as Y.Map<unknown>|undefined;if(m)m.set('language',req.language)}catch(e){setFsError(e instanceof Error?e.message:String(e))}setLangPending(p=>p.filter(x=>x.id!==req.id))}
 const rejectLanguage=async(req:{id:string;name:string;from:string;to:string;language:string})=>{try{await api(`/rooms/${room}/language/${req.id}/reject?host_id=${meId}`,{method:'POST'})}catch{}setLangPending(p=>p.filter(x=>x.id!==req.id))}
 const saveActive=async()=>{const t=tabs[active];if(!t)return;const entry=openDocsRef.current.get(t.path);const code=entry?entry.yt.toString():t.code;addActivity(`💾 Saved ${t.path}`);try{await api(`/workspace/${room}/file?actor_id=${meId}`,{method:'PUT',body:JSON.stringify({path:t.path,content:code,language:t.language})});setFsError('')}catch(e){setFsError(e instanceof Error?e.message:String(e))}}
 useEffect(()=>{const h=(e:KeyboardEvent)=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();saveActive()}};window.addEventListener('keydown',h);return()=>window.removeEventListener('keydown',h)},[room,joined,active,tabs])
 useEffect(()=>{if(!joined)return;const iv=setInterval(()=>sendRoom('editor:activefile',{path:activePath()}),15000);return()=>clearInterval(iv)},[joined])
 useEffect(()=>{
  if(!joined||!creatorRef.current||tabs.length>0)return
  const want=sessionLanguage==='java'?'Main.java':`main.${extensions[sessionLanguage]||'py'}`
  const target=nodes.find(n=>!n.isDir&&n.path===want)||nodes.find(n=>!n.isDir&&n.language===sessionLanguage)
  if(target)openPath(target.path)
 },[nodes,joined,sessionLanguage])
 useEffect(()=>{const t=setTimeout(syncBinding,60);return()=>clearTimeout(t)},[tabs,active])
 const currentCode=()=>{const t=tabsRef.current[activeRef.current];if(!t)return'';const entry=openDocsRef.current.get(t.path);return entry?entry.yt.toString():t.code}
  const run=async(overrideStdin?:string)=>{setRunning(true);setCanDownload(false);setNeedsInput(false);const t=tabs[active];if(!t){setRunning(false);return};const code=currentCode();const input=overrideStdin??stdin;const runnable=['python','javascript','c','cpp','java'];if(!runnable.includes(t.language)){setRunning(false);setPanel('Output');setOutput(`Can't run ${t.language} files here\n\nThis editor executes Python, JavaScript, C, C++ and Java. AI Fix still works on this file, or use AI Translate to convert it to a runnable language.`);return}setOutput(`${name} is running the latest shared version…`);setPanel('Output');sendRoom('execution:start',{user:name});try{const result=await api('/execute',{method:'POST',body:JSON.stringify({code,language:t.language,stdin:input})});sendRoom('execution:result',result);showResult(result);addActivity('Code executed')}catch(error){
  const msg=error instanceof Error?error.message:String(error)
  if(t.language==='python'||t.language==='javascript'){
   setOutput(`${msg}\n\nFalling back to in-browser execution — no online compiler needed…`)
   try{
    const res=t.language==='python'?await runWasmPython(code,input,(a:boolean)=>setInteractive(a),(c:string)=>setOutput(o=>o+c)):await runWasmJs(code,input)
    if(res.status==='Success'){sendRoom('execution:result',{...res,note:'in-browser'});showResult(res);addActivity('Code executed (in-browser)');setCanDownload(true)}
    else{showResult(res);setOutput(`In-browser run failed\n\n${res.stderr}\n\n${t.language==='python'?'':res.stdout}`)}
   }catch(wasm:any){setOutput(`${msg}\n\nIn-browser fallback unavailable: ${String(wasm?.message||wasm)||'unknown error'}`)}
  }else setOutput(`Execution unavailable\n\n${msg}\n\nNo online compiler could run this file and the backend machine has no local runtime for ${t.language}. Check that ONLINECOMPILER_API_KEY / JDOODLE_CLIENT_ID / JDOODLE_CLIENT_SECRET are set, or install python3, node, cc/c++ or javac on the backend.`)
 }finally{setRunning(false)}}
  const runProject=async()=>{if(!entry)return;setRunning(true);setCanDownload(false);setOutput(`${name} is running project entry ${entry}…`);setPanel('Output');try{await flushOpenDocs();const result=await api(`/rooms/${room}/execute-project?actor_id=${meId}`,{method:'POST',body:JSON.stringify({entry,stdin})});showResult(result,{project:true});addActivity(`Ran project: ${result.entry||entry}`)}catch(error){setOutput(`Project run unavailable\n\n${error instanceof Error?error.message:'Could not start the run.'}\n\nThe whole project runs on the backend machine (like VS Code) — needs the runtime installed there.`)}finally{setRunning(false)}}
  const importFiles=async(items:{path:string;content:string}[])=>{if(!items.length)return;setImporting(true);setImportMsg('');try{const r=await api(`/workspace/${room}/import/json?actor_id=${meId}`,{method:'POST',body:JSON.stringify({files:items})});await resyncTree();setImportMsg('✓ Imported '+r.added+' files'+(r.skipped&&r.skipped.length?' ('+r.skipped.length+' skipped)':''));addActivity('Imported project — '+r.added+' files')}catch(error){setImportMsg('⚠ '+String(error instanceof Error?error.message:error))}finally{setImporting(false)}}
  const onImportPicked=(e:any)=>{const files=[...(e.target.files||[])].filter((f:any)=>f.webkitRelativePath||f.name);Promise.all(files.map(async(f:any)=>{const text=await f.text();return{path:(f.webkitRelativePath||f.name).replace(/^[\/]+/,''),content:text}})).then(items=>{e.target.value='';importFiles(items)})}
  const importFromPath=async()=>{const dir=importPath.trim();if(!dir)return;setImporting(true);setImportMsg('');try{const r=await api(`/workspace/${room}/import/path?actor_id=${meId}`,{method:'POST',body:JSON.stringify({dir})});await resyncTree();setImportMsg('✓ Imported '+r.added+' files'+(r.skipped&&r.skipped.length?' ('+r.skipped.length+' skipped)':''));addActivity('Imported from server path — '+r.added+' files')}catch(error){setImportMsg('⚠ '+String(error instanceof Error?error.message:error))}finally{setImporting(false)}}
  const importFromGithub=async()=>{const url=importUrl.trim();if(!url)return;setImporting(true);setImportMsg('');try{const r=await api(`/workspace/${room}/import/github?actor_id=${meId}`,{method:'POST',body:JSON.stringify({url,branch:importBranch.trim()||undefined})});await resyncTree();setImportMsg('✓ Imported '+r.added+' files'+(r.skipped&&r.skipped.length?' ('+r.skipped.length+' skipped)':''));addActivity('Imported from GitHub — '+r.added+' files')}catch(error){setImportMsg('⚠ '+String(error instanceof Error?error.message:error))}finally{setImporting(false)}}
  const runnableFiles=useMemo(()=>nodes.filter(n=>!n.isDir&&['python','javascript','c','cpp','java'].includes(n.language)).map(n=>n.path).sort(),[nodes])
  useEffect(()=>{if(entry||!nodes.length)return;const prefs=['main.py','main.js','index.js','app.js','Main.java','main.c','main.cpp'];const p=prefs.find(x=>nodes.some(n=>n.path===x&&!n.isDir))||nodes.find(n=>!n.isDir&&['python','javascript','c','cpp','java'].includes(n.language))?.path||'';if(p)setEntry(p)},[nodes,entry])
 const downloadFile=()=>{const t=tabs[active];if(!t)return;const blob=new Blob([currentCode()],{type:'text/plain;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=t.name;document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);addActivity(`Downloaded ${t.name}`)}
 const analyze=async()=>{const t=tabs[active];if(!t)return;openAiTool('fix');setAi(true);setAiError('');setFix(false);setFixData(null);setPanel('AI Debugger');try{// Always capture fresh compiler/runtime output for the active file so the
  // AI never diagnoses a stale error from another file (or "no error" when it did fail).
  let stderr='';if(['python','javascript','c','cpp','java'].includes(t.language)){try{const probe=await api('/execute',{method:'POST',body:JSON.stringify({code:currentCode(),language:t.language,stdin})});stderr=(probe?.stderr||'').trim()}catch(runError){stderr=errors||(runError instanceof Error?runError.message:String(runError))}}else stderr=`This file is ${t.language}, which cannot be executed in this editor; review it for errors and explain it.`;const suggestion=await api('/ai-fix',{method:'POST',body:JSON.stringify({code:currentCode(),language:t.language,stdin,stderr})});setAi(false);setFix(true);setFixData(suggestion);sendRoom('ai:fix_ready',suggestion)}catch(error){setAi(false);setAiError(error instanceof Error?error.message:String(error));setPanel('AI Debugger')}}
 const openAiTool=(tool:'home'|'test'|'translate'|'fix'|'ask')=>{setAiTool(tool);setAiPanelOpen(true);if(tool==='translate'&&tabs[active])setTranslateLanguage(['python','javascript','typescript','java','c','cpp'].find(lang=>lang!==tabs[active].language)||'python')}
 const reviewActiveFile=()=>{const t=tabs[active];if(!t)return;const code=currentCode();openAiTool('ask');setAskIntent('ask');void submitAsk(`Review ${t.path}`,`Review this ${t.language} source file (${t.path}). Explain the review in clear English. Check correctness, readability, edge cases, and security risks. Return prioritized findings with line references when possible. If no issues are found, say that clearly. Do not rewrite the whole file unless needed.\n\n\`\`\`${t.language}\n${code}\n\`\`\``)}
 const startCodeGeneration=()=>{openAiTool('ask');setAskIntent('generate');setAskMsg('')}
 const generateTests=()=>{const t=tabs[active];if(!t)return;openAiTool('test');void submitAsk(`Generate tests for ${t.path}`,`Generate comprehensive test cases for this ${t.language} code in ${t.path}. Include normal cases, edge cases, and invalid inputs where relevant. Prefer runnable tests using the language's common testing conventions. Explain how to run them, and put the test code in a fenced code block.\n\n\`\`\`${t.language}\n${currentCode()}\n\`\`\``)}
 const translateCode=()=>{const t=tabs[active];if(!t)return;openAiTool('translate');void submitAsk(`Translate ${t.path} to ${translateLanguage}`,`Convert this ${t.language} program into ${translateLanguage}. Preserve behavior and explain any language-specific changes briefly. Put the complete translated program in a fenced code block labeled ${translateLanguage}.\n\n\`\`\`${t.language}\n${currentCode()}\n\`\`\``)}
 const applyFix=async()=>{const t=tabs[active];if(!t||!fixData)return;const fixed=fixData.fixed_code||t.code;const entry=openDocsRef.current.get(t.path);if(entry){entry.yt.delete(0,entry.yt.length);entry.yt.insert(0,fixed)}else if(editorRef.current?.getModel()){editorRef.current.getModel().setValue(fixed)}setTabs(fs=>fs.map((x,i)=>i===active?{...x,code:fixed}:x));setErrors('');setCompilerMarkers('');setVersion(v=>v+1)
  // Wait for the save: Run Project executes what is on disk, and a fire-and-forget
  // PUT used to race with the run, re-reporting the error that was just fixed.
  await persistFile(t.path,fixed,t.language)
  sendRoom('chat:message',{who:'CodeFix AI',text:`${name} applied an AI fix.`});addActivity(`AI fix applied by ${name}`);setFix(false);setFixData(null)
  if(['python','javascript','c','cpp','java'].includes(t.language)){setTimeout(()=>{void run()},80)}}
 const extractCode=(text:string)=>{const m=text.match(/```([\w-]*)\s*\n?([\s\S]*?)```/);return m?{label:m[1],code:m[2].trim()}:null}
 const detectLanguage=(code:string,label?:string):string=>{
  const fence=(label||'').toLowerCase()
  if(fence==='python'||fence==='py'||fence==='python3')return'python'
  if(fence==='javascript'||fence==='js'||fence==='node'||fence==='nodejs')return'javascript'
  if(fence==='c')return'c'
  if(fence==='cpp'||fence==='c++')return'cpp'
  if(fence==='java')return'java'
  if(fence==='typescript'||fence==='ts')return'typescript'
  const text=code.trimStart()
  if(/^#include\s*<iostream>/.test(text))return'cpp'
  if(/^#include/.test(text))return'c'
  if(/^\s*public\s+class\s|void\s+main\s*\(/.test(text))return'java'
  if(/\b(?:function|console\.log)\b|=>/.test(text))return'javascript'
  if(/^\s*def\s+\w+\s*\(|print\(/.test(text))return'python'
  return'python'
 }
 const submitAsk=async(displayText:string,prompt=displayText)=>{if(!displayText.trim()||asking)return;setAskChat(c=>[...c,{role:'user',text:displayText}]);setAsking(true);try{const r=await api('/ask',{method:'POST',body:JSON.stringify({prompt})});setAskChat(c=>[...c,{role:'assistant',text:r.answer}])}catch(error){setAskChat(c=>[...c,{role:'assistant',text:error instanceof Error?error.message:String(error)}])}finally{setAsking(false)}}
 const sendAsk=async()=>{const q=askMsg.trim();if(!q||asking)return;const intent=askIntent;const t=tabs[active];let prompt=q;if(intent==='generate'){prompt=`Respond in clear English. Generate a complete, usable code solution for this request: ${q}\n\n${t?`The active file is ${t.path} (${t.language}). Use it as context and keep the solution compatible:\n\n\`\`\`${t.language}\n${currentCode()}\n\`\`\n\n`:''}Put the generated code in one markdown fenced code block and label it with the language.`}setAskMsg('');setAskIntent('ask');await submitAsk(q,prompt)}
 const importCode=async(code:string,label?:string)=>{
  if(role!=='host'&&role!=='editor')return
  const lang=detectLanguage(code,label);const fixed=code.trim();let path=''
  const t=tabs[active]
  if(t&&t.language===lang){path=t.path;const entry=openDocsRef.current.get(path);if(entry){entry.yt.delete(0,entry.yt.length);entry.yt.insert(0,fixed)}setTabs(f=>f.map((x,i)=>i===active?{...x,code:fixed}:x))}
  else{
   const base=`ai_${lang}`;let n=1;path=`${base}.${extensions[lang]}`
   while(nodes.some(n=>n.path===path)){n++;path=`${base}${n}.${extensions[lang]}`}
   addNodeInTree('',baseName(path),false,lang)
   try{await api(`/workspace/${room}/nodes`,{method:'POST',body:JSON.stringify({parent:'',name:baseName(path),is_directory:false,language:lang})})}catch{}
   try{await api(`/workspace/${room}/file?actor_id=${meId}`,{method:'PUT',body:JSON.stringify({path,content:fixed,language:lang})})}catch{}
   openPath(path)
  }
  setVersion(v=>v+1);setPanel('Output');sendRoom('chat:message',{who:'CodeFix AI',text:`${name} imported code into ${path}.`});addActivity(`${name} imported code into ${path}`)}
 const roomUrl=shareHost?`${location.protocol}//${shareHost}/room/${room}`:`${location.origin}/room/${room}`
 const renderTree=(parent:string,depth:number):any=>{
  const kids=nodes.filter(n=>n.parent===parent).slice().sort((a,b)=>{if(a.isDir!==b.isDir)return a.isDir?-1:1;return a.name.localeCompare(b.name)})
  return kids.map(n=>{
   const open=expanded.has(n.path)
   const editors=tabsOn(n.path)
   return <div key={n.path}>
    <div className={'file-row'+(activePath()===n.path?' active':'')} style={{paddingLeft:6+depth*14}}>
     <span className={'twist'+(n.isDir?' dir':'')} onClick={()=>{if(n.isDir){setExpanded(s=>{const x=new Set(s);if(x.has(n.path))x.delete(n.path);else x.add(n.path);return x})}}}>{n.isDir?(open?iconOf.folderOpen:iconOf.folder):'·'}</span>
     {renaming===n.path
      ? <form className="inline-form" onSubmit={e=>{e.preventDefault();const to=renameValue.trim()||n.name;const toPath=n.parent?`${n.parent}/${to}`:to;setRenaming(null);if(to!==n.name&&toPath!==n.path)renamePath(n.path,toPath)}}><input autoFocus value={renameValue} onChange={e=>setRenameValue(e.target.value)} onBlur={()=>setRenaming(null)} onKeyDown={e=>{if(e.key==='Escape')setRenaming(null)}}/></form>
      : <button className="fname" title={n.isDir?undefined:`${n.path}`} onClick={()=>{if(n.isDir){setExpanded(s=>{const x=new Set(s);if(x.has(n.path))x.delete(n.path);else x.add(n.path);return x})}else openPath(n.path)}}><i className={'fext '+(n.language)}>{n.isDir?'':iconOf[n.language]||'◫'}</i><span className="tname">{n.name}</span></button>}
     <span className="dots" title={editors.map(e=>e.name).join(', ')}>{editors.slice(0,4).map(e=>{const u=users.find(x=>x.id===e.id);return <i key={e.id} className="dot" style={{background:u?.color||colorFor(e.id)}}/>})}</span>
     {role!=='viewer'&&!n.isDir&&<span className="factions"><button className="mini" title="Rename" onClick={()=>{setRenaming(n.path);setRenameValue(n.name)}}>✎</button><button className="mini danger" title="Delete" onClick={()=>deletePath(n.path)}>✕</button></span>}
     {role!=='viewer'&&n.isDir&&<span className="factions"><button className="mini" title="New file inside this folder" onClick={()=>{setNewNode({parent:n.path,isDir:false});setNewNodeName('')}}>＋ file</button><button className="mini" title="New subfolder" onClick={()=>{setNewNode({parent:n.path,isDir:true});setNewNodeName('')}}>＋ folder</button></span>}
    </div>
    {n.isDir&&open&&<>{newNode&&newNode.parent===n.path&&<form className="inline-form new" style={{paddingLeft:6+(depth+1)*14}} onSubmit={e=>{e.preventDefault();commitNewNode()}}><input autoFocus placeholder={newNode.isDir?'sub-folder name':'file name'} value={newNodeName} onChange={e=>setNewNodeName(e.target.value)} onKeyDown={e=>{if(e.key==='Escape')setNewNode(null)}}/><button type="submit">✓</button></form>}{renderTree(n.path,depth+1)}</>}
   </div>})}
   const treeProps={nodes,canEdit:role!=='viewer',renderNode:renderTree,onNewFile:()=>{setNewNode({parent:'',isDir:false});setNewNodeName('')},onNewFolder:()=>{setNewNode({parent:'',isDir:true});setNewNodeName('')},emptyMessage:joined?(treeReady?'empty workspace — create a file above':'syncing workspace…'):'Connect to view files'}
 return <div className={'app codepilot'+(sidebarOpen?' sidebar-open':'')}><header><div className="brand"><span className="mark">⌘</span><span>CodeFix <b>AI</b></span></div><div className="room-pill">ROOM <strong>{room||'—'}</strong><span className="online">● {users.length} online</span></div><div className="head-actions"><button className="icon-button mobile-files" title="Toggle files" onClick={()=>setSidebarOpen(v=>!v)}>☷</button><button className="ghost theme-toggle" onClick={()=>setTheme(t=>t==='light'?'dark':'light')} title={theme==='light'?'Switch to dark mode':'Switch to light mode'}>{theme==='light'?'☾ Dark':'☀ Light'}</button><button className="ghost" onClick={()=>openAiTool('ask')}>✦ AI Tools</button>{joined&&role!=='viewer'&&<button className="ghost" onClick={()=>setImportOpen(true)} title="Import a project (folder, server path, or GitHub)">⇩ Import</button>}<button className="ghost" onClick={()=>setShare(true)}>↗ Share</button>{joined&&<button className="ghost" onClick={saveActive} title="Save to project (Ctrl/⌘+S)">💾 Save</button>}{joined&&<button className="ghost leave" onClick={leave}>{role==='host'?'⏻ Close':'⏻ Leave'}</button>}<button className="avatar">{name[0]}</button></div></header>
 <main className="ide-main"><aside className="sidebar ide-sidebar"><button className="create" onClick={create}>＋ Create Coding Room</button>
  <FileTree {...treeProps}>
  {newNode&&newNode.parent===''&&<form className="inline-form new" onSubmit={e=>{e.preventDefault();commitNewNode()}}><input autoFocus placeholder={newNode.isDir?'folder name':'file name'} value={newNodeName} onChange={e=>setNewNodeName(e.target.value)} onKeyDown={e=>{if(e.key==='Escape')setNewNode(null)}}/><button type="submit">✓</button></form>}
 </FileTree>
 <section className="people"><small>ONLINE — {users.length}</small>{users.map(u=>{const p=presence.find(x=>x.id===u.id);const ty=typing.find(t=>t.id===u.id);return <div className={'person'+(ty?' typing':'')} key={u.id}><i style={{background:u.color}}>{u.name[0]}</i><span>{u.name}<em>{ty?`✎ typing${p?.activeFile?` in ${baseName(p.activeFile)}`:''}…`:p?.activeFile?`editing ${baseName(p.activeFile)}`:`${u.device} · ${roleLabel[u.role]}`}</em></span><b className="dot" style={{background:u.color}}>●</b>{role==='host'&&u.id!==meId&&<button className="kick" title="Remove member" onClick={()=>kick(u)}>✕</button>}</div>} )}</section>
 <div className="expire">◷ Auto-saves while you type · no session limit</div></aside>
 <section className="workspace ide-workspace"><div className="editor-top"><EditorTabs tabs={tabs} active={active} presence={presence} users={users} onSelect={setActive} onClose={removeTab}/><div className="top-actions">{role!=='viewer'&&runnableFiles.length>0&&<><select className="entry" value={entry} onChange={e=>setEntry(e.target.value)} title="Project entry (main) file — runs with sibling files, VS Code style">{[...runnableFiles].map(f=><option key={f} value={f}>{f}</option>)}</select><button className="run" disabled={running} onClick={runProject} title="Run the whole project: entry file plus its imports/headers">▶ {running?'Running…':'Run Project'}</button></>}{tabs[active]&&<><div className="language" title="Change language — the file extension updates and the host approves member changes"><select value={tabs[active].language} onChange={e=>changeLanguage(e.target.value)}><option value="python">Python</option><option value="javascript">JavaScript</option><option value="c">C</option><option value="cpp">C++</option><option value="java">Java</option><option value="markdown">Markdown</option></select></div><button className="icon-button ai-toggle" title="Open AI assistant" onClick={()=>openAiTool('fix')}>✦</button><button className="run" disabled={running} onClick={()=>run()}>▶ {running?'Running…':'Run'}</button></>}</div></div>
 <div className="editor ide-editor">{tabs[active]
   ? <><Editor key={`${room}-${tabs[active].path}-${tabs[active].language}`} height="100%" theme="light" language={tabs[active].language} defaultValue={currentCode()} onChange={updateCode} onMount={(editor,monaco)=>{editorRef.current=editor;monacoRef.current=monaco;const model=editor.getModel();if(model)monaco.editor.setModelMarkers(model,'codepilot',[]);editor.addAction({id:'codepilot.format',label:'Format Document',keybindings:[monaco.KeyMod.Shift|monaco.KeyMod.Alt|monaco.KeyCode.KeyF],run:()=>editor.getAction('editor.action.formatDocument')?.run()});editor.addAction({id:'codepilot.run',label:'Run Current File',keybindings:[monaco.KeyMod.CtrlCmd|monaco.KeyCode.Enter],run:()=>{document.querySelector<HTMLButtonElement>('.run')?.click()}});editor.onDidScrollChange(()=>paintPresence());editor.onDidChangeModelContent(()=>paintPresence());editor.onDidChangeCursorSelection(()=>paintPresence());editor.onDidLayoutChange(()=>paintPresence());setTimeout(syncBinding,0)}} options={{fontSize:15,fontLigatures:true,minimap:{enabled:true,renderCharacters:false},bracketPairColorization:{enabled:true},padding:{top:18},automaticLayout:true,readOnly:role==='viewer'||role==='guest',renderValidationDecorations:'on',smoothScrolling:true,scrollBeyondLastLine:false}}/>
    <div className="rcursors">{rcursors.map(c=><div key={c.cid} className={'rcursor'+(c.typing?' typing':'')+(c.below?' below':'')} style={{left:c.left,top:c.top,height:c.height}}><i className="rcaret" style={{background:c.color}}/>{c.typing&&<b className="rname" style={{background:c.color}}>{c.name}</b>}</div>)}</div>{othersTyping().length>0&&<div className="live-typing"><span style={{borderColor:'#4a4c5e',background:'#1b1c25'}}><span className="avatars">{othersTyping().map(t=><i key={t.id} style={{background:colorOf(t.id)}} title={t.name}>{t.name[0]}</i>)}</span><span className="live-text">{typingNames(othersTyping())}<em className="live-file">{typingIn(othersTyping())}</em><span className="blink">…</span></span></span></div>}</>
   : <div className="editor-placeholder"><span>◫</span><p>Open a file from the workspace tree to start editing together.</p></div>}</div>
 <div className="terminal-wrap" style={{height:terminalResize.size}}>
  <ResizeHandle {...terminalResize.resizeHandleProps}/>
  <TerminalPanel panel={panel} onPanel={setPanel} chatCount={chat.length} onClear={()=>{if(panel==='Output')setOutput('');else if(panel==='Errors'){setErrors('');setCompilerMarkers('')}else if(panel==='Chat')setChat([]);else if(panel==='Activity')setActivity([]);else if(panel==='AI Debugger'){setFixData(null);setFix(false);setAiError('')}}}>
   <div className="panel-content">
    {panel==='Output'&&<><div className="output-toolbar">{canDownload&&tabs[active]&&<button className="download" onClick={downloadFile}>⇩ Download {tabs[active].name}</button>}<span className="status-chip">Output</span></div><pre>{output}</pre>{(interactive||needsInput)&&<form className="console-in" onSubmit={async e=>{e.preventDefault();const line=consoleIn;const send=interactiveEnv?.sendLine;if(interactive){if(!send||!line.trim())return;send(line);setOutput(o=>o+(o.endsWith('\n')||!o?'':'\n')+line+'\n');setConsoleIn('');return}const next=stdin?stdin+'\n'+line:line;setStdin(next);setConsoleIn('');await run(next)}}><span className="prompt">⌨&nbsp;</span><input autoFocus value={consoleIn} onChange={e=>setConsoleIn(e.target.value)} placeholder={interactive?'Type input for the running program and press Enter…':'Program needs input — type a line and press Enter. It re-runs with your input.'}/><button type="submit">{interactive?'Enter':'Run with input'}</button></form>}</>}
    {panel==='Input'&&<div className="stdinblock">{interactive?interactiveEnv?<p className="hint">⌨ The program is waiting for input — type one line and click Send (you can keep feeding it, in real time).</p>:<p className="hint">Waiting for the in-browser interpreter…</p>:needsInput?<p className="hint">⌨ This program asked for input and none was available. Enter one value per line below, then click ▶ Run with this input — or type a line in Output and press Enter.</p>:<p className="hint">These values are sent to the program as keyboard input when you click ▶ Run — one value per line, in the order the program asks.</p>}<textarea className="stdin" value={stdin} onChange={e=>setStdin(e.target.value)} placeholder={'Enter each program input on its own line, e.g.:\n5\n10\n'} autoFocus={needsInput}/>{interactive?<div><button onClick={()=>{const send=interactiveEnv?.sendLine;if(!send)return;const lines=stdin.split('\n');const idx=lines.findIndex(l=>l.trim()!=='');if(idx<0)return;const line=lines[idx];send(line);lines.splice(idx,1);setStdin(lines.join('\n'))}}>Send ⏎</button></div>:<div><button onClick={()=>run()} disabled={running||!tabs[active]}>▶ Run with this input</button></div>}</div>}
    {panel==='Errors'&&<pre className="diagnostic-output">{errors||'No compiler errors.'}</pre>}
    {panel==='AI Debugger'&&(ai?<div className="thinking">✦ AI is preparing a full explanation…</div>:aiError?<div><p className="warning">{aiError}</p><p className="empty" style={{marginTop:12}}>Check that a file is open and OpenRouter is configured.</p></div>:fix&&fixData?<ExplainResult data={fixData} currentCode={currentCode()} onApply={applyFix} onDismiss={()=>{setFix(false);setFixData(null)}}/>:<div className="empty">Open a file and click ✦ Explain & fix to get a full program explanation.</div>)}
    {panel==='Chat'&&<><div className="messages">{chat.map((c,i)=>{const sys=c.who==='CodeFix AI';const col=sys?'#9c83ff':(c.id?(users.find(u=>u.id===c.id)?.color||colorFor(c.id)):'#7c5cff');return <p key={i} className={sys?'msg sys':''}><span className="msg-who" style={{color:col,background:col+'22',borderColor:col+'66'}} title={c.who}>{sys?'✦':(c.who||'?')[0].toUpperCase()}</span><span className="msg-text"><b style={{color:col}}>{c.who}</b> {c.text}</span></p>})}</div>{typing.length>0&&<div className="typing-line"><span style={{color:typing.some(t=>t.id===meId)?colorOf(meId):colorOf(othersTyping()[0]?.id)}}><b>{typingNames(typing)}</b><em className="live-file">{typingIn(typing)}</em><span className="blink">…</span></span></div>}<form onSubmit={e=>{e.preventDefault();const txt=message.trim();if(txt){sendRoom('chat:message',{id:meId,who:name,text:txt});setChat(c=>[...c,{id:meId,who:name,text:txt}]);setMessage('')}}}><input value={message} onChange={e=>setMessage(e.target.value)} placeholder="Type a message…"/><button>↑</button></form></>}
    {panel==='Activity'&&<div className="activity"><p className="hint">Type in any file — changes auto-save to the project workspace (to disk).</p>{activity.map((a,i)=><p key={i}>{a}</p>)}</div>}
   </div>
  </TerminalPanel>
 </div></section>
 <aside className="ide-ai" style={{width:aiPanelOpen?aiResize.size:0,minWidth:aiPanelOpen?aiResize.size:0}} aria-hidden={!aiPanelOpen}>
  <ResizeHandle {...aiResize.resizeHandleProps}/>
  <AiPanel open={aiPanelOpen} onClose={()=>setAiPanelOpen(false)}><div className="ai-intro"><span className="eyebrow">AI CODING ASSISTANT</span><h2>AI Tools</h2><p>Test, translate, fix, or ask about your code.</p></div><div className="ai-actions ai-tool-nav">{([['test','AI Test'],['translate','AI Translate'],['fix','AI Fix'],['ask','AI Ask']] as const).map(([tool,label])=><button key={tool} className={aiTool===tool?'selected':''} onClick={()=>openAiTool(tool)}>{label}</button>)}</div>
   {aiTool==='home'&&<div className="empty">Choose an AI tool above. {tabs[active]?`The active file, ${tabs[active].name}, will be used as context.`:'Open a file to use AI Test, AI Translate, or AI Fix.'}</div>}
   {aiTool==='fix'&&(ai?<div className="thinking">✦ Preparing a full explanation of {tabs[active]?.name||'the active file'}…</div>:aiError?<p className="warning">{aiError}</p>:fixData&&fix?<ExplainResult data={fixData} currentCode={currentCode()} onApply={applyFix} onDismiss={()=>{setFix(false);setFixData(null)}}/>:<div className="empty"><p>{tabs[active]?`Ready to explain or fix ${tabs[active].name}.`:'Open a file to use AI Fix.'}</p><button onClick={analyze} disabled={!tabs[active]||ai}>✦ Explain & fix active file</button></div>)}
   {aiTool==='test'&&<div className="ai-tool-content"><p>Generate test cases for {tabs[active]?.name||'the active file'}, including edge cases.</p><button onClick={generateTests} disabled={!tabs[active]||asking}>✦ Generate test cases</button></div>}
   {aiTool==='translate'&&<div className="ai-tool-content"><p>Convert the active file to another programming language.</p><label>Target language<select value={translateLanguage} onChange={e=>setTranslateLanguage(e.target.value)}>{['python','javascript','typescript','java','c','cpp'].filter(lang=>lang!==tabs[active]?.language).map(lang=><option key={lang} value={lang}>{lang}</option>)}</select></label><button onClick={translateCode} disabled={!tabs[active]||asking}>✦ Translate code</button></div>}
   {aiTool!=='ask'&&askChat.length>0&&<div className="aiask-body in-ai-panel">{askChat.map((m,i)=>{const code=m.role==='assistant'?extractCode(m.text):null;return <div key={i} className={'ask-msg '+m.role}><span className="ask-tag">{m.role==='user'?(name[0]||'Y'):'AI'}</span><div><p>{m.text}</p>{code&&(role==='host'||role==='editor')&&<button className="import" onClick={()=>importCode(code.code,code.label)}>⇩ Import to Workspace</button>}</div></div>})}{asking&&<div className="ask-msg assistant"><span className="ask-tag">AI</span><p className="thinking">✦ AI is thinking…</p></div>}</div>}
   {aiTool==='ask'&&<><div className="aiask-body in-ai-panel">{askChat.length===0?<div className="empty">Ask a programming question or describe code to generate. Your active file can be included as context.</div>:askChat.map((m,i)=>{const code=m.role==='assistant'?extractCode(m.text):null;return <div key={i} className={'ask-msg '+m.role}><span className="ask-tag">{m.role==='user'?(name[0]||'Y'):'AI'}</span><div><p>{m.text}</p>{code&&(role==='host'||role==='editor')&&<button className="import" onClick={()=>importCode(code.code,code.label)}>⇩ Import to Workspace</button>}</div></div>})}{asking&&<div className="ask-msg assistant"><span className="ask-tag">AI</span><p className="thinking">✦ AI is thinking…</p></div>}</div><form className="aiask-form in-ai-panel" onSubmit={e=>{e.preventDefault();sendAsk()}}><input value={askMsg} onChange={e=>setAskMsg(e.target.value)} placeholder={askIntent==='generate'?'Describe the code you want to generate…':'Ask anything about code…'}/><button disabled={asking||!askMsg.trim()}>↑</button></form></>}
  </AiPanel>
 </aside></main> {fsError&&<div className="toast warn" onClick={()=>setFsError('')}>⚠ {fsError}</div>}
 {created&&<div className="toast">✓ Workspace {room} created — files auto-save to the project</div>}
 {pending.length>0&&<div className="request"><div><span>JOIN REQUEST</span><h3>{pending[0].name} wants to join</h3><p>{pending[0].device} · requests editor access</p><button onClick={()=>accept(pending[0])}>Accept</button><button className="ghost" onClick={()=>rejectJoin(pending[0])}>Reject</button></div></div>}
 {role==='host'&&langPending.length>0&&<div className="lang-request">{langPending.map(req=><div key={req.id}><span>LANGUAGE CHANGE</span><h3>{req.name} wants to switch {baseName(req.from)} → {baseName(req.to)}</h3><p>{req.language} · the file will be renamed for everyone</p><button onClick={()=>approveLanguage(req)}>Approve</button><button className="ghost" onClick={()=>rejectLanguage(req)}>Reject</button></div>)}</div>}
 {share&&<div className="modal"><div><button className="close" onClick={()=>setShare(false)}>×</button><h2>Share coding room</h2><p>Invite teammates to request access to <b>{room}</b>.</p>{location.hostname==='localhost'&&<><p className="warning">A phone cannot open <b>localhost</b>. Enter this computer’s LAN address (for example: 192.168.1.2:5173).</p><input value={shareHost} onChange={e=>setShareHost(e.target.value)} placeholder="192.168.1.2:5173"/></>}<div className="qr"><QRCodeSVG value={roomUrl} size={150}/></div><div className="share-link"><input readOnly value={roomUrl}/><button onClick={()=>navigator.clipboard.writeText(roomUrl)}>Copy</button></div></div></div>}
  {importOpen&&<div className="modal"><div><button className="close" onClick={()=>{setImportOpen(false);setImportMsg('')}}>×</button><h2>Import project into {room}</h2><p>Add an external project to this shared workspace. Then open any file or use <b>▶ Run Project</b>.</p>{importMsg&&<p className={importMsg.startsWith('⚠')?'warning':'ok'}>{importMsg}</p>}<div className="import-tabs">{[['upload','Folder / Files'],['path','Server path'],['github','GitHub URL']].map(([k,l])=><button key={k} className={importTab===k?'active':''} onClick={()=>{setImportTab(k as any);setImportMsg('')}}>{l}</button>)}</div>{importTab==='upload'&&<div className="import-body"><p>Pick a folder (or files) from this device — they are added to the room store and shared with everyone.</p><label className="import-pick"><span>{importing?'Importing…':'＋ Choose folder / files'}</span><input type="file" {...({'webkitdirectory':''} as any)} multiple onChange={onImportPicked} disabled={importing}/></label></div>}{importTab==='path'&&<div className="import-body"><p>Path to a project folder already on the <b>backend machine</b> (the computer running FastAPI).</p><input value={importPath} onChange={e=>setImportPath(e.target.value)} placeholder="/Users/me/projects/my-app"/><button className="full" onClick={importFromPath} disabled={importing||!importPath.trim()}>⇩ Import from path</button></div>}{importTab==='github'&&<div className="import-body"><p>Clone a repository into the workspace (backend runs <code>git clone</code>).</p><input value={importUrl} onChange={e=>setImportUrl(e.target.value)} placeholder="https://github.com/user/repo.git"/><input value={importBranch} onChange={e=>setImportBranch(e.target.value)} placeholder="branch (optional)"/><button className="full" onClick={importFromGithub} disabled={importing||!importUrl.trim()}>⇩ Clone & import</button></div>}</div></div>}
 {route==='landing'&&!joined&&<div className="modal"><div><span className="eyebrow">CODING WORKSPACE</span><h2>Create a coding room</h2><p>Name yourself, start a project workspace, then share the link so teammates can edit different modules together — or the same file.</p><input value={name} onChange={e=>setName(e.target.value)} placeholder="Your name"/><label className="session-lang"><span>Starting language — members can switch later with host approval</span><select value={createLanguage} onChange={e=>setCreateLanguage(e.target.value)}><option value="python">Python</option><option value="javascript">JavaScript</option><option value="c">C</option><option value="cpp">C++</option><option value="java">Java</option></select></label>{createError&&<p className="warning">{createError}</p>}<button className="full" onClick={create}>＋ Create Coding Room</button><div className="divider">already have a room?</div><input value={joinCode} onChange={e=>setJoinCode(e.target.value)} placeholder="Room code — e.g. CFX-8A72KD"/><button className="full ghost" onClick={joinByCode}>⇢ Join Room</button></div></div>}
 {route==='guest'&&!joined&&<div className="modal"><div><button className="close" onClick={()=>history.back()}>×</button><span className="eyebrow">JOIN CODING ROOM</span><h2>{room}</h2>{guestStep==='form'&&<><p>Enter your name to request access from the room host.</p><input value={name} onChange={e=>setName(e.target.value)} placeholder="Your name"/>{guestMsg&&<p className="warning">{guestMsg}</p>}<button className="full" onClick={requestJoin}>Request to Join</button></>}{guestStep==='waiting'&&<><p className="warning">⏳ Waiting for the host to approve your request…</p><button className="ghost" onClick={()=>setGuestStep('form')}>Change name</button></>}{guestStep==='rejected'&&<><p className="warning">The join request was not approved. Please try again.</p><button className="full" onClick={()=>setGuestStep('form')}>Try again</button></>}</div></div>}
 </div>
}
createRoot(document.getElementById('root')!).render(<App/>)
