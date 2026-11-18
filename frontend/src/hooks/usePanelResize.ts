import {useCallback,useEffect,useRef,useState,type PointerEvent as ReactPointerEvent} from 'react'

type Direction='horizontal'|'vertical'
type Bounds={min:number;max:number}

export const usePanelResize=(initial:number,bounds:Bounds,direction:Direction='vertical')=>{
 const [size,setSize]=useState(initial)
 const dragging=useRef(false)

 const onPointerDown=useCallback((event:ReactPointerEvent<HTMLButtonElement>)=>{
  event.preventDefault()
  const start=direction==='vertical'?event.clientY:event.clientX
  const origin=size
  dragging.current=true
  event.currentTarget.setPointerCapture(event.pointerId)

  const move=(moveEvent:globalThis.PointerEvent)=>{
   const current=direction==='vertical'?moveEvent.clientY:moveEvent.clientX
   const delta=current-start
   const next=Math.min(bounds.max,Math.max(bounds.min,origin+(direction==='vertical'?-delta:delta)))
   setSize(next)
  }
  const up=()=>{dragging.current=false;window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up)}
  window.addEventListener('pointermove',move)
  window.addEventListener('pointerup',up,{once:true})
 },[bounds.max,bounds.min,direction,size])

 useEffect(()=>()=>{dragging.current=false},[])

 return {size,setSize,resizeHandleProps:{onPointerDown,label:direction==='vertical'?'Resize terminal height':'Resize AI panel width'}}
}
