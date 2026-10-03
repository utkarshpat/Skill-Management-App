import {test} from 'node:test';
import assert from 'node:assert/strict';
import {currentStreak,dateInZone,shiftDay} from '../src/learning-calendar';
test('streak counts actual consecutive completion days without duplicating tasks or inventing missed days',()=>{assert.equal(currentStreak(['2026-10-01','2026-10-02','2026-10-02'],'2026-10-03'),2);assert.equal(currentStreak(['2026-10-01'],'2026-10-03'),0);assert.equal(currentStreak(['2026-10-03'],'2026-10-03'),1);assert.equal(currentStreak([],'2026-10-03'),0);});
test('calendar days handle month boundaries and timezone conversion',()=>{assert.equal(shiftDay('2026-12-31',1),'2027-01-01');assert.equal(shiftDay('2024-02-28',1),'2024-02-29');assert.equal(dateInZone(new Date('2026-10-02T20:00:00Z'),'Asia/Kolkata'),'2026-10-03');assert.equal(shiftDay('invalid',1),'');});
