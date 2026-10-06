import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router';
import {ProfileCompleteness} from '../src/ProfileCompleteness';
test('profile completion exposes missing fields and permission-bound correction action without fake skill score',()=>{
 const value={available:true,completed:5,total:6,percent:83,fields:[{key:'grade',label:'Grade',complete:false}]};
 const render=(canRequest:boolean)=>renderToStaticMarkup(<MemoryRouter><ProfileCompleteness value={value} loading={false} failed={false} canRequest={canRequest}/></MemoryRouter>);
 assert.match(render(true),/83%/);assert.match(render(true),/requests\?action=create/);assert.match(render(true),/Grade/);assert.match(render(true),/not capability/);
 assert.doesNotMatch(render(false),/href=/);assert.match(render(false),/request creation is not available/);
 const failed=renderToStaticMarkup(<ProfileCompleteness value={value} loading={false} failed canRequest/>);assert.doesNotMatch(failed,/83%|<progress/);assert.match(failed,/unavailable/);
});
