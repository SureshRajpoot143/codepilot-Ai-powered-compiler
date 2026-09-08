import React, {useEffect, useMemo, useRef, useState} from 'react'
import {createRoot} from 'react-dom/client'
import Editor, {OnMount} from '@monaco-editor/react'
import {QRCodeSVG} from 'qrcode.react'
import * as Y from 'yjs'
import {WebsocketProvider} from 'y-websocket'
import {MonacoBinding} from 'y-monaco'
import './styles.css'

type Role='host'|'editor'|'viewer'|'guest'
type Member={id:string;name:string;device:string;role:Role}
type User={id:string;name:string;device:string;role:Role;color:string}
type File={name:string;language:string;code:string}
const initial=`# Welcome to CodeFix AI\n# Invite teammates and edit together in real time.\ndef hello():\n    print("Hello, World!")\n\nhello()\n`
const extensions:Record<string,string>={python:'py',javascript:'js',cpp:'cpp',c:'c',java:'java',markdown:'md'}
const linkedRoom=location.pathname.match(/^\/room\/([^/]+)\/?$/)?.[1]
const collabUrl=import.meta.env.VITE_COLLAB_URL || `${location.protocol==='https:'?'wss':'ws'}://${location.hostname}:1234`
const wsProto=location.protocol==='https:'?'wss':'ws'
const meId=(()=>{let id=localStorage.getItem('cfx_me')||'';if(!id){id='U-'+Math.random().toString(36).slice(2,10).toUpperCase();localStorage.setItem('cfx_me',id)};return id})()
const myDevice=/Mobi|Android|iPhone/i.test(navigator.userAgent)?'Mobile':'This device'
const starterPrograms:Record<string,string>={
 python:initial,
 javascript:`// Welcome to CodeFix AI\n// Invite teammates and edit together in real time.\n\nfunction hello() {\n  console.log("Hello, World!");\n}\n\nhello();\n`,
 c:`#include <stdio.h>\n\nint main(void) {\n    printf("Hello, World!\\n");\n    return 0;\n}\n`,
 cpp:`#include <iostream>\n\nint main() {\n    std::cout << "Hello, World!" << std::endl;\n    return 0;\n}\n`,
 java:`public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}\n`,
 markdown:'# CodeFix AI room\n\nInvite teammates and write together.\n',
}
const colors=['#7c5cff','#00b894','#ff8a4c','#e056fd']
const roleLabel:Record<Role,string>={host:'Host',editor:'Editor',viewer:'Viewer',guest:'Guest'}
async function api(path:string,opts:RequestInit={}){
 const res=await fetch(`/api${path}`,{headers:{'Content-Type':'application/json'},...opts})
 const raw=await res.text();let data:any={};try{data=raw?JSON.parse(raw):{}}catch{}
 if(!res.ok)throw new Error(data.detail||`Request failed (${res.status})`);return data
}
function App(){
 const [room,setRoom]=useState(linkedRoom||''),[created,setCreated]=useState(false)
 const [route,setRoute]=useState<'landing'|'guest'>(linkedRoom?'guest':'landing'),[joinCode,setJoinCode]=useState('')
 const [name,setName]=useState('You'),[role,setRole]=useState<Role>('guest'),[joined,setJoined]=useState(false)
 const [guestStep,setGuestStep]=useState<'form'|'waiting'|'rejected'>('form'),[guestMsg,setGuestMsg]=useState(''),[createError,setCreateError]=useState('')
 const [share,setShare]=useState(false),[shareHost,setShareHost]=useState(location.hostname==='localhost'?'':location.host)
 const [files,setFiles]=useState<File[]>([{name:'main.py',language:'python',code:initial},{name:'utils.py',language:'python',code:'# Shared utilities\n'},{name:'README.md',language:'markdown',code:'# CodeFix AI room\n'}])
 const [active,setActive]=useState(0),[users,setUsers]=useState<User[]>([]),[pending,setPending]=useState<Member[]>([])
 const [output,setOutput]=useState('Run code to see compiler output.'),[running,setRunning]=useState(false),[panel,setPanel]=useState('Output'),[stdin,setStdin]=useState(''),[canDownload,setCanDownload]=useState(false)
 const [chat,setChat]=useState<{who:string;text:string}[]>([]),[message,setMessage]=useState(''),[ai,setAi]=useState(false),[fix,setFix]=useState(false),[fixData,setFixData]=useState<any>(null),[aiError,setAiError]=useState(''),[errors,setErrors]=useState('')
 const [askOpen,setAskOpen]=useState(false),[askChat,setAskChat]=useState<{role:'user'|'assistant';text:string}[]>([]),[askMsg,setAskMsg]=useState(''),[asking,setAsking]=useState(false)
 const [version,setVersion]=useState(1),[activity,setActivity]=useState<string[]>(['Room created']),[expiresAt,setExpiresAt]=useState(0),[now,setNow]=useState(Date.now())
 const editorRef=useRef<any>();const monacoRef=useRef<any>();const wsRef=useRef<WebSocket>();const creatorRef=useRef(false)
 const ydoc=useMemo(()=>new Y.Doc(),[room]);const ytext=useMemo(()=>ydoc.getText(files.map(f=>f.name)[0]),[ydoc]);const providerRef=useRef<WebsocketProvider>()
 const addActivity=(text:string)=>setActivity(a=>[`${new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} — ${text}`,...a].slice(0,30))
 const sendRoom=(event:string,data:any)=>{if(wsRef.current?.readyState===WebSocket.OPEN)wsRef.current.send(JSON.stringify({event,data}))}
 const upsertUser=(m:Member)=>{setUsers(us=>{const i=us.findIndex(x=>x.id===m.id);if(i>=0){const next=[...us];next[i]={...next[i],name:m.name,device:m.device,role:m.role};return next}const color=colors[(us.length-1)%colors.length];return [...us,{id:m.id,name:m.name,device:m.device,role:m.role,color}]})}
 const showResult=(r:any)=>{setCanDownload(r?.status==='Success');if(r?.stderr){setCompilerMarkers(r.stderr);setErrors(r.stderr)};const tip=/input|EOF/i.test(r?.stderr||'')?'\n\nTip: type the program inputs in the Input box (one per line) and click Run again.':'';setOutput(`Status: ${r?.status||'—'}\n\n${r?.stdout||''}${r?.stderr?`\nErrors:\n${r.stderr}`:''}\nTime: ${r?.time||'—'} sec  •  Memory: ${r?.memory||'—'}${tip}`)}
 useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(t)},[])
 useEffect(()=>{if(location.hostname!=='localhost'&&location.hostname!=='127.0.0.1')return;fetch('/api/network').then(r=>r.json()).then((d:any)=>{if(d?.ip&&d.ip!=='0.0.0.0')setShareHost(`${d.ip}:5173`)}).catch(()=>{})},[])
 useEffect(()=>{const connected=Boolean(room)&&(joined||guestStep==='waiting');if(!connected)return
  const ws=new WebSocket(`${wsProto}://${location.host}/ws/rooms/${room}/${meId}`);wsRef.current=ws
  ws.onmessage=(e)=>{const msg=JSON.parse(e.data)
   switch(msg.event){
    case 'room:join_request':if(role==='host')setPending(p=>p.some(x=>x.id===msg.data.id)?p:[...p,msg.data]);break
    case 'room:join_accepted':
     if(msg.data.id===meId){setRole(msg.data.role==='host'?'host':msg.data.role as Role);setJoined(true);setGuestStep('form');addActivity(`Approved — you can now edit`)}break
    case 'room:members':setUsers(msg.data.map((m:any,i:number)=>({id:m.id,name:m.name,device:m.device,role:m.role,color:colors[i%colors.length]})));break
    case 'room:join_rejected':
     if(msg.data.id===meId)setGuestStep('rejected');break
    case 'room:user_joined':upsertUser(msg.data);if(msg.data.id!==meId){setChat(c=>[...c,{who:'CodeFix AI',text:`${msg.data.name} joined the room.`}])}addActivity(`${msg.data.name} joined`);break
    case 'room:user_left':setUsers(us=>{const u=us.find(x=>x.id===msg.data.id);if(u){setChat(c=>[...c,{who:'CodeFix AI',text:`${u.name} left the room.`}]);addActivity(`${u.name} left`)}return us.filter(x=>x.id!==msg.data.id)});break
    case 'room:removed':
     if(msg.data.id===meId){setActivity(a=>[`You were removed by the host`, ...a]);resetToLanding()}
     else{setUsers(us=>us.filter(x=>x.id!==msg.data.id));setChat(c=>[...c,{who:'CodeFix AI',text:`${msg.data.name} was removed by the host.`}]);addActivity(`${msg.data.name} removed`)}
     break
    case 'room:closed':resetToLanding();break
    case 'chat:message':setChat(c=>[...c,msg.data]);break
    case 'execution:start':setRunning(true);setOutput(`${msg.data?.user||'Someone'} is running the code…`);setPanel('Output');break
    case 'execution:result':setRunning(false);showResult(msg.data);addActivity(`Code executed`);break
    case 'ai:fix_ready':setFixData(msg.data);setFix(true);setPanel('AI Debugger');break
   }}
  return()=>{ws.close();if(wsRef.current===ws)wsRef.current=undefined}
 },[room,joined,guestStep,role])
 useEffect(()=>{if(!room||!joined)return;const p=new WebsocketProvider(collabUrl,`codefix-${room}-main`,ydoc);providerRef.current=p;p.on('sync',(synced:boolean)=>{if(synced&&!ytext.length&&(creatorRef.current||role==='host'))ytext.insert(0,initial)});p.on('status',({status}:{status:string})=>{if(status==='disconnected'&&!ytext.length&&(creatorRef.current||role==='host'))ytext.insert(0,initial)});return()=>{p.destroy();if(providerRef.current===p)providerRef.current=undefined}},[room,joined,ydoc,ytext,role])
 const onMount:OnMount=(editor,monaco)=>{editorRef.current=editor;monacoRef.current=monaco;const model=editor.getModel();if(model&&active===0){if(!ytext.length&&creatorRef.current)ytext.insert(0,model.getValue()||initial);new MonacoBinding(ytext,model,new Set([editor]),providerRef.current?.awareness)}}
 const setCompilerMarkers=(error:string)=>{const model=editorRef.current?.getModel();const monaco=monacoRef.current;if(!model||!monaco)return;const requestedLine=Number(error.match(/(?:line\s+|:)(\d+)/i)?.[1]||1);const line=Math.max(1,Math.min(requestedLine,model.getLineCount()));monaco.editor.setModelMarkers(model,'jdoodle',error?[{severity:monaco.MarkerSeverity.Error,message:error,startLineNumber:line,startColumn:1,endLineNumber:line,endColumn:model.getLineMaxColumn(line)}]:[])}
 const updateCode=(value?:string)=>{if(role==='viewer')return;setCompilerMarkers('');setCanDownload(false);const code=value??'';setFiles(fs=>fs.map((f,i)=>i===active?{...f,code}:f));setVersion(v=>v+1)}
 const create=async()=>{setCreateError('');try{
  if(room&&role==='host'){try{await api(`/rooms/${room}?host_id=${meId}`,{method:'DELETE'})}catch{}}
  setJoined(false);setChat([]);setPending([]);setActivity([]);setFix(false);setFixData(null)
  const r=await api('/rooms',{method:'POST',body:JSON.stringify({id:meId,name:name.trim()||'You',device:myDevice})});creatorRef.current=true;history.pushState({},'',`/room/${r.id}`);setRoom(r.id);setCreated(true);setJoined(true);setRole('host');setExpiresAt(r.expires_at);setUsers([{id:meId,name:r.members[meId].name,device:myDevice,role:'host',color:colors[0]}])
 }catch(error){setCreateError(error instanceof Error?error.message:String(error))}}
 const joinByCode=()=>{const code=(joinCode||'').trim().toUpperCase();if(!code)return;setRoute('guest');setRoom(code);setCreated(false);history.pushState({},'',`/room/${code}`)}
 const resetToLanding=()=>{setJoined(false);setRole('guest');setUsers([]);setPending([]);setRoom('');setRoute('landing');setGuestStep('form');setGuestMsg('');setCreateError('');setCreated(false);setChat([]);setFix(false);setFixData(null);setActivity(['Left the room']);history.pushState({},'', '/')}
 const leave=async()=>{if(!room)return;if(role==='host'){try{await api(`/rooms/${room}?host_id=${meId}`,{method:'DELETE'})}catch{}}resetToLanding()}
 const kick=async(m:User)=>{if(role!=='host'||m.id===meId)return;try{await api(`/rooms/${room}/members/${m.id}?host_id=${meId}`,{method:'DELETE'})}catch{}}
 const requestJoin=async()=>{if(!name.trim()||!room)return;setGuestMsg('');try{await api(`/rooms/${room}/join`,{method:'POST',body:JSON.stringify({id:meId,name:name.trim(),device:myDevice})});setGuestStep('waiting')}catch(error){setGuestMsg(error instanceof Error?error.message:String(error))}}
 const accept=async(m:Member)=>{try{await api(`/rooms/${room}/members/${m.id}/approve?host_id=${meId}&role=editor`,{method:'POST'});setPending(p=>p.filter(x=>x.id!==m.id))}catch{setPending(p=>p.filter(x=>x.id!==m.id))}}
 const rejectJoin=async(m:Member)=>{try{await api(`/rooms/${room}/members/${m.id}/reject?host_id=${meId}`,{method:'POST'})}catch{}setPending(p=>p.filter(x=>x.id!==m.id))}
 const run=async()=>{setRunning(true);setCanDownload(false);setOutput(`${name} is running the latest shared version…`);setPanel('Output');sendRoom('execution:start',{user:name});try{const result=await api('/execute',{method:'POST',body:JSON.stringify({code:active===0?ytext.toString():files[active].code,language:files[active].language,stdin})});sendRoom('execution:result',result);showResult(result);addActivity('Code executed')}catch(error){setOutput(`Execution unavailable\n\n${error instanceof Error?error.message:'Could not contact compiler.'}\n\nStart FastAPI and configure JDOODLE_CLIENT_ID and JDOODLE_CLIENT_SECRET for real compiler output.`)}finally{setRunning(false)}}
 const downloadFile=()=>{const f=files[active];const content=active===0?ytext.toString():f.code;const blob=new Blob([content],{type:'text/plain;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=f.name||(`program${extensions[f.language]?`.${extensions[f.language]}`:''}`);document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);addActivity(`Downloaded ${f.name}`)}
 const changeLanguage=(language:string)=>{if(role==='viewer'||language===files[active].language)return;const code=starterPrograms[language];setFiles(fs=>fs.map((f,i)=>{if(i!==active)return f;const base=f.name.replace(/\.[^.]+$/,'');return {...f,language,name:`${base}.${extensions[language]}`,code}}));if(active===0){ytext.delete(0,ytext.length);ytext.insert(0,code)}setVersion(v=>v+1)}
 const analyze=async()=>{setAi(true);setAiError('');setFix(false);setFixData(null);setPanel('AI Debugger');const code=active===0?ytext.toString():files[active].code;try{const suggestion=await api('/ai-fix',{method:'POST',body:JSON.stringify({code,language:files[active].language,stderr:errors})});setAi(false);setFix(true);setFixData(suggestion);sendRoom('ai:fix_ready',suggestion)}catch(error){setAi(false);setAiError(error instanceof Error?error.message:String(error));setPanel('AI Debugger')}}
 const applyFix=()=>{if(active!==0||!fixData)return;const fixed=fixData.fixed_code||ytext.toString();ytext.delete(0,ytext.length);ytext.insert(0,fixed);setFiles(f=>f.map((x,i)=>i===0?{...x,code:fixed}:x));setFix(false);setFixData(null);setVersion(v=>v+1);sendRoom('chat:message',{who:'CodeFix AI',text:`${name} applied an AI fix.`});addActivity(`AI fix applied by ${name}`)}
 const extractCode=(text:string)=>{const m=text.match(/```([\w-]*)\s*\n?([\s\S]*?)```/);return m?{label:m[1],code:m[2].trim()}:null}
 const detectLanguage=(code:string,label?:string):string=>{
  const fence=(label||'').toLowerCase()
  if(fence==='python'||fence==='py'||fence==='python3')return'python'
  if(fence==='javascript'||fence==='js'||fence==='node'||fence==='nodejs')return'javascript'
  if(fence==='c')return'c'
  if(fence==='cpp'||fence==='c++')return'cpp'
  if(fence==='java')return'java'
  const text=code.trimStart()
  if(/^#include\s*<iostream>/.test(text))return'cpp'
  if(/^#include/.test(text))return'c'
  if(/^\s*public\s+class\s|void\s+main\s*\(/.test(text))return'java'
  if(/\b(?:function|console\.log)\b|=>/.test(text))return'javascript'
  if(/^\s*def\s+\w+\s*\(|print\(/.test(text))return'python'
  return'python'
 }
 const sendAsk=async()=>{const q=askMsg.trim();if(!q||asking)return;setAskChat(c=>[...c,{role:'user',text:q}]);setAskMsg('');setAsking(true);try{const r=await api('/ask',{method:'POST',body:JSON.stringify({prompt:q})});setAskChat(c=>[...c,{role:'assistant',text:r.answer}])}catch(error){setAskChat(c=>[...c,{role:'assistant',text:error instanceof Error?error.message:String(error)}])}finally{setAsking(false)}}
 const importCode=(code:string,label?:string)=>{
  if(role!=='host'&&role!=='editor')return
  const lang=detectLanguage(code,label)
  const fixed=code.trim()
  let fileName=''
  if(files[active].language===lang){
   fileName=files[active].name
   if(active===0){ytext.delete(0,ytext.length);ytext.insert(0,fixed);setFiles(f=>f.map((x,i)=>i===0?{...x,code:fixed}:x))}
   else{setFiles(f=>f.map((x,i)=>i===active?{...x,code:fixed}:x))}
  }else{
   const base=`ai_${lang}`;let n=1;fileName=`${base}.${extensions[lang]}`
   while(files.some(f=>f.name===fileName)){n++;fileName=`${base}${n}.${extensions[lang]}`}
   setFiles(f=>[...f,{name:fileName,language:lang,code:fixed}]);setActive(files.length)
  }
  setVersion(v=>v+1);setAskOpen(false);setPanel('Output');sendRoom('chat:message',{who:'CodeFix AI',text:`${name} imported code into ${fileName}.`});addActivity(`${name} imported code into ${fileName}`)}
 const roomUrl=shareHost?`${location.protocol}//${shareHost}/room/${room}`:`${location.origin}/room/${room}`
 const left=expiresAt?Math.max(0,expiresAt*1000-now):0
 const hr=Math.floor(left/3600000);const mn=Math.floor(left/60000)%60;const sc=Math.floor(left/1000)%60
 const fmt=(s:number)=>String(Math.floor(s)).padStart(2,'0')
 return <div className="app"><header><div className="brand"><span className="mark">⌘</span><span>CodeFix <b>AI</b></span></div><div className="room-pill">ROOM <strong>{room||'—'}</strong><span className="online">● {users.length} online</span></div><div className="head-actions"><button className="ghost" onClick={()=>setAskOpen(true)}>✦ AI Ask</button><button className="ghost" onClick={()=>setShare(true)}>↗ Share</button>{joined&&<button className="ghost leave" onClick={leave}>{role==='host'?'⏻ Close Room':'⏻ Leave'}</button>}<button className="avatar">{name[0]}</button></div></header>
 <main><aside className="sidebar"><button className="create" onClick={create}>＋ Create Coding Room</button><button className="ask-open" onClick={()=>setAskOpen(true)}>✦ AI Ask</button><section><small>FILES</small>{files.map((f,i)=><button key={f.name} className={'file '+(i===active?'selected':'')} onClick={()=>setActive(i)}><span>◫</span>{f.name}</button>)}</section><section className="people"><small>ONLINE — {users.length}</small>{users.map(u=><div className="person" key={u.id}><i style={{background:u.color}}>{u.name[0]}</i><span>{u.name}<em>{u.device} · {roleLabel[u.role]}</em></span><b className="dot">●</b>{role==='host'&&u.id!==meId&&<button className="kick" title="Remove member" onClick={()=>kick(u)}>✕</button>}</div>)}</section><div className="expire">◷ Room expires in <b>{fmt(hr)}:{fmt(mn)}:{fmt(sc)}</b></div></aside>
 <section className="workspace"><div className="editor-top"><div className="tab">{files[active].name}<span>×</span></div><div className="language"><select value={files[active].language} onChange={e=>changeLanguage(e.target.value)}><option value="python">Python</option><option value="javascript">JavaScript</option><option value="c">C</option><option value="cpp">C++</option><option value="java">Java</option><option value="markdown">Markdown</option></select></div><button className="ai-btn" onClick={analyze}>✦ AI Fix</button><button className="run" disabled={running} onClick={run}>▶ {running?'Running…':'Run'}</button></div><div className="editor"><Editor key={`${room}-${active}-${files[active].language}`} height="100%" theme="vs-dark" language={files[active].language} defaultValue={active===0?(ytext.toString()||files[0].code):files[active].code} onChange={updateCode} onMount={onMount} options={{fontSize:15,minimap:{enabled:false},readOnly:role==='viewer'||role==='guest',padding:{top:18},automaticLayout:true}}/></div>
 <div className="bottom"><nav>{['Output','Errors','Input','AI Debugger','Chat','Activity'].map(x=><button className={panel===x?'active':''} onClick={()=>setPanel(x)} key={x}>{x}{x==='Chat'&&<span className="count">{chat.length}</span>}</button>)}</nav><div className="panel">{panel==='Output'&&<><div className="output-toolbar">{canDownload&&<button className="download" onClick={downloadFile}>⇩ Download {files[active].name}</button>}</div><pre>{output}</pre></>}{panel==='Input'&&<div className="stdinblock"><p className="hint">This text is sent to the program as keyboard input when you click Run — one value per line.</p><textarea className="stdin" value={stdin} onChange={e=>setStdin(e.target.value)} placeholder={'Enter each program input on its own line, e.g.:\n5\n10\n'}/></div>}{panel==='AI Debugger'&&(ai?<div className="thinking">✦ AI is analyzing the shared code…</div>:aiError?<div><p className="warning">{aiError}</p><p className="empty" style={{marginTop:12}}>Run the code first, then click ✦ AI Fix again.</p></div>:fix?<div className="fix"><strong>✦ AI Fix Suggested</strong><p><b>Root cause:</b> {fixData?.root_cause||'Review required.'}</p>{fixData?.explanation&&<p><b>Explanation:</b> {fixData.explanation}</p>}<p><b>Changes:</b> {(fixData?.changes||[]).join(', ')||'—'}</p><button onClick={applyFix}>Apply Fix</button><button className="ghost" onClick={()=>{setFix(false);setFixData(null)}}>Reject</button></div>:<div className="empty">No issue selected. Run your code or ask AI to review it.</div>)}{panel==='Chat'&&<><div className="messages">{chat.map((c,i)=><p key={i}><b>{c.who}:</b> {c.text}</p>)}</div><form onSubmit={e=>{e.preventDefault();if(message.trim()){sendRoom('chat:message',{who:name,text:message});setMessage('')}}}><input value={message} onChange={e=>setMessage(e.target.value)} placeholder="Type a message…"/><button>↑</button></form></>}{panel==='Activity'&&<div className="activity">{activity.map((a,i)=><p key={i}>{a}</p>)}</div>}{panel==='Errors'&&<div className="empty">No compiler errors.</div>}</div></div></section></main>
 {created&&<div className="toast">✓ Coding room {room} created — ready to share</div>}
 {pending.length>0&&<div className="request"><div><span>JOIN REQUEST</span><h3>{pending[0].name} wants to join</h3><p>{pending[0].device} · requests editor access</p><button onClick={()=>accept(pending[0])}>Accept</button><button className="ghost" onClick={()=>rejectJoin(pending[0])}>Reject</button></div></div>}
 {share&&<div className="modal"><div><button className="close" onClick={()=>setShare(false)}>×</button><h2>Share coding room</h2><p>Invite teammates to request access to <b>{room}</b>.</p>{location.hostname==='localhost'&&<><p className="warning">A phone cannot open <b>localhost</b>. Enter this computer’s LAN address (for example: 192.168.1.2:5173).</p><input value={shareHost} onChange={e=>setShareHost(e.target.value)} placeholder="192.168.1.2:5173"/></>}<div className="qr"><QRCodeSVG value={roomUrl} size={150}/></div><div className="share-link"><input readOnly value={roomUrl}/><button onClick={()=>navigator.clipboard.writeText(roomUrl)}>Copy</button></div></div></div>}
 {askOpen&&<div className="aiask open"><div className="aiask-head"><span className="bill">✦</span><strong>AI Ask</strong><button className="ghost" onClick={()=>setAskOpen(false)}>×</button></div><div className="aiask-body">{askChat.length===0?<div className="empty">Ask any programming question or request a program. If it contains code, you can import it into the shared editor.</div>:askChat.map((m,i)=>{const code=m.role==='assistant'?extractCode(m.text):null;return <div key={i} className={'ask-msg '+m.role}><span className="ask-tag">{m.role==='user'?(name[0]||'Y'):'AI'}</span><div><p>{m.text}</p>{code&&(role==='host'||role==='editor')&&<button className="import" onClick={()=>importCode(code.code,code.label)}>⇩ Import to Code</button>}</div></div>})}{asking&&<div className="ask-msg assistant"><span className="ask-tag">AI</span><p className="thinking">✦ AI is thinking…</p></div>}</div><form className="aiask-form" onSubmit={e=>{e.preventDefault();sendAsk()}}><input value={askMsg} onChange={e=>setAskMsg(e.target.value)} placeholder="Ask anything or write a program…" autoFocus/><button disabled={asking}>↑</button></form></div>}
 {route==='landing'&&!joined&&<div className="modal"><div><span className="eyebrow">CODING ROOM</span><h2>Create a coding room</h2><p>Name yourself, start a room, then share the link so teammates can join from any device.</p><input value={name} onChange={e=>setName(e.target.value)} placeholder="Your name"/>{createError&&<p className="warning">{createError}</p>}<button className="full" onClick={create}>＋ Create Coding Room</button><div className="divider">already have a room?</div><input value={joinCode} onChange={e=>setJoinCode(e.target.value)} placeholder="Room code — e.g. CFX-8A72KD"/><button className="full ghost" onClick={joinByCode}>⇢ Join Room</button></div></div>}
 {route==='guest'&&!joined&&<div className="modal"><div><button className="close" onClick={()=>history.back()}>×</button><span className="eyebrow">JOIN CODING ROOM</span><h2>{room}</h2>{guestStep==='form'&&<><p>Enter your name to request access from the room host.</p><input value={name} onChange={e=>setName(e.target.value)} placeholder="Your name"/>{guestMsg&&<p className="warning">{guestMsg}</p>}<button className="full" onClick={requestJoin}>Request to Join</button></>}{guestStep==='waiting'&&<><p className="warning">⏳ Waiting for the host to approve your request…</p><button className="ghost" onClick={()=>setGuestStep('form')}>Change name</button></>}{guestStep==='rejected'&&<><p className="warning">The join request was not approved. Please try again.</p><button className="full" onClick={()=>setGuestStep('form')}>Try again</button></>}</div></div>}
 </div>
}
createRoot(document.getElementById('root')!).render(<App/>)