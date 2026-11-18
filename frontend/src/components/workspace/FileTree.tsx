import React from 'react'

export type TreeNode={path:string;name:string;parent:string;isDir:boolean;language:string}

type FileTreeProps={
 nodes:TreeNode[]
 canEdit:boolean
 renderNode:(parent:string,depth:number)=>React.ReactNode
 onNewFile:()=>void
 onNewFolder:()=>void
 emptyMessage:string
 children?:React.ReactNode
}

 const FileTree=({nodes,canEdit,renderNode,onNewFile,onNewFolder,emptyMessage,children}:FileTreeProps)=>{
 const empty=!nodes.length
 return <section className="files ide-card">
  <div className="files-head"><small>WORKSPACE</small><span className="files-tools">{canEdit&&<><button title="New file" onClick={onNewFile}>＋ file</button><button title="New folder" onClick={onNewFolder}>＋ folder</button></>}</span></div>
  {children}
  <div className="tree">{empty?<p className="empty small">{emptyMessage}</p>:renderNode('',0)}</div>
 </section>
}

export default FileTree
