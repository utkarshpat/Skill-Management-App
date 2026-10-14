import test from 'node:test';
import assert from 'node:assert/strict';
import {
  peopleSearchPrompt,
  peopleSearchUserText,
  peopleCriterionLabel,
} from '../src/business/people-search-prompt';
import { assistantContextPrompt } from '../src/assistant-context';
test('Find people shortcut fits sidebar bounds, retains explicit scope identity and asks before searching', () => {
  const scope = { id: '00000000-0000-4000-8000-000000000001', label: 'UK' };
  const prompt = peopleSearchPrompt(scope);
  assert.ok(assistantContextPrompt(prompt, ''));
  assert.match(prompt, /First ask/);
  assert.match(prompt, new RegExp(scope.id));
  assert.equal(peopleSearchUserText(prompt), 'Find people in UK');
  assert.equal(peopleSearchUserText('Find people with SQL'), 'Find people with SQL');
  assert.equal(
    peopleSearchUserText(prompt + '\nUser requirements:\nNeed 3 HCM people'),
    'Need 3 HCM people',
  );
  assert.ok(assistantContextPrompt(peopleSearchPrompt({ ...scope, label: 'x'.repeat(1000) }), ''));
  assert.match(peopleSearchPrompt(), /authorized union/);
  assert.equal(assistantContextPrompt(prompt, 'An unsent message')?.needsReplacement, true);
});
test('matching labels keep the four-level distinction and leave unsupported criteria unchanged', () => {
  assert.equal(
    peopleCriterionLabel('Four-level framework manager-reviewed proficiency L2 or above'),
    'Autonomous+',
  );
  assert.equal(
    peopleCriterionLabel('Four-level framework manager-reviewed proficiency L4 or above'),
    'Expert+',
  );
  assert.equal(
    peopleCriterionLabel('Legacy proficiency L5 or above'),
    'Legacy proficiency L5 or above',
  );
});
