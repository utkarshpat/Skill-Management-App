import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchOwnSkillProfile,
  LatestProfileRequest,
  type OwnSkillProfile,
} from '../src/own-skill-profile';
import type { Claim } from '../src/MySkills';

const claim: Claim = {
  id: '10000000-0000-4000-8000-000000000001',
  revision: 1,
  skillId: '20000000-0000-4000-8000-000000000001',
  skillName: 'React',
  category: 'Engineering',
  definitionRevision: 1,
  rank: 1,
  levelName: 'Beginner',
  experienceMonths: 1,
  description: 'Test experience',
  status: 'DRAFT',
  updatedAt: '2026-10-06T09:00:00Z',
};
const profile: OwnSkillProfile = { claims: [], total: 0, page: 1, pageSize: 25, canClaim: true };
test('starting a refresh aborts earlier requests and only the newest completion may update state', async () => {
  const requests = new LatestProfileRequest(),
    old = requests.start();
  let finishOld!: (value: Response) => void;
  const oldRead = fetchOwnSkillProfile(
    async () =>
      new Promise<Response>(resolve => {
        finishOld = resolve;
      }),
    old.signal,
  );
  const fresh = requests.start();
  const freshValue = await fetchOwnSkillProfile(
    async () => Response.json({ ...profile, claims: [claim], total: 1 }),
    fresh.signal,
  );
  assert.ok(old.signal.aborted);
  assert.equal(requests.current(old), false);
  assert.equal(requests.current(fresh), true);
  assert.equal(freshValue.claims[0].revision, 1);
  finishOld(Response.json(profile));
  await assert.rejects(oldRead, { name: 'AbortError' });
  requests.abort();
  assert.equal(requests.current(fresh), false);
});
test('profile refresh reads every own page and deduplicates claims', async () => {
  const calls: number[] = [];
  const result = await fetchOwnSkillProfile(async (path, init) => {
    assert.ok(init?.signal);
    const page = Number(path.split('page=')[1]);
    calls.push(page);
    return Response.json({ ...profile, page, pageSize: 1, total: 3, claims: [claim] });
  }, new AbortController().signal);
  assert.deepEqual(calls, [1, 2, 3]);
  assert.deepEqual(result.claims, [claim]);
});
test('refresh failure stays a fetch failure instead of inventing a missing claim, and retry reads fresh revision', async () => {
  let attempts = 0;
  const fetcher = async () =>
    ++attempts === 1
      ? Response.json({ error: { message: 'Profile refresh unavailable' } }, { status: 503 })
      : Response.json({ ...profile, claims: [{ ...claim, revision: 7 }], total: 1 });
  await assert.rejects(
    fetchOwnSkillProfile(fetcher, new AbortController().signal),
    /Profile refresh unavailable/,
  );
  const fresh = await fetchOwnSkillProfile(fetcher, new AbortController().signal);
  assert.equal(fresh.claims[0].revision, 7);
  assert.equal(attempts, 2);
});
test('revocation and a failed later page cannot return a stale or partial profile', async () => {
  for (const status of [401, 403])
    await assert.rejects(
      fetchOwnSkillProfile(
        async () => Response.json({ error: { message: 'Access revoked' } }, { status }),
        new AbortController().signal,
      ),
      /Access revoked/,
    );
  await assert.rejects(
    fetchOwnSkillProfile(
      async path =>
        path.endsWith('page=1')
          ? Response.json({ ...profile, claims: [claim], pageSize: 1, total: 2 })
          : Response.json({ error: { message: 'Later page failed' } }, { status: 503 }),
      new AbortController().signal,
    ),
    /Later page failed/,
  );
});
test('invalid pagination cannot loop forever or silently return a partial profile', async () => {
  for (const override of [
    { pageSize: 0 },
    { total: Infinity },
    { total: -1 },
    { page: 2 },
    { pageSize: 0.5 },
    { claims: null },
  ]) {
    await assert.rejects(
      fetchOwnSkillProfile(
        async () => Response.json({ ...profile, ...override }),
        new AbortController().signal,
      ),
      /invalid pagination/,
    );
  }
});
