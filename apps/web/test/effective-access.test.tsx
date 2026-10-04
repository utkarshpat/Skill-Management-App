import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {AccessDecisionList} from '../src/AccessDecisionList';
test('access explanations show resolved scope, workflow checks and escaped source labels',()=>{
 const html=renderToStaticMarkup(<AccessDecisionList summary={{actorId:'own',revision:7,summaryOnly:true,unsupportedAssignments:[{}],decisions:[{action:'skill.verify',implemented:true,allowed:true,reasonCode:'REPORTING_POLICY',resolvedScope:{kind:'DIRECT_REPORTS'},constraints:['CURRENT_DIRECT_MANAGER','NO_SELF_REVIEW'],sources:[{kind:'RELATIONSHIP',label:'<script>source</script>',effect:'ALLOW',scope:'DIRECT_REPORTS'}]}]}}/>);
 assert.match(html,/Why\?/);assert.match(html,/direct reports/);assert.match(html,/current direct manager/);assert.match(html,/no self review/);assert.match(html,/preserved/);assert.match(html,/revision 7/);assert.doesNotMatch(html,/<script>/);
});
