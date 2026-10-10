export function certificationResponseFailure(error: unknown) {
  const status = (error as { status?: number } | null)?.status;
  const clear = status === 401 || status === 403 || status === 404;
  const recheck = !clear && (status === 409 || status === undefined || status >= 500);
  return {
    clear,
    recheck,
    message: recheck
      ? status === 409
        ? 'This recommendation changed. Check its current status before responding again. Your note is still here.'
        : 'Your response could not be confirmed. Check its current status before responding again. Your note is still here.'
      : error instanceof Error
        ? error.message
        : 'Your response could not be saved.',
  };
}

export function currentCertificationResponse<T extends { id: string }>(items: T[], id: string): T {
  // Reconciliation is an exact-record read, never a write or a response replay.
  if (items.length !== 1 || items[0].id !== id)
    throw Object.assign(Error('This recommendation is no longer available.'), { status: 404 });
  return items[0];
}

export function canRespondToCertification(record: { canRespond: boolean; status: string }) {
  return record.canRespond && ['PENDING', 'DISCUSSION'].includes(record.status);
}
