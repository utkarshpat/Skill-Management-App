import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link } from 'react-router';

// Model-authored links never fetch external resources or navigate to an arbitrary
// endpoint. Actual sources remain separate links returned by authorized tools.
export function assistantUrl(url:string):string {
  if(!/^\/(?!\/)/.test(url)||url.includes('\\'))return '';
  try{const parsed=new URL(url,'https://workspace.invalid');return ['/workspace','/profile','/my-skills','/skills','/access'].includes(parsed.pathname)&&parsed.origin==='https://workspace.invalid'?parsed.pathname+parsed.search+parsed.hash:'';}catch{return '';}
}
export default function AssistantMarkdown({children}:{children:string}) {
  return <div className="assistant-markdown"><Markdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={['img']} urlTransform={assistantUrl} components={{
    a:({href,children})=>href?<Link to={href}>{children}</Link>:<span>{children}</span>,
    h1:({children})=><h2>{children}</h2>,
    table:({children})=><div className="assistant-table-scroll" tabIndex={0} role="region" aria-label="Response table"><table>{children}</table></div>,
  }}>{children}</Markdown></div>;
}
