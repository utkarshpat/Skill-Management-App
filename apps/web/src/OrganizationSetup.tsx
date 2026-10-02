import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Building2, ChevronRight, Plus, Search, GitBranch, Check, FolderTree } from 'lucide-react';
import { authenticatedFetch } from './auth';
import { VisualTree, type TreeItem } from './VisualTree';

type Kind='DELIVERY_UNIT'|'DEPARTMENT'|'TEAM';
interface OrgNode {id:string;kind:Kind;name:string;parentId:string|null;active:boolean}
interface Person {id:string;displayName:string;employeeCode:string;active:boolean}
interface Assignment {personId:string;teamId:string|null;departmentId:string|null;managerId:string|null}
interface State {revision:number;nodes:OrgNode[];assignments:Assignment[];people:Person[]}
const labels:Record<Kind,string>={DELIVERY_UNIT:'Delivery unit',DEPARTMENT:'Department',TEAM:'Team'};
const blank=(kind:Kind='DELIVERY_UNIT',parentId:string|null=null)=>({id:'',kind,name:'',parentId,active:true});
const endpoint='/api/access/organization';

export function OrganizationSetup({actionsContainer,onChanged,onEditPerson,onAssignDepartment,roleNames}:{actionsContainer:HTMLElement|null;onChanged:()=>void;onEditPerson:(id:string)=>void;onAssignDepartment:(id:string)=>void;roleNames:Record<string,string[]>}) {
  const editor=useRef<HTMLDivElement>(null);
  const [state,setState]=useState<State>();
  const [mode,setMode]=useState<'organization'|'reporting'>('organization');
  const [expanded,setExpanded]=useState<Set<string>>(new Set());
  const [search,setSearch]=useState('');const [archived,setArchived]=useState(false);
  const [selected,setSelected]=useState<string>();const [form,setForm]=useState(blank());
  const [personId,setPersonId]=useState('');const [placementId,setPlacementId]=useState('');const [managerId,setManagerId]=useState('');
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');
  async function read(signal?:AbortSignal) {
    const response=await authenticatedFetch(endpoint,{signal});
    if(!response.ok)throw new Error(response.status===403?'Organization setup requires people administration permission.':'Organization could not be loaded. Please try again.');
    const result:State=await response.json();setState(result);return result;
  }
  useEffect(()=>{const controller=new AbortController();read(controller.signal).then(result=>setExpanded(new Set(result.nodes.map(node=>node.id)))).catch(err=>{if(!controller.signal.aborted)setError(err.message);});return()=>controller.abort();},[]);
  async function save(value:object) {
    if(!state||busy)return;
    setBusy(true);setError('');setNotice('');
    try {
      const response=await authenticatedFetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...value,revision:state.revision})});
      if(!response.ok){const body=await response.json().catch(()=>undefined);throw new Error(body?.error?.message??'The change could not be saved.');}
      const fresh=await read();setNotice('Saved. Organization and reporting details are up to date.');onChanged();
      if('kind' in value&&value.kind==='node') {
        const node=fresh.nodes.find(node=>node.kind===form.kind&&node.parentId===form.parentId&&node.name===form.name.trim());
        if(node){setForm(node);setSelected(node.id);setExpanded(new Set(fresh.nodes.map(item=>item.id)));}
      }
    }catch(err){setError(err instanceof Error?err.message:'Could not save.');}finally{setBusy(false);}
  }
  function choose(node:OrgNode){setSelected(node.id);setForm({...node});setNotice('');}
  function add(kind:Kind,parentId:string|null=null){setSelected(undefined);setForm(blank(kind,parentId));setNotice('');}
  function selectPerson(id:string){setPersonId(id);const assignment=state?.assignments.find(item=>item.personId===id);setPlacementId(assignment?.teamId??assignment?.departmentId??'');setManagerId(assignment?.managerId??'');setExpanded(current=>new Set([...current,id,...lineage(id).map(person=>person.id)]));setNotice('');}
  function lineage(id:string):Person[] {
    if(!state)return [];
    const result:Person[]=[];const seen=new Set([id]);let cursor=id;
    while(result.length<200){const next=state.assignments.find(item=>item.personId===cursor)?.managerId;if(!next||seen.has(next))break;const person=state.people.find(item=>item.id===next);if(!person)break;seen.add(next);result.push(person);cursor=next;}
    return result;
  }
  if(!state)return <section className="profile-panel" aria-live="polite">{error?<><p role="alert">{error}</p><button className="secondary-button" onClick={()=>{setError('');read().catch(err=>setError(err.message));}}>Retry</button></>:<p>Loading your organization…</p>}</section>;
  const query=search.trim().toLowerCase();
  const visible=state.nodes.filter(node=>archived||node.active);
  const matches=(node:OrgNode):boolean=>node.name.toLowerCase().includes(query)||visible.filter(child=>child.parentId===node.id).some(matches);
  const teamPath=(id:string)=>{const names:string[]=[];let node=state.nodes.find(item=>item.id===id);const seen=new Set<string>();while(node&&!seen.has(node.id)){seen.add(node.id);names.unshift(node.name);node=state.nodes.find(item=>item.id===node?.parentId);}return names.join(' / ');};
  const activePeople=state.people.filter(person=>person.active);
  const direct=state.assignments.filter(item=>(item.teamId===selected||item.departmentId===selected)).map(item=>state.people.find(person=>person.id===item.personId)).filter((person):person is Person=>Boolean(person));
  const descendants=(id:string):number=>state.nodes.filter(node=>node.parentId===id&&node.active).reduce((count,node)=>count+1+descendants(node.id),0);
  const reports=(id:string)=>state.assignments.filter(item=>item.managerId===id).map(item=>state.people.find(person=>person.id===item.personId)).filter((person):person is Person=>Boolean(person));
  const personMatches=(person:Person,seen=new Set<string>()):boolean=>{if(seen.has(person.id))return false;seen.add(person.id);return `${person.displayName} ${person.employeeCode}`.toLowerCase().includes(query)||reports(person.id).some(child=>personMatches(child,new Set(seen)));};
  const graphItems:TreeItem[]=mode==='organization'?visible.filter(matches).map(node=>({id:node.id,label:node.name,detail:labels[node.kind],children:(!query&&!expanded.has(node.id))?[]:[...visible.filter(child=>child.parentId===node.id).filter(matches).map(child=>child.id),...state.assignments.filter(item=>item.teamId===node.id||item.departmentId===node.id).map(item=>item.personId)]})):state.people.filter(person=>personMatches(person)).map(person=>({id:person.id,label:person.displayName,detail:roleNames[person.id]?.join(', ')||person.employeeCode,person:true,children:(!query&&!expanded.has(person.id))?[]:reports(person.id).filter(child=>personMatches(child)).map(child=>child.id)}));
  if(mode==='organization')for(const person of state.people.filter(person=>state.assignments.some(item=>item.personId===person.id&&(item.departmentId||item.teamId))))graphItems.push({id:person.id,label:person.displayName,detail:roleNames[person.id]?.join(', ')||person.employeeCode,person:true,children:[]});
  const roots=mode==='organization'?visible.filter(node=>!node.parentId).filter(matches).map(node=>node.id):state.people.filter(person=>!state.assignments.find(item=>item.personId===person.id)?.managerId).filter(person=>personMatches(person)).map(person=>person.id);
  const selectGraph=(id:string)=>{const node=state.nodes.find(item=>item.id===id);if(node)choose(node);else{setMode('reporting');selectPerson(id);}};
  const editGraph=(id:string)=>{if(state.people.some(person=>person.id===id))onEditPerson(id);else {selectGraph(id);requestAnimationFrame(()=>editor.current?.scrollIntoView({block:'start'}));}};
  const chain=personId?lineage(personId):[];
  return <div className="organization-setup">
    {actionsContainer&&createPortal(<div className="org-toolbar"><div className="org-view-switch" role="group" aria-label="Hierarchy view"><button aria-pressed={mode==='organization'} onClick={()=>setMode('organization')}><FolderTree size={17}/>Organization</button><button aria-pressed={mode==='reporting'} onClick={()=>{setMode('reporting');setExpanded(current=>new Set([...current,...state.people.map(person=>person.id)]));}}><GitBranch size={17}/>Reporting lines</button></div>{mode==='organization'&&<button className="admin-primary" disabled={busy} onClick={()=>{add('DELIVERY_UNIT');requestAnimationFrame(()=>document.querySelector<HTMLInputElement>('#organization-editor input')?.focus());}}><Plus size={17}/>Add delivery unit</button>}</div>,actionsContainer)}
    {error&&<div className="access-message" role="alert">{error}<button className="secondary-button" onClick={()=>read().then(()=>setError('')).catch(err=>setError(err.message))}>Reload organization</button></div>}{notice&&<p className="org-success" role="status"><Check size={17}/>{notice}</p>}
    <div className="org-layout visual-layout"><section className="profile-panel org-tree-panel"><div className="panel-title"><div><h2>{mode==='organization'?'Organization tree':'Reporting tree'}</h2><p>{mode==='organization'?'Select a department or delivery unit.':'Select a person to view their reporting line.'}</p></div></div><label className="org-search"><Search size={17}/><input aria-label="Search hierarchy" placeholder={mode==='organization'?'Find a unit, department or team':'Find a person or employee ID'} value={search} onChange={event=>setSearch(event.target.value)}/></label><div className="org-tree-tools"><button onClick={()=>setExpanded(new Set([...state.nodes.map(node=>node.id),...state.people.map(person=>person.id)]))}>Expand all</button><button onClick={()=>setExpanded(new Set())}>Collapse all</button>{mode==='organization'&&<label><input type="checkbox" checked={archived} onChange={event=>setArchived(event.target.checked)}/>Show archived</label>}</div>
      <VisualTree items={graphItems} roots={roots} selected={mode==='organization'?selected:personId} onSelect={selectGraph} onEdit={editGraph}/>
    </section>
    <div className="org-detail-column" ref={editor}>{mode==='organization'?<>
      <form id="organization-editor" className="profile-panel access-form org-node-form" onSubmit={event=>{event.preventDefault();void save({kind:'node',type:form.kind,id:form.id||undefined,name:form.name,parentId:form.parentId,active:form.active});}}><div className="org-detail-heading"><span className="org-node-icon"><Building2 size={22}/></span><div><h2>{form.id?form.name:`Create ${labels[form.kind].toLowerCase()}`}</h2></div></div><label>Level<select disabled={Boolean(form.id)} value={form.kind} onChange={event=>add(event.target.value as Kind)}>{Object.entries(labels).map(([kind,label])=><option key={kind} value={kind}>{label}</option>)}</select></label><label>{labels[form.kind]} name<input required maxLength={100} placeholder={`Enter ${labels[form.kind].toLowerCase()} name`} value={form.name} onChange={event=>setForm({...form,name:event.target.value})}/></label>{form.kind!=='DELIVERY_UNIT'&&<label>Parent {form.kind==='TEAM'?'department':'delivery unit'}<select required value={form.parentId??''} onChange={event=>setForm({...form,parentId:event.target.value||null})}><option value="">Choose parent</option>{state.nodes.filter(node=>node.active&&node.kind===(form.kind==='TEAM'?'DEPARTMENT':'DELIVERY_UNIT')).map(node=><option key={node.id} value={node.id}>{node.name}{node.parentId?` · ${state.nodes.find(parent=>parent.id===node.parentId)?.name??''}`:''}</option>)}</select></label>}<label className="access-check"><input type="checkbox" checked={form.active} onChange={event=>setForm({...form,active:event.target.checked})}/>Active branch</label>{form.id&&<div className="org-selected-actions">{form.kind==='DEPARTMENT'&&<button type="button" className="secondary-button" onClick={()=>onAssignDepartment(form.id)}>Assign roles</button>}<span>{form.kind==='TEAM'?`${direct.length} people assigned`:`${descendants(form.id)} active branches below · ${direct.length} people directly assigned`}</span>{form.kind!=='TEAM'&&<button className="secondary-button" type="button" onClick={()=>add(form.kind==='DELIVERY_UNIT'?'DEPARTMENT':'TEAM',form.id)}><Plus size={15}/>Add {form.kind==='DELIVERY_UNIT'?'department':'team'}</button>}</div>}<button className="microsoft-button" disabled={busy}>{busy?'Saving…':form.id?'Save branch':'Create branch'}</button></form>
      {selected&&form.kind!=='DELIVERY_UNIT'&&<section className="profile-panel"><h2>People directly in this {labels[form.kind].toLowerCase()}</h2>{direct.length?<ul className="org-team-people">{direct.map(person=><li key={person.id}><button onClick={()=>{setMode('reporting');selectPerson(person.id);}}><strong>{person.displayName}</strong><span>{person.employeeCode}<ChevronRight size={15}/></span></button></li>)}</ul>:<p>No people assigned yet.</p>}<button className="secondary-button" onClick={()=>{setMode('reporting');setPlacementId(selected);setPersonId('');setManagerId('');}}>Assign a person</button></section>}
    </>:<form id="reporting-editor" className="profile-panel access-form" onSubmit={event=>{event.preventDefault();void save({kind:'assignment',personId,teamId:state.nodes.find(node=>node.id===placementId)?.kind==='TEAM'?placementId:null,departmentId:state.nodes.find(node=>node.id===placementId)?.kind==='DEPARTMENT'?placementId:null,managerId:managerId||null});}}><div className="org-detail-heading"><span className="org-node-icon"><GitBranch size={22}/></span><div><h2>Reporting & membership</h2>{personId&&<button type="button" className="secondary-button" onClick={()=>onEditPerson(personId)}>Edit roles</button>}</div></div><label>Person<select required value={personId} onChange={event=>selectPerson(event.target.value)}><option value="">Choose a person</option>{activePeople.map(person=><option key={person.id} value={person.id}>{person.displayName} · {person.employeeCode}</option>)}</select></label><label>Department or team<select value={placementId} onChange={event=>setPlacementId(event.target.value)}><option value="">No department or team assigned</option>{state.nodes.filter(node=>node.kind!=='DELIVERY_UNIT'&&node.active).map(node=><option key={node.id} value={node.id}>{teamPath(node.id)} · {labels[node.kind]}</option>)}</select></label><label>Direct reporting manager<select value={managerId} onChange={event=>setManagerId(event.target.value)}><option value="">No reporting manager</option>{activePeople.filter(person=>person.id!==personId&&!lineage(person.id).some(manager=>manager.id===personId)).map(person=><option key={person.id} value={person.id}>{person.displayName} · {person.employeeCode}</option>)}</select></label><p className="access-help">Choose the person they report to directly. Higher reporting levels follow that manager’s own reporting line.</p><button className="microsoft-button" disabled={busy||!personId}>{busy?'Saving…':'Save assignment'}</button>{personId&&<section className="org-chain"><h3>Saved reporting chain</h3><p>{state.people.find(person=>person.id===personId)?.displayName}</p>{chain.length?<ol>{chain.map((person,index)=><li key={person.id}><span>Reporting level {index+1}</span><strong>{person.displayName}</strong><small>{person.active?person.employeeCode:'Suspended — review required'}</small></li>)}</ol>:<p className="access-help">No reporting manager assigned.</p>}</section>}</form>}</div></div>
  </div>;
}
