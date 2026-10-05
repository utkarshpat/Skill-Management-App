export type ToastKind='success'|'error'|'info';
export function notify(message:string,kind:ToastKind='info'){
 if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('app-toast',{detail:{message:message.slice(0,240),kind}}));
}
export async function notifyResponse(path:string,method:string,response:Response){
 if(!response.ok){const body=await response.clone().json().catch(()=>undefined);notify(typeof body?.error?.message==='string'?body.error.message:response.status===403?'This action is unavailable with your current access.':'Could not finish. Please try again.','error');}
 else if(['POST','PUT','PATCH','DELETE'].includes(method)&&!/^\/api\/(ai|assistant|knowledge-transfer|dev-login)(\/|$)/.test(path)&&!/(?:\/preview|\/planner)(?:[/?]|$)/.test(path))notify(path.includes('/submit')?'Submitted for review.':path.includes('/decision')?'Review saved.':path.includes('/evidence')?'Evidence image uploaded.':'Changes saved.','success');
}
