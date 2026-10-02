import { AccessError } from '../../shared/errors.js';
import type { ToolDefinition } from './tool-registry.js';

export interface Presentation {
  kind: 'task_draft' | 'skill_draft' | 'practice_quiz';
  title: string; summary: string; body: string; steps: string[];
  questions: { prompt: string; options: string[]; correctIndex: number; explanation: string }[];
}
export const presentationTool: ToolDefinition = { type: 'function', function: {
  name: 'present_output', description: 'Display a draft or exactly ten multiple-choice practice questions. This only renders a card; it NEVER saves, executes, verifies, schedules or approves anything. Use empty questions for drafts; empty body/steps for quizzes. Ask for missing personal facts rather than inventing experience.',
  parameters: { type: 'object', additionalProperties: false, required: ['kind','title','summary','body','steps','questions'], properties: {
    kind: { type:'string', enum:['task_draft','skill_draft','practice_quiz'] }, title:{type:'string'}, summary:{type:'string'}, body:{type:'string'},
    steps:{type:'array',items:{type:'string'}}, questions:{type:'array',items:{type:'object',additionalProperties:false,required:['prompt','options','correctIndex','explanation'],properties:{prompt:{type:'string'},options:{type:'array',items:{type:'string'}},correctIndex:{type:'integer'},explanation:{type:'string'}}}},
  } },
} };
function invalid(): never { throw new AccessError(502,'The generated card was incomplete. Please ask the assistant to try again.'); }
function record(value: unknown, keys: string[]): Record<string,unknown> {
  if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(key=>!keys.includes(key)) || keys.some(key=>!(key in value))) invalid();
  return value as Record<string,unknown>;
}
function text(value: unknown, max: number, empty=false): string {
  if(typeof value!=='string' || value.length>max || (!empty&&!value.trim())) invalid();
  return value.trim();
}
export function presentation(value: unknown): Presentation {
  const item=record(value,['kind','title','summary','body','steps','questions']);
  if(!['task_draft','skill_draft','practice_quiz'].includes(String(item.kind))) invalid();
  if(!Array.isArray(item.steps)||item.steps.length>12||!Array.isArray(item.questions)) invalid();
  const result: Presentation={kind:item.kind as Presentation['kind'],title:text(item.title,120),summary:text(item.summary,600),body:text(item.body,2000,true),steps:item.steps.map(step=>text(step,300)),questions:[]};
  if(result.kind==='practice_quiz' ? item.questions.length!==10 : item.questions.length!==0) invalid();
  if(result.kind==='practice_quiz'&&(result.body||result.steps.length)) invalid();
  if(result.kind!=='practice_quiz'&&!result.body&&!result.steps.length) invalid();
  result.questions=item.questions.map(value=>{
    const q=record(value,['prompt','options','correctIndex','explanation']);
    if(!Array.isArray(q.options)||q.options.length!==4||!Number.isInteger(q.correctIndex)||Number(q.correctIndex)<0||Number(q.correctIndex)>3) invalid();
    const options=q.options.map(option=>text(option,300));if(new Set(options).size!==4) invalid();
    return {prompt:text(q.prompt,600),options,correctIndex:Number(q.correctIndex),explanation:text(q.explanation,600)};
  });
  if(new Set(result.questions.map(q=>q.prompt)).size!==result.questions.length) invalid();
  return result;
}
