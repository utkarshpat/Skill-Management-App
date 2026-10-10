import type { CertificationPage } from './types';
// Assemble complete authorized pages before exposing portfolio-wide counts.
export async function loadCertificationPortfolio(
  read: (page: number) => Promise<CertificationPage>,
  signal: AbortSignal,
): Promise<CertificationPage> {
  signal.throwIfAborted();
  const first = await read(1);
  if (
    first.pageSize < 1 ||
    !Number.isInteger(first.pageSize) ||
    first.total < 0 ||
    !Number.isInteger(first.total) ||
    Math.ceil(first.total / first.pageSize) > 1000
  )
    throw Error('Certification portfolio is unavailable. Refresh to retry.');
  const records = [...first.records];
  const lastPage = Math.ceil(first.total / first.pageSize);
  // Two reads at a time match the restricted SQL pool, avoiding an unbounded fan-out.
  for (let page = 2; page <= lastPage; page += 2) {
    signal.throwIfAborted();
    const pages = await Promise.all(
      Array.from({ length: Math.min(2, lastPage - page + 1) }, (_, i) => read(page + i)),
    );
    signal.throwIfAborted();
    for (const next of pages) {
      if (next.total !== first.total || next.pageSize !== first.pageSize)
        throw Error(
          'Your certification portfolio changed while loading. Refresh to get the latest records.',
        );
      records.push(...next.records);
    }
  }
  signal.throwIfAborted();
  if (records.length !== first.total || new Set(records.map(r => r.id)).size !== first.total)
    throw Error(
      'Your certification portfolio changed while loading. Refresh to get the latest records.',
    );
  return { ...first, records };
}
