import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readOrganizationSummary} from '../src/organization-summary';

test('organization summary rejects HTTP and malformed responses so the UI can offer retry',async()=>{
 await assert.rejects(readOrganizationSummary(Response.json({error:{message:'Temporarily unavailable'}},{status:503})),/Temporarily unavailable/);
 await assert.rejects(readOrganizationSummary(Response.json({nodes:[]},{status:200})),/Organization details could not be loaded/);
 const value=await readOrganizationSummary(Response.json({nodes:[],assignments:[]},{status:200}));
 assert.deepEqual(value,{nodes:[],assignments:[]});
});
