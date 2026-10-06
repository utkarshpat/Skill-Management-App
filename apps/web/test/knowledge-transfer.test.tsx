import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeDocUrl } from '../src/knowledge-transfer/types';
test('KT Markdown accepts only trusted documentation destinations', () => {
  for (const url of [
    'javascript:alert(1)',
    'https://evil.example/',
    '//evil.example/',
    '/api/access',
    'https://github.com.evil.example/utkarshpat/Skill-Management-App/',
  ])
    assert.equal(safeDocUrl(url), '');
  for (const url of [
    '/knowledgetransfer#table-AccessPerson',
    'https://github.com/utkarshpat/Skill-Management-App/blob/main/docs/HANDOVER.md',
  ])
    assert.equal(safeDocUrl(url), url);
  assert.equal(safeDocUrl('#table-AiActorBudget'), '/knowledgetransfer#table-AiActorBudget');
  assert.equal(
    safeDocUrl('ACCESS_MODEL_REDESIGN.md'),
    '/knowledgetransfer#approved-access-baseline',
  );
});
