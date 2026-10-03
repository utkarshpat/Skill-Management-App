import { lazy, Suspense } from 'react';
const Markdown=lazy(()=>import('./AssistantMarkdown'));
export function AssistantRichText({children}:{children:string}) {
  return <Suspense fallback={<div className="assistant-markdown">{children}</div>}><Markdown>{children}</Markdown></Suspense>;
}
