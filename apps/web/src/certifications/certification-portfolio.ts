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
    !Number.isInteger(first.total)
  )
    throw Error('Certification portfolio is unavailable. Refresh to retry.');
  const records = [...first.records];
  for (let page = 2; page <= Math.ceil(first.total / first.pageSize); page++) {
    signal.throwIfAborted();
    const next = await read(page);
    if (next.total !== first.total || next.pageSize !== first.pageSize)
      throw Error(
        'Your certification portfolio changed while loading. Refresh to get the latest records.',
      );
    records.push(...next.records);
  }
  signal.throwIfAborted();
  if (records.length !== first.total || new Set(records.map(r => r.id)).size !== first.total)
    throw Error(
      'Your certification portfolio changed while loading. Refresh to get the latest records.',
    );
  return { ...first, records };
}
