export interface AssistantPage {label:string;url:string}
export function canonicalAssistantDestination(input:string):string|undefined {
 if(input==='/')return '/profile';
 if(input==='/access')return '/access?view=overview';
 if(['/workspace','/profile','/my-skills','/skills'].includes(input))return input;
 return /^\/access\?view=(overview|people|roles|assignments|organization|skills|audit)$/.test(input)?input:undefined;
}
export function assistantNavigationTargets(content:string,sources:{url:string}[],pages:AssistantPage[]){
 const requested=[...sources.map(source=>source.url),...[...content.matchAll(/\[[^\]\n]+\]\(([^\s)]+)\)/g)].map(match=>match[1])];
 const urls=new Set(requested.map(canonicalAssistantDestination).filter(Boolean));
 return pages.filter(page=>urls.has(page.url));
}
