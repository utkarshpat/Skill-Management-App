import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AccessError } from '../src/shared/errors.js';
import {
  catalogueGuidance,
  catalogueGuidanceRequest,
} from '../src/modules/ai/catalogue-guidance.js';

const pages = [
  { url: '/skills', label: 'Skill catalogue' },
  { url: '/skills?tab=amendments', label: 'Catalogue amendments' },
];

test('exact matches distinguish issuers and skip unnecessary reads and amendment actions', async () => {
  const queries: string[] = [];
  const result = await catalogueGuidance(
    catalogueGuidanceRequest(
      'Check the published certificate catalogue for this name and guide me if it is missing: Oracle Cloud Architect',
    )!,
    async search => {
      queries.push(search);
      return {
        credentials: [
          { name: 'Cloud Architect', provider: 'Oracle' },
          { name: 'Cloud Architect', provider: 'Microsoft' },
        ],
      };
    },
    { pages, canDraftAmendment: true },
  );
  assert.deepEqual(queries, ['Oracle Cloud Architect']);
  assert.match(result.reply, /Cloud Architect · Oracle \(exact name\)/);
  assert.doesNotMatch(result.reply, /Microsoft \(exact name\)/);
  assert.deepEqual(result.sources, [pages[0]]);
});

test('closest matches are bounded and only eligible proposers get an amendment action', async () => {
  const queries: string[] = [];
  const request = { kind: 'skill' as const, search: 'Advanced Type Script' };
  const read = async (search: string) => {
    queries.push(search);
    return {
      skills:
        search === request.search ? [] : [{ name: 'Advanced Type Systems' }, { name: 'Cooking' }],
    };
  };
  const eligible = await catalogueGuidance(request, read, { pages, canDraftAmendment: true });
  assert.equal(queries.length, 3);
  assert.match(eligible.reply, /Advanced Type Systems/);
  assert.doesNotMatch(eligible.reply, /Cooking|\(exact name\)/);
  assert.equal(eligible.sources.at(-1)?.url, '/skills?tab=amendments');
  const employee = await catalogueGuidance(request, read, { pages, canDraftAmendment: false });
  assert.match(employee.reply, /ask your N\+1/);
  assert.deepEqual(employee.sources, [pages[0]]);
});

test('unavailable and revoked catalogue access do not produce an absence claim', async () => {
  const request = { kind: 'certificate' as const, search: 'Azure Networks' };
  const capabilities = { pages: [], canDraftAmendment: false };
  assert.match(
    (await catalogueGuidance(request, undefined, capabilities)).reply,
    /could not check/,
  );
  await assert.rejects(
    catalogueGuidance(
      request,
      async () => {
        throw new AccessError(403, 'Current permission does not allow this assistant action.');
      },
      capabilities,
    ),
    /permission/,
  );
  assert.equal(
    catalogueGuidanceRequest(
      'Check the published skill catalogue for this name and guide me if it is missing: ' +
        'x'.repeat(101),
    ),
    undefined,
  );
});
