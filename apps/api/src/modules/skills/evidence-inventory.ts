export interface StoredEvidenceObject {
  name: string;
  bytes: number;
  modifiedAt?: Date;
}
/** Observation only: no deletion operation exists and no retention policy is implied. */
export function evidenceInventory(
  account: string,
  objects: StoredEvidenceObject[],
  references: Set<string>,
  complete: boolean,
  now = new Date(),
) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(account))
    throw Error('Choose a configured account.');
  const prefix = account.toLowerCase() + '/';
  return {
    mode: 'dry-run' as const,
    account,
    asOf: now.toISOString(),
    referenceScanComplete: complete,
    deletionEnabled: false,
    deletedObjects: 0,
    retentionPolicy: 'Undecided; no deletion authorized',
    objects: objects
      .filter(o => o.name.startsWith(prefix))
      .map(o => ({
        name: o.name,
        bytes: o.bytes,
        modifiedAt: o.modifiedAt?.toISOString() ?? null,
        ageDays: o.modifiedAt
          ? Math.max(0, Math.floor((now.getTime() - o.modifiedAt.getTime()) / 86400000))
          : null,
        status: references.has(o.name)
          ? 'Referenced; retain'
          : !complete
            ? 'Reference scan incomplete; retain'
            : 'Unreferenced at scan; retain pending policy',
      })),
  };
}
export function historicalEvidenceReferences(documents: (string | null)[], prefix: string) {
  const references = new Set<string>();
  let complete = true;
  const visit = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object')
      for (const [key, child] of Object.entries(value)) {
        if (['blobName', 'blob_name'].includes(key) && typeof child === 'string') {
          if (child.startsWith(prefix)) references.add(child);
          else complete = false;
        } else visit(child);
      }
  };
  for (const document of documents) {
    if (!document) continue;
    try {
      visit(JSON.parse(document));
    } catch {
      complete = false;
    }
  }
  return { references, complete };
}
