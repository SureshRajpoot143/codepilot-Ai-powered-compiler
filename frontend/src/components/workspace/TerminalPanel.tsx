import React from 'react'

export const panelNames=['Output','Errors','Input','AI Debugger','Chat','Activity'] as const
export type PanelName=typeof panelNames[number]

type TerminalPanelProps={
 panel:PanelName
 onPanel:(panel:PanelName)=>void
 onClear:()=>void
 chatCount:number
 children:React.ReactNode
}

const TerminalPanel=({panel,onPanel,onClear,chatCount,children}:TerminalPanelProps)=><section className="bottom ide-card" aria-label="Workspace terminal and diagnostics">
 <div className="terminal-head"><nav>{panelNames.map(name=><button className={panel===name?'active':''} onClick={()=>onPanel(name)} key={name}>{name}{name==='Chat'&&<span className="count">{chatCount}</span>}</button>)}</nav><button className="terminal-clear" title="Clear current panel" onClick={onClear}>Clear</button></div>
 <div className="panel">{children}</div>
</section>

export default TerminalPanel
