import { useState } from 'react';
import { Search, Pencil, Users, ShieldCheck, ChevronLeft, ChevronRight } from 'lucide-react';

interface Role { id:string; name:string; permissions:unknown[] }
interface Person { id:string; displayName:string; employeeCode:string; active:boolean; roleIds:string[] }
export function AccessDirectory({kind,people,roles,onPerson,onRole,busy}:{kind:'people'|'roles';people:Person[];roles:Role[];onPerson:(id:string)=>void;onRole:(id:string)=>void;busy:boolean}) {
  const [search,setSearch]=useState(''),[page,setPage]=useState(1),[status,setStatus]=useState('');
  const query=search.trim().toLocaleLowerCase();
  const rows=kind==='people'
    ?people.filter(item=>(item.displayName+' '+item.employeeCode+' '+roles.filter(role=>item.roleIds.includes(role.id)).map(role=>role.name).join(' ')).toLocaleLowerCase().includes(query)&&(!status||(status==='active')===item.active))
    :roles.filter(item=>item.name.toLocaleLowerCase().includes(query));
  const pages=Math.max(1,Math.ceil(rows.length/10)),current=Math.min(page,pages),shown=rows.slice((current-1)*10,current*10);
  return <section className="profile-panel directory-panel" aria-label={kind==='people'?'People directory':'Roles directory'}>
    <div className="directory-toolbar">
      <label className="list-search"><Search size={18} aria-hidden="true"/><input aria-label={kind==='people'?'Search people':'Search roles'} placeholder={kind==='people'?'Search name, employee ID or role…':'Search roles…'} value={search} maxLength={100} onChange={event=>{setSearch(event.target.value);setPage(1);}}/></label>
      {kind==='people'&&<select aria-label="Filter account status" value={status} onChange={event=>{setStatus(event.target.value);setPage(1);}}><option value="">All accounts</option><option value="active">Active</option><option value="suspended">Suspended</option></select>}
      <span className="directory-count">{rows.length} {kind}</span>
    </div>
    <div className="audit-scroll directory-scroll" tabIndex={0} aria-label={kind+' table'}><table><thead><tr>{(kind==='people'?['Person','Employee ID','Assigned roles','Status','Action']:['Role','Permissions','Assigned people','Action']).map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>
      {shown.map(item=>kind==='people'&&'displayName' in item?<tr key={item.id}>
        <th scope="row"><div className="directory-identity"><span className="directory-avatar" aria-hidden="true">{item.displayName.trim().split(/\s+/).slice(0,2).map(part=>part[0]).join('')}</span><strong>{item.displayName}</strong></div></th>
        <td className="directory-code">{item.employeeCode}</td><td><div className="directory-tags">{item.roleIds.length?item.roleIds.map(id=><span key={id}>{roles.find(role=>role.id===id)?.name??'Unlisted role'}</span>):<span className="directory-unassigned">No roles assigned</span>}</div></td>
        <td><span className={'directory-status '+(item.active?'active':'suspended')}>{item.active?'Active':'Suspended'}</span></td>
        <td><button className="directory-edit" disabled={busy} aria-label={'Edit '+item.displayName} onClick={()=>onPerson(item.id)}><Pencil size={15}/>Edit</button></td>
      </tr>:'permissions' in item?<tr key={item.id}>
        <th scope="row"><div className="directory-identity"><span className="directory-avatar" aria-hidden="true"><ShieldCheck size={19}/></span><strong>{item.name}</strong></div></th>
        <td>{item.permissions.length} assignments</td><td>{people.filter(person=>person.roleIds.includes(item.id)).length} people</td>
        <td><button className="directory-edit" disabled={busy} aria-label={'Edit '+item.name} onClick={()=>onRole(item.id)}><Pencil size={15}/>Edit</button></td>
      </tr>:null)}
    </tbody></table></div>
    {!rows.length&&<div className="directory-empty">{kind==='people'?<Users size={28}/>:<ShieldCheck size={28}/>}<h3>{search||status?'No matching '+kind:'No '+kind+' yet'}</h3><p>{search||status?'Try another search or clear the filters.':'Use the action in the navbar to create your first entry.'}</p>{(search||status)&&<button className="secondary-button" onClick={()=>{setSearch('');setStatus('');setPage(1);}}>Clear filters</button>}</div>}
    <div className="directory-pagination"><span>{rows.length?`${(current-1)*10+1}–${Math.min(current*10,rows.length)} of ${rows.length}`:'0 results'}</span><div><button aria-label={'Previous '+kind+' page'} disabled={current===1} onClick={()=>setPage(current-1)}><ChevronLeft size={17}/></button><span>Page {current} of {pages}</span><button aria-label={'Next '+kind+' page'} disabled={current===pages} onClick={()=>setPage(current+1)}><ChevronRight size={17}/></button></div></div>
  </section>;
}
