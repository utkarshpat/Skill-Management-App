import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assistantNavigationTargets,canonicalAssistantDestination} from '../src/assistant-actions';
import {AssistantOutput} from '../src/AssistantOutput';
import {renderToStaticMarkup} from 'react-dom/server';
test('assistant destinations require an exact permitted page and cannot select another user or arbitrary URL',()=>{
 const pages=[{label:'My skills',url:'/my-skills'},{label:'My profile',url:'/profile'}];
 const result=assistantNavigationTargets('[Admin](/access?view=people) [Skill](/my-skills) [Foreign](/my-skills?personId=other)',[{url:'/'},{url:'https://evil.invalid'}],pages);
 assert.deepEqual(result,pages);
 for(const url of ['/my-skills?personId=other','/access?view=people&actorId=other','/access?view=unknown','//evil.invalid','/my-skills#other','javascript:alert(1)'])assert.equal(canonicalAssistantDestination(url),undefined);
});
test('skill output offers an in-place review only when the authorized review handler is provided',()=>{
 const artifact={kind:'skill_draft' as const,title:'Skill draft',summary:'Review',body:'',steps:[],questions:[]};
 const blocked=renderToStaticMarkup(<AssistantOutput artifact={artifact}/>);assert.doesNotMatch(blocked,/Review skill draft|href=|Review in My Skills/);
 const allowed=renderToStaticMarkup(<AssistantOutput artifact={artifact} onReview={()=>{}}/>);assert.match(allowed,/Review skill draft/);assert.doesNotMatch(allowed,/href=|Review in My Skills/);
});
