import {test} from 'node:test';
import assert from 'node:assert/strict';
import {notificationDestination} from '../src/notification-model';
test('notification actions target implemented internal destinations without granting workflow actions',()=>{
 assert.equal(notificationDestination('/requests?record=123')?.label,'View request');
 assert.equal(notificationDestination('/learning?tab=recommendations&recommendation=123&direction=sent')?.label,'Open recommendation');
 assert.equal(notificationDestination('/skill-reviews?claim=123')?.kind,'Skill reviews');
 assert.equal(notificationDestination('/my-skills?claim=123')?.label,'View skill claim');
 assert.equal(notificationDestination('/profile')?.label,'View profile');
});
test('notification actions reject external, protocol relative and unsupported destinations',()=>{
 for(const href of ['https://example.com','//example.com','javascript:alert(1)','/unknown','/requests\\evil','/requests/other'])assert.equal(notificationDestination(href),undefined);
});

test('control characters cannot turn an internal notification into an external redirect',()=>{
 for(const href of ['/\n/example.com/profile','/\t/example.com/requests','/\r/example.com/learning','/profile\u0000'])assert.equal(notificationDestination(href),undefined);
});
