export function assistantContextPrompt(value:unknown,currentText:string){
 if(typeof value!=='string'||!value.trim()||value.length>500)return undefined;
 const prompt=value.trim();return {prompt,needsReplacement:Boolean(currentText.trim()&&currentText.trim()!==prompt)};
}
