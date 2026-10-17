import type { CertificationPage } from './types';
class PortfolioChanged extends Error {
  constructor() {
    super('Your certification portfolio changed while loading. Refresh to get the latest records.');
  }
}
// Restart at page one, never merge pages from different workspace revisions.
export async function loadCertificationPortfolio(
  read: (page: number) => Promise<CertificationPage>,
  signal: AbortSignal,
): Promise<CertificationPage> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      return await readPortfolio(read, signal);
    } catch (error) {
      signal.throwIfAborted();
      if (
        attempt >= 2 ||
        !(error instanceof PortfolioChanged || (error as { status?: number })?.status === 409)
      )
        throw error;
    }
  }
}
async function readPortfolio(
  read: (page: number) => Promise<CertificationPage>,
  signal: AbortSignal,
): Promise<CertificationPage> {
  signal.throwIfAborted();
  const first = await read(1);
  if (
    !Number.isSafeInteger(first.snapshotRevision) ||
    Number(first.snapshotRevision) < 0 ||
    first.pageSize < 1 ||
    !Number.isSafeInteger(first.pageSize) ||
    first.total < 0 ||
    !Number.isSafeInteger(first.total) ||
    Math.ceil(first.total / first.pageSize) > 1000
  )
    throw Error('Certification portfolio is unavailable. Refresh to retry.');
  const records: CertificationPage['records'] = [];
  const capabilities = [
    'canManage',
    'canSubmitNew',
    'canReview',
    'canUploadImage',
    'canRecommend',
    'canViewRecommendations',
  ] as const;
  const append = (next: CertificationPage, expectedPage: number) => {
    if (
      next.page !== expectedPage ||
      next.snapshotRevision !== first.snapshotRevision ||
      next.total !== first.total ||
      next.pageSize !== first.pageSize ||
      capabilities.some(key => next[key] !== first[key]) ||
      !Array.isArray(next.records) ||
      next.records.length !==
        Math.min(first.pageSize, first.total - (expectedPage - 1) * first.pageSize)
    )
      throw new PortfolioChanged();
    records.push(...next.records);
  };
  append(first, 1);
  const lastPage = Math.ceil(first.total / first.pageSize);
  // Two reads at a time match the restricted SQL pool, avoiding an unbounded fan-out.
  for (let page = 2; page <= lastPage; page += 2) {
    signal.throwIfAborted();
    const pages = await Promise.allSettled(
      Array.from({ length: Math.min(2, lastPage - page + 1) }, (_, i) => read(page + i)),
    );
    signal.throwIfAborted();
    // Drain the batch before retrying so failures cannot multiply concurrency.
    // Authorization failures take precedence over retryable conflicts.
    const failed = pages.filter((p): p is PromiseRejectedResult => p.status === 'rejected');
    if (failed.length)
      throw (failed.find(p => (p.reason as { status?: number })?.status !== 409) ?? failed[0])
        .reason;
    pages.forEach((next, index) => {
      if (next.status === 'fulfilled') append(next.value, page + index);
    });
  }
  signal.throwIfAborted();
  if (records.length !== first.total || new Set(records.map(r => r.id)).size !== first.total)
    throw new PortfolioChanged();
  return { ...first, records };
}
