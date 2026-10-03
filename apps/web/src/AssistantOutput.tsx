import { useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { AssistantRichText } from './AssistantRichText';
export interface Artifact {
  kind:'task_draft'|'skill_draft'|'practice_quiz';title:string;summary:string;body:string;steps:string[];
  questions:{prompt:string;options:string[];correctIndex:number;explanation:string}[];
}
export function AssistantOutput({artifact,onReview,onDocument}:{artifact:Artifact;onReview?:()=>void;onDocument?:(content:string)=>void}) {
  const navigate=useNavigate(),id=useId();
  const [page,setPage]=useState(0),[answers,setAnswers]=useState<Record<number,number>>({}),[finished,setFinished]=useState(false),[copied,setCopied]=useState(false),[copyError,setCopyError]=useState(false);
  const [body,setBody]=useState(artifact.body),[editing,setEditing]=useState(false);
  const quiz=artifact.kind==='practice_quiz',question=artifact.questions[page];
  const score=artifact.questions.filter((q,index)=>answers[index]===q.correctIndex).length;
  return <section className="assistant-artifact" aria-label={artifact.title}>
    <small>{quiz?'Learning · Practice test':artifact.kind==='skill_draft'?'Skill draft · Not saved':'Task draft · Not scheduled'}</small><h3>{artifact.title}</h3>
    {quiz?<>
      {finished?<><p role="status">Practice score: <strong>{score} / {artifact.questions.length}</strong></p><p>This attempt is not saved to your learning history and does not verify a skill.</p><button className="secondary-button" onClick={()=>{setFinished(false);setAnswers({});setPage(0);}}>Try again</button></>:<p>Question {page+1} of {artifact.questions.length} · {Object.keys(answers).length} answered</p>}
      <fieldset><legend>{question.prompt}</legend>{question.options.map((option,index)=><label className="assistant-quiz-option" key={index}><input type="radio" name={`${id}-quiz-${page}`} checked={answers[page]===index} disabled={finished} onChange={()=>setAnswers(current=>({...current,[page]:index}))}/><span>{option}</span></label>)}</fieldset>
      {finished&&<div className="quiz-explanation"><strong>{answers[page]===question.correctIndex?'Correct':'Review this question'}</strong><p>Answer: {question.options[question.correctIndex]}</p><p>{question.explanation}</p></div>}
      <div className="assistant-output-actions"><button className="secondary-button" disabled={page===0} onClick={()=>setPage(page-1)}>Previous</button>{page<artifact.questions.length-1?<button className="secondary-button" onClick={()=>setPage(page+1)}>Next</button>:!finished&&<button className="admin-primary" disabled={Object.keys(answers).length!==artifact.questions.length} onClick={()=>setFinished(true)}>Check answers</button>}</div>
    </>:<>
      {artifact.body&&<>{editing?<textarea className="assistant-draft-text" aria-label="Draft text" value={body} onChange={event=>{setBody(event.target.value);setCopied(false);}} rows={5} maxLength={2000}/>:<AssistantRichText>{body}</AssistantRichText>}<button className="assistant-document-button" onClick={()=>setEditing(!editing)}>{editing?'Preview draft':'Edit draft'}</button></>}
      {artifact.steps.length>0&&<AssistantRichText>{artifact.steps.map((step,index)=>`${index+1}. ${step}`).join('\n')}</AssistantRichText>}
      {onDocument&&<button className="assistant-document-button" onClick={()=>onDocument(`# ${artifact.title}\n\n${body}\n\n${artifact.steps.map((step,index)=>`${index+1}. ${step}`).join('\n')}`)}>Open draft document</button>}
      {artifact.kind==='skill_draft'&&<button className="admin-primary" onClick={()=>{navigate('/my-skills',{state:{aiDraft:{description:body}}});onReview?.();}}>Review in My Skills</button>}
      <button className="secondary-button" onClick={async()=>{try{await navigator.clipboard.writeText([artifact.title,body,...artifact.steps].filter(Boolean).join('\n'));setCopied(true);setCopyError(false);}catch{setCopyError(true);}}}>{copied?'Copied':'Copy draft'}</button>
      {copyError&&<p role="alert">Copy is unavailable. Select and copy the draft text.</p>}<p>Review this suggestion before using it. No records have been changed.</p>
    </>}
  </section>;
}
