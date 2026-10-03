export interface TokenUsage {inputTokens:number|null;outputTokens:number|null;thinkingTokens:number|null;cachedInputTokens:number|null;totalTokens:number|null}
const count=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
export function geminiUsage(value:unknown):TokenUsage {
  const data=(value&&typeof value==='object'?value:{}) as Record<string,unknown>;
  return {inputTokens:count(data.promptTokenCount),outputTokens:count(data.candidatesTokenCount),thinkingTokens:count(data.thoughtsTokenCount),cachedInputTokens:count(data.cachedContentTokenCount),totalTokens:count(data.totalTokenCount)};
}
export class UsageMeter {
  private calls:TokenUsage[]=[];
  begin(){const index=this.calls.length;this.calls.push(geminiUsage(undefined));return (usage:TokenUsage)=>{this.calls[index]=usage;};}
  record(usage?:TokenUsage){this.calls.push(usage??geminiUsage(undefined));}
  snapshot(){
    const sum=(key:keyof TokenUsage)=>this.calls.length===0?0:this.calls.some(call=>call[key]===null)?null:this.calls.reduce((total,call)=>total+call[key]!,0);
    return {modelCalls:this.calls.length,inputTokens:sum('inputTokens'),outputTokens:sum('outputTokens'),thinkingTokens:sum('thinkingTokens'),cachedInputTokens:sum('cachedInputTokens'),totalTokens:sum('totalTokens')};
  }
}
