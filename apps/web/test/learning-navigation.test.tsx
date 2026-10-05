import {test} from 'node:test';
import assert from 'node:assert/strict';
import {learningView,learningTabSearch,recommendationQuery} from '../src/learning-navigation';
test('learning tabs survive reload and clear a previous notification destination',()=>{
 const original=new URLSearchParams('tab=recommendations&direction=sent&recommendation=123&openPlan=456');
 for(const tab of ['My learning','Learning paths','Goals','Growth journey','Recommendations','Today','Calendar','Backlog']){
  const next=learningTabSearch(original,tab);
  assert.equal(learningView(new URLSearchParams(next.toString())),tab);
  assert.equal(next.has('recommendation'),false);assert.equal(next.has('openPlan'),false);assert.equal(next.has('direction'),false);
 }
 assert.equal(original.get('recommendation'),'123');
 assert.equal(learningView(new URLSearchParams('tab=unknown')),'My learning');
});
test('exact recommendation lookup does not inherit list pagination',()=>{
 const focused=recommendationQuery('sent',4,'record-id');
 assert.equal(focused.get('page'),'1');assert.equal(focused.get('id'),'record-id');assert.equal(focused.get('view'),'sent');
 assert.equal(recommendationQuery('received',4,'').get('page'),'4');
 assert.equal(recommendationQuery('received',4,'').has('id'),false);
});
