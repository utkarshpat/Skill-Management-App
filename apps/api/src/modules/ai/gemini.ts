import { AccessError } from '../../shared/errors.js';
import type { Provider, Message } from './assistant.js';

// Full model parts, including opaque thought signatures, stay on the server.
// They are reused unchanged within the current authorized tool loop.
export function geminiProvider(key: string, model: string, transport: typeof fetch): Provider {
  if(!/^[a-zA-Z0-9.-]+$/.test(model)) throw new Error('Invalid Gemini model name.');
  return {name:'gemini',async complete(messages,tools,signal){
    const contents:{role:string;parts:unknown[]}[]=[];
    for(const message of messages.filter(message=>message.role!=='system')) {
      const role=message.role==='assistant'?'model':'user';
      const parts=message.providerParts ?? (message.role==='tool' ? [{functionResponse:{name:message.tool_name,response:JSON.parse(message.content)}}] : [{text:message.content}]);
      const previous=contents.at(-1);
      if(message.role==='tool'&&previous?.role==='user')previous.parts.push(...parts);
      else contents.push({role,parts});
    }
    try {
      const response=await transport(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:'POST',redirect:'error',signal,
        headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify({systemInstruction:{parts:[{text:messages.filter(message=>message.role==='system').map(message=>message.content).join('\n')}]},contents,
          tools:tools.length?[{functionDeclarations:tools.map(tool=>({name:tool.function.name,description:tool.function.description,parametersJsonSchema:tool.function.parameters}))}]:undefined,
          generationConfig:{maxOutputTokens:6000,thinkingConfig:{thinkingLevel:'low'}},
        })});
      if(response.status===402)throw new AccessError(503,'Gemini requires billing or available credits for this model. Check the API project in Google AI Studio.');
      if(response.status===429)throw new AccessError(429,'Gemini quota is exhausted. Wait or check the API project quota in Google AI Studio.');
      if([401,403].includes(response.status))throw new AccessError(503,'Gemini access was rejected. Check the API key and model access in Google AI Studio.');
      if(!response.ok)throw new Error('Upstream failure');
      const data=await response.json(),candidate=data.candidates?.[0];
      if(candidate?.finishReason!=='STOP'||!Array.isArray(candidate.content?.parts))throw new Error('Incomplete answer');
      const parts=candidate.content.parts as {text?:string;thought?:boolean;functionCall?:{name:string;args:unknown}}[];
      const calls=parts.flatMap((part,index)=>part.functionCall?[{id:`gemini-${index}`,type:'function' as const,function:{name:part.functionCall.name,arguments:JSON.stringify(part.functionCall.args??{})}}]:[]);
      const content=parts.filter(part=>!part.thought&&typeof part.text==='string').map(part=>part.text).join('\n');
      if(!content.trim()&&!calls.length)throw new Error('Empty answer');
      return {content,calls,providerParts:parts};
    }catch(error) {
      if(signal.aborted)throw new AccessError(504,'AI took too long. Please try again.');
      if(error instanceof AccessError)throw error;
      throw new AccessError(502,'Gemini could not complete this request. Check the server model, key and quota, then try again.');
    }
  }};
}
