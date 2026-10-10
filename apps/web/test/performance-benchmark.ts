// Deterministic injected network delay: structural comparison, not hosted latency.
import { performance } from 'node:perf_hooks';
import { InflightReads } from '../src/inflight-reads';
import { loadCertificationPortfolio } from '../src/certifications/certification-portfolio';
import type { CertificationPage, CertificationRecord } from '../src/certifications/types';
const delay = () => new Promise<void>(resolve => setTimeout(resolve, 20));
let requests = 0;
const transport: typeof fetch = async () => {
  requests++;
  await delay();
  return Response.json({ ok: true });
};
const measure = async (action: () => Promise<unknown>) => {
  const start = performance.now();
  await action();
  return Math.round(performance.now() - start);
};
const baselineReads = await measure(() =>
  Promise.all(Array.from({ length: 20 }, () => transport('/api/me'))),
);
const baselineRequests = requests;
requests = 0;
const reads = new InflightReads(transport);
const sharedReads = await measure(() =>
  Promise.all(Array.from({ length: 20 }, () => reads.fetch('/api/me'))),
);
const records = Array.from({ length: 200 }, (_, i) => ({ id: String(i) }) as CertificationRecord);
let active = 0,
  peak = 0;
const read = async (n: number): Promise<CertificationPage> => {
  active++;
  peak = Math.max(peak, active);
  await delay();
  active--;
  return {
    records: records.slice((n - 1) * 25, n * 25),
    total: 200,
    page: n,
    pageSize: 25,
    canManage: false,
    canSubmitNew: false,
    canReview: false,
  };
};
const sequential = await measure(async () => {
  for (let n = 1; n <= 8; n++) await read(n);
});
peak = 0;
const batched = await measure(() => loadCertificationPortfolio(read, new AbortController().signal));
console.log(
  JSON.stringify(
    {
      injectedDelayMs: 20,
      reads: {
        baselineRequests,
        sharedRequests: requests,
        baselineMs: baselineReads,
        sharedMs: sharedReads,
      },
      portfolio: { pages: 8, sequentialMs: sequential, batchedMs: batched, peakConcurrent: peak },
    },
    null,
    2,
  ),
);
