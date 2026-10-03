import {Component,lazy,Suspense,type ReactNode} from 'react';
const Markdown=lazy(()=>import('./AssistantMarkdown'));
// An expired deployment chunk must not unmount the employee workspace.
// Text stays readable and action authorization remains outside this renderer.
class RichTextBoundary extends Component<{children:ReactNode;text:string},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){return this.state.failed?<div className="assistant-markdown" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{this.props.text}</div>:this.props.children;}
}
export function AssistantRichText({children}:{children:string}) {
 return <RichTextBoundary text={children}><Suspense fallback={<div className="assistant-markdown" style={{whiteSpace:'pre-wrap'}}>{children}</div>}><Markdown>{children}</Markdown></Suspense></RichTextBoundary>;
}
