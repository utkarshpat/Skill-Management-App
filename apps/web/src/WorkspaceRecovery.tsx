import {Component,type ReactNode} from 'react';

/** A failed lazy module must leave a recoverable page, including during a deployment. */
export class WorkspaceRecovery extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){
    if(this.state.failed)return <main className="session-loading" role="alert"><div><h1>Your workspace couldn’t open</h1><p>A connection problem or an app update may have interrupted loading. Reload to try again.</p><button className="secondary-button" onClick={()=>window.location.reload()}>Reload workspace</button></div></main>;
    return this.props.children;
  }
}
