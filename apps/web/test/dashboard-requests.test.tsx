import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router';
import {DashboardRequests,readRequestPreview,requestQueueHref,type DashboardRequestsData} from '../src/DashboardRequests';
const data:DashboardRequestsData={total:40,submitted:10,inProgress:15,resolved:12,cancelled:3,canCreate:true,recentRecords:[{id:'record',reference:'INC-12',kind:'INCIDENT',title:'Access failure',status:'IN_PROGRESS',priority:'HIGH',recipientName:'Recipient',updatedAt:'2026-10-04T12:00:00Z'}]};
const render=(value=data,status='')=>renderToStaticMarkup(<MemoryRouter><DashboardRequests status={status} onStatusChange={()=>{}} fetcher={async()=>{throw Error('No automatic reads during render');}} data={value} onAccessChanged={()=>{throw Error('No automatic changes');}}/></MemoryRouter>);
test('request dashboard shows real counts, statuses, exact record and explicit create action',()=>{
 const html=render();assert.match(html,/40 requests &amp; incidents/);assert.match(html,/Your request statuses/);assert.match(html,/aria-pressed="true"/);assert.match(html,/record=record/);assert.match(html,/INC-12/);assert.match(html,/High priority/);assert.match(html,/Recipient: Recipient/);assert.match(html,/Latest 1 of 40 records/);assert.match(html,/action=create/);assert.doesNotMatch(html,/SLA|overdue|awaiting response/i);const filtered=render(data,'RESOLVED');assert.match(filtered,/Loading resolved requests/);assert.doesNotMatch(filtered,/Access failure|Latest 1 of 40/);
});
test('empty read-only request dashboard does not expose creation or fictitious records',()=>{
 const html=render({...data,total:0,submitted:0,inProgress:0,resolved:0,cancelled:0,canCreate:false,recentRecords:[]});assert.match(html,/No requests raised yet/);assert.doesNotMatch(html,/action=create|record=|Latest/);
});
test('status preview uses guarded own dashboard endpoint, bounds records and rejects unsupported selectors',async()=>{
 let calls=0;const signal=AbortSignal.timeout(5000);
 const fetcher=async(url:Parameters<typeof fetch>[0],options?:RequestInit)=>{calls++;assert.equal(url,'/api/dashboard/requests?status=RESOLVED');assert.equal(options?.signal,signal);return Response.json({previewTotal:12,total:40,recentRecords:Array.from({length:10},()=>({...data.recentRecords[0],description:'Private text'}))});};
 const result=await readRequestPreview('RESOLVED',signal,fetcher);assert.equal(result.total,12);assert.equal(result.items.length,3);assert.doesNotMatch(JSON.stringify(result),/Private text/);assert.equal(requestQueueHref('RESOLVED'),'/requests?status=RESOLVED');
 await assert.rejects(readRequestPreview('foreign',signal,fetcher));assert.equal(calls,1);
 await assert.rejects(readRequestPreview('RESOLVED',signal,async()=>Response.json({error:{message:'Access changed'}},{status:403})),(e:unknown)=>(e as {status:number}).status===403);
});
