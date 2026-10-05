export interface Employment {jobTitle?:string|null;grade?:string|null}
export function EmploymentFields({value,onChange}:{value:Employment;onChange:(value:Employment)=>void}) {
 return <><div className="dialog-field-grid"><label>Business job title<input maxLength={100} value={value.jobTitle??''} onChange={event=>onChange({...value,jobTitle:event.target.value})} aria-describedby="employment-help"/></label><label>Grade<input maxLength={40} value={value.grade??''} onChange={event=>onChange({...value,grade:event.target.value})} aria-describedby="employment-help"/></label></div><p className="access-help" id="employment-help">Optional work information maintained by people administrators. Neither field assigns access or review authority. Leave blank to clear a stored value.</p></>;
}
export function EmploymentSummary({value,loading=false,failed=false}:{value?:Employment;loading?:boolean;failed?:boolean}) {
 const display=(key:keyof Employment)=>loading?'Loading work details...':failed?'Unavailable':!value||value[key]===undefined?'Unavailable':value[key]||'Not assigned';
 return <><dl><div><dt>Business job title</dt><dd>{display('jobTitle')}</dd></div><div><dt>Grade</dt><dd>{display('grade')}</dd></div></dl><p>Maintained by people administrators. Job title and grade describe your work; they do not grant access.</p></>;
}
export function EmploymentChange({before,after}:{before?:Employment|null;after?:Employment}) {
 return <div className="employment-change"><h3>Work information changes</h3><dl>{(['jobTitle','grade'] as const).map(key=><div key={key}><dt>{key==='jobTitle'?'Business job title':'Grade'}</dt><dd><span>{before?.[key]||'Not assigned'}</span><span aria-hidden="true"> → </span><span className="sr-only"> changes to </span><strong>{after?.[key]||'Not assigned'}</strong></dd></div>)}</dl><p className="access-help">Descriptive only. These fields do not change effective access.</p></div>;
}
