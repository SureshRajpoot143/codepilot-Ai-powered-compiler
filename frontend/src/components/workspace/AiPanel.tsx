import React from 'react'

type AiPanelProps={open:boolean;onClose:()=>void;children:React.ReactNode}

const AiPanel=({open,onClose,children}:AiPanelProps)=><aside className={'ai-workspace'+(open?' open':'')} aria-label="AI coding assistant">
 <div className="ai-workspace-head"><span className="bill">✦</span><strong>CodePilot AI</strong><button className="ghost" title="Close AI panel" onClick={onClose}>×</button></div>
 <div className="ai-workspace-body">{children}</div>
</aside>

export default AiPanel