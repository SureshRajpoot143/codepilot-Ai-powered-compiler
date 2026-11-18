import React from 'react'

export type FileTab={path:string;name:string;language:string;code:string}

type EditorTabsProps={
 tabs:FileTab[]
 active:number
 presence:{id:string;name:string;activeFile:string}[]
 users:{id:string;name:string;color:string}[]
 onSelect:(index:number)=>void
 onClose:(path:string)=>void
}

const EditorTabs=({tabs,active,presence,users,onSelect,onClose}:EditorTabsProps)=><div className="tabbar">
 {tabs.map((tab,index)=>{
  const editors=presence.filter(p=>p.activeFile===tab.path)
  return <div key={tab.path} className={'tab'+(index===active?' active':'')} onClick={()=>onSelect(index)} title={tab.path}>
   <span className="tab-dots" title={editors.map(e=>e.name).join(', ')}>{editors.slice(0,4).map(editor=>{const user=users.find(u=>u.id===editor.id);return <i key={editor.id} className="dot" style={{background:user?.color||'#7c5cff'}}/>})}</span>
   <span className="tabname">{tab.name}</span><button className="tab-close" title={`Close ${tab.name}`} onClick={event=>{event.stopPropagation();onClose(tab.path)}}>×</button>
  </div>
 })}
 {!tabs.length&&<span className="tab empty">Select a file to start coding</span>}
</div>

export default EditorTabs