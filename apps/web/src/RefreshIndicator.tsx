import type {RefreshStatus} from './activity-refresh';
export function RefreshIndicator({status}:{status?:RefreshStatus}){
 if(!status)return null;
 const checked=status.checkedAt===null?'Not checked yet':`Updated ${new Date(status.checkedAt).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}`;
 const mode={live:'Auto-refresh while active',idle:'Paused while idle',hidden:'Paused in background',retrying:'Refresh delayed; retry available'}[status.mode];
 return <small className="refresh-indicator" role="status">{checked} · {mode}</small>;
}
