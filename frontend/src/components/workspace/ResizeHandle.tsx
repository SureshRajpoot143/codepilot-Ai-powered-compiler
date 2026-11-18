import React from 'react'

type ResizeHandleProps={onPointerDown:React.PointerEventHandler<HTMLButtonElement>;label:string}

const ResizeHandle=({onPointerDown,label}:ResizeHandleProps)=><button className="resize-handle" title={label} aria-label={label} onPointerDown={onPointerDown}><span/><span/></button>

export default ResizeHandle