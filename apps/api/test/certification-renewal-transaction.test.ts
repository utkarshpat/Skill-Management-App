import test from 'node:test';
import assert from 'node:assert/strict';
import sql from 'mssql';
import { SqlCertificationStore } from '../src/modules/skills/sql-certification-store.js';
import type { CertificationChange } from '../src/modules/skills/certifications.js';

const actor = '00000000-0000-4000-8000-000000000001';
const change: CertificationChange = {
  action: 'SAVE',
  id: '00000000-0000-4000-8000-000000000002',
  revision: 4,
  renewedFromId: '00000000-0000-4000-8000-000000000003',
  fields: {
    certificationName: 'Cloud',
    provider: 'Issuer',
    category: 'Cloud',
    certificationDate: '2026-01-01',
    expiryDate: null,
    credentialId: '',
    credentialUrl: '',
    notes: '',
  },
};
for (const action of ['SAVE', 'SAVE_SUBMIT'] as const) {
  for (const failAt of [undefined, 'SAVE', 'LINK', 'SUBMIT'] as const) {
    if (action === 'SAVE' && failAt === 'SUBMIT') continue;
    test(`renewal ${action} ${failAt ? 'rolls back ' + failAt + ' failure' : 'commits atomically'}`, async t => {
      const pool = new sql.ConnectionPool({ server: 'fixture' });
      const store = new SqlCertificationStore(actor, async callback => callback(pool));
      const calls: string[] = [],
        staged: string[] = [],
        committed: string[] = [];
      let transaction: sql.Transaction;
      t.mock.method(sql.Transaction.prototype, 'begin', async function (this: sql.Transaction) {
        transaction = this;
        calls.push('BEGIN');
      });
      t.mock.method(sql.Transaction.prototype, 'commit', async () => {
        calls.push('COMMIT');
        committed.push(...staged);
      });
      t.mock.method(sql.Transaction.prototype, 'rollback', async () => {
        calls.push('ROLLBACK');
        staged.length = 0;
      });
      t.mock.method(
        sql.Request.prototype,
        'execute',
        async function (this: sql.Request, procedure: string) {
          assert.equal((this as unknown as { parent: sql.Transaction }).parent, transaction);
          const operation =
            procedure === 'dbo.LinkCertificationRenewal'
              ? 'LINK'
              : String(this.parameters.operation.value);
          calls.push(operation);
          if (operation === failAt) throw Object.assign(new Error('Conflict'), { number: 51010 });
          if (operation === 'SUBMIT')
            assert.equal(JSON.parse(String(this.parameters.payload.value)).revision, 5);
          staged.push(operation);
          return { recordsets: [] };
        },
      );
      if (failAt) {
        await assert.rejects(
          store.change(actor, { ...change, action }),
          (error: any) => error.status === 409,
        );
        assert.deepEqual(committed, []);
        assert.equal(calls.at(-1), 'ROLLBACK');
        assert.ok(!calls.includes('COMMIT'));
      } else {
        assert.equal(await store.change(actor, { ...change, action }), action === 'SAVE' ? 5 : 6);
        assert.deepEqual(
          calls,
          action === 'SAVE'
            ? ['BEGIN', 'SAVE', 'LINK', 'COMMIT']
            : ['BEGIN', 'SAVE', 'LINK', 'SUBMIT', 'COMMIT'],
        );
        assert.deepEqual(
          committed,
          action === 'SAVE' ? ['SAVE', 'LINK'] : ['SAVE', 'LINK', 'SUBMIT'],
        );
      }
    });
  }
}

for (const number of [2601, 2627, 51013])
  test(`ordinary credential correction maps SQL ${number} to an actionable response`, async () => {
    const failure = Object.assign(new Error('SQL failure'), { number });
    const request = {
      input: () => request,
      execute: async () => {
        throw failure;
      },
    };
    const store = new SqlCertificationStore(actor, async callback =>
      callback({ request: () => request } as any),
    );
    const { renewedFromId: _source, ...ordinary } = change;
    await assert.rejects(
      store.change(actor, ordinary),
      (error: any) => error.status === (number === 51013 ? 400 : 409),
    );
  });
