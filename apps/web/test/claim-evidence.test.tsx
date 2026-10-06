import test from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {EvidenceVisibility} from '../src/EvidenceVisibility';

test('Editable evidence explains private new uploads and previously submitted visibility',()=>{
 for(const status of ['DRAFT','CHANGES_REQUESTED','REJECTED'] as const){
  const html=renderToStaticMarkup(<EvidenceVisibility status={status}/>);
  assert.match(html,/New images stay private until you submit this claim for review/);
  assert.match(html,/Previously submitted images remain visible to your current assigned reviewer/);
  assert.doesNotMatch(html,/Only images included in the latest submission/);
 }
});
test('Reviewer evidence explains its latest-submission boundary without upload controls',()=>{
 const html=renderToStaticMarkup(<EvidenceVisibility reviewer status="CHANGES_REQUESTED"/>);
 assert.match(html,/Only images included in the latest submission are shown/);
 assert.match(html,/New draft images stay private until resubmission/);
 assert.doesNotMatch(html,/type="file"|New images stay private until you submit/);
});
test('Submitted and approved owner views do not advertise editing',()=>{
 for(const status of ['SUBMITTED','APPROVED'] as const){
  assert.equal(renderToStaticMarkup(<EvidenceVisibility status={status}/>),'');
 }
});
