export function skillDateError(value:string|null|undefined,at=new Date()):string {
 if(value===null||value===undefined||value==='')return '';
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'0001-01-01')return 'Choose a valid last-used date or leave it blank.';
 const parsed=new Date(value+'T00:00:00Z');
 if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)return 'Choose a real calendar date for last used.';
 if(value>at.toISOString().slice(0,10))return 'Last used cannot be after today (UTC).';
 return '';
}

export function formatSkillDate(value:string|null|undefined):string {
 if(!value)return 'Not provided';
 return new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T00:00:00Z'));
}
