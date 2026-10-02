import { useMemo, useRef, useState } from 'react';
import { Building2, Users, Pencil, UserRound } from 'lucide-react';

export interface TreeItem { id:string; label:string; detail:string; children:string[]; person?:boolean }
interface Props {items:TreeItem[];roots:string[];selected?:string;onSelect:(id:string)=>void;onEdit:(id:string)=>void}
const width=190,height=78,xGap=65,yGap=22;

export function VisualTree({items,roots,selected,onSelect,onEdit}:Props) {
  const viewport=useRef<HTMLDivElement>(null);
  const [zoom,setZoom]=useState(1);
  const diagram=useMemo(()=>{
    const lookup=new Map(items.map(item=>[item.id,item]));
    const seen=new Set<string>();let row=0;
    const positions:{item:TreeItem;x:number;y:number}[]=[];
    const edges:{from:string;to:string}[]=[];
    function visit(id:string,depth:number):number|undefined {
      const item=lookup.get(id);if(!item||seen.has(id)||depth>200)return undefined;
      seen.add(id);const children:number[]=[];
      for(const child of item.children){const y=visit(child,depth+1);if(y!==undefined){children.push(y);edges.push({from:id,to:child});}}
      const y=children.length?(children[0]+children.at(-1)!)/2:row++*(height+yGap);
      positions.push({item,x:depth*(width+xGap),y});return y;
    }
    for(const root of roots){visit(root,0);row++;}
    return {positions,edges,width:Math.max(width,...positions.map(node=>node.x+width))+40,height:Math.max(height,...positions.map(node=>node.y+height))+40};
  },[items,roots]);
  return <><div className="tree-zoom-controls" role="group" aria-label="Tree zoom"><button type="button" onClick={()=>setZoom(value=>Math.max(.25,value-.25))} disabled={zoom<=.25} aria-label="Zoom out tree">−</button><span>{Math.round(zoom*100)}%</span><button type="button" onClick={()=>setZoom(value=>Math.min(1.5,value+.25))} disabled={zoom>=1.5} aria-label="Zoom in tree">+</button><button type="button" onClick={()=>{const element=viewport.current;if(element){setZoom(Math.max(.25,Math.min(1,(element.clientWidth-24)/diagram.width,(460-24)/diagram.height)));element.scrollTo(0,0);}}}>Fit tree</button><button type="button" onClick={()=>setZoom(1)}>Reset</button></div><div ref={viewport} className="visual-tree-scroll" tabIndex={0} aria-label="Visual tree. Scroll to explore branches."><div style={{width:diagram.width*zoom,height:diagram.height*zoom}}><div className="visual-tree-canvas" style={{width:diagram.width,height:diagram.height,transform:`scale(${zoom})`,transformOrigin:'top left'}}>
    <svg width={diagram.width} height={diagram.height} aria-hidden="true">{diagram.edges.map(edge=>{
      const from=diagram.positions.find(node=>node.item.id===edge.from)!,to=diagram.positions.find(node=>node.item.id===edge.to)!;
      const x1=from.x+width,y1=from.y+height/2,x2=to.x,y2=to.y+height/2,middle=x1+xGap/2;
      return <path key={edge.from+edge.to} d={`M ${x1} ${y1} H ${middle} V ${y2} H ${x2}`} fill="none" stroke="#c9ced7" strokeWidth="1.5"/>;
    })}</svg>
    {diagram.positions.map(({item,x,y})=>{const Icon=item.person?UserRound:item.children.length?Building2:Users;return <div key={item.id} className={`visual-node ${selected===item.id?'selected':''}`} style={{left:x,top:y,width,height}}>
      <button className="visual-node-select" onClick={()=>onSelect(item.id)} aria-pressed={selected===item.id}><Icon size={18} aria-hidden="true"/><span><strong>{item.label}</strong><small>{item.detail}</small></span></button>
      {selected===item.id&&<button className="visual-node-edit" aria-label={`${item.person?'Edit roles for':'Edit'} ${item.label}`} onClick={()=>onEdit(item.id)}><Pencil size={13}/>{item.person?'Edit roles':'Edit'}</button>}
    </div>;})}
  </div></div>{!diagram.positions.length&&<p>No matching nodes.</p>}</div></>;
}
