import type { SelectedCertificate, Submission } from './capability-model';
import { readApiResponse } from '../api-response';

export function restoreIntakeCertificates(value: Submission): SelectedCertificate[] {
  return (value.intake?.certifications ?? []).map(c => {
    const staged = Boolean(
      value.stagedFiles?.some(f => f.certificationId.toLowerCase() === c.id.toLowerCase()),
    );
    // Recovery displays the server snapshot, never an unconfirmed local replacement.
    return { ...c, file: undefined, uploaded: staged, staged };
  });
}

export async function certificateForAutofill(
  certificate: SelectedCertificate,
  submissionId: string,
  read: (path: string, init: RequestInit) => Promise<Response>,
  signal: AbortSignal,
): Promise<File> {
  signal.throwIfAborted();
  if (certificate.file) return certificate.file;
  const root = certificate.staged
    ? `/api/capability-submissions/${encodeURIComponent(submissionId)}/staged/${encodeURIComponent(certificate.id)}`
    : `/api/certifications/${encodeURIComponent(certificate.id)}/image`;
  const metadata = await readApiResponse<{
    items: { id: string; fileName: string; mimeType: string; bytes: number }[];
  }>(await read(root, { signal }), 'Certificate file could not be opened for AI autofill.');
  signal.throwIfAborted();
  const item = metadata.items[0];
  if (
    !item ||
    !item.fileName ||
    !Number.isSafeInteger(item.bytes) ||
    item.bytes < 1 ||
    item.bytes > 5 * 1024 * 1024
  )
    throw Error('Choose a certificate file up to 5 MB.');
  const response = await read(root + '/' + encodeURIComponent(item.id), { signal });
  if (!response.ok)
    await readApiResponse(response, 'Certificate file could not be opened for AI autofill.');
  const blob = await response.blob();
  signal.throwIfAborted();
  if (blob.size !== item.bytes)
    throw Error('The certificate file changed. Reopen it before AI autofill.');
  return new File([blob], item.fileName, { type: item.mimeType });
}
