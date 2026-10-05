import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {ProficiencyEditor} from '../src/ProficiencyEditor';
import {standardLevels,isStandardFramework} from '../src/proficiency';

test('five-level model maps by rank without mutating source criteria',()=>{
 const legacy=standardLevels().map(level=>({...level,name:level.rank===2?'Beginner':level.rank===3?'Intermediate':level.name,description:'Criteria '+level.rank}));
 const copy=structuredClone(legacy),mapped=standardLevels(legacy);
 assert.deepEqual(mapped.map(level=>level.name),['Awareness','Foundation','Practitioner','Advanced','Expert']);
 assert.deepEqual(mapped.map(level=>level.description),legacy.map(level=>level.description));assert.deepEqual(legacy,copy);
 assert.equal(isStandardFramework(legacy),false);assert.equal(isStandardFramework(mapped),true);
 assert.equal(isStandardFramework(mapped.slice(0,4)),false);assert.equal(standardLevels(legacy.slice(0,2))[2].description,'');
});
test('criteria editor explains fixed levels and publication requirements, with no scale mutation controls',()=>{
 const html=renderToStaticMarkup(<ProficiencyEditor levels={standardLevels()} selected={2} onSelect={()=>{}} onChange={()=>{}} published/>);
 assert.match(html,/aria-label="Five-level proficiency model"/);assert.match(html,/Criteria for Practitioner/);assert.match(html,/<textarea required=""/);
 assert.match(html,/required for all five levels/);assert.doesNotMatch(html,/Add level|Remove level|<input/);
 const draft=renderToStaticMarkup(<ProficiencyEditor levels={standardLevels()} selected={0} onSelect={()=>{}} onChange={()=>{}} published={false}/>);
 assert.doesNotMatch(draft,/<textarea required/);
});
test('legacy alignment is explicit and explains snapshots and missing or removed ranks',()=>{
 const legacy=standardLevels().map(level=>({...level,name:'Old '+level.rank}));
 const props={selected:0,onSelect:()=>{},onChange:()=>{},published:true};
 const before=renderToStaticMarkup(<ProficiencyEditor {...props} levels={legacy}/>);
 assert.match(before,/Align to five levels/);assert.match(before,/missing criteria/);assert.match(before,/Levels above 5/);
 const after=renderToStaticMarkup(<ProficiencyEditor {...props} levels={standardLevels(legacy)} original={legacy}/>);
 assert.match(after,/Alignment is ready to save/);assert.match(after,/claim snapshots remain unchanged/);assert.doesNotMatch(after,/Align to five levels<\/button>/);
 assert.match(before,/Saved: Old 2/);assert.match(after,/Saved: Old 2/);
});
