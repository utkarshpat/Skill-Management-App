import { useEffect, useState } from 'react';
import { authenticatedFetch } from '../auth';
import { readApiResponse } from '../api-response';
import { FormDialog } from '../FormDialog';
import { CertificateFilePreview } from '../certifications/CertificateFilePreview';
import '../certifications/certifications.css';
interface FileItem {
  id: string;
  fileName: string;
  mimeType: string;
  bytes: number;
}
function FilePreview({ root, item }: { root: string; item: FileItem }) {
  const [url, setUrl] = useState(''),
    [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    let object = '';
    setUrl('');
    setError('');
    authenticatedFetch(`${root}/${encodeURIComponent(item.id)}`, { signal: abort.signal })
      .then(async response => {
        if (!response.ok) await readApiResponse(response, 'File could not be opened.');
        const blob = await response.blob();
        if (abort.signal.aborted) return;
        object = URL.createObjectURL(blob);
        if (abort.signal.aborted) {
          URL.revokeObjectURL(object);
          object = '';
          return;
        }
        setUrl(object);
      })
      .catch(e => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => {
      abort.abort();
      if (object) URL.revokeObjectURL(object);
    };
  }, [root, item.id]);
  return error ? (
    <p role="alert">{error}</p>
  ) : url ? (
    <CertificateFilePreview url={url} mimeType={item.mimeType} fileName={item.fileName} />
  ) : (
    <p role="status">Loading {item.fileName}…</p>
  );
}
export function BusinessRecordFiles({
  kind,
  id,
  name,
  onClose,
}: {
  kind: string;
  id: string;
  name: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<{ items: FileItem[]; references: string }>(),
    [error, setError] = useState('');
  const root = `/api/business/records/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/files`;
  useEffect(() => {
    const abort = new AbortController();
    setData(undefined);
    setError('');
    authenticatedFetch(root, { signal: abort.signal })
      .then(r =>
        readApiResponse<{ items: FileItem[]; references: string }>(
          r,
          'Submitted files are unavailable.',
        ),
      )
      .then(v => {
        if (!abort.signal.aborted) setData(v);
      })
      .catch(e => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [root]);
  return (
    <FormDialog title={`Submitted files · ${name}`} onClose={onClose}>
      <p className="bo-note">
        Read-only files from a submitted or manager-reviewed record in your current authorized
        scope.
      </p>
      {error && (
        <p role="alert" className="bo-error">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Loading submitted files…</p>}
      {data?.references && (
        <section>
          <h3>Evidence references</h3>
          <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{data.references}</p>
        </section>
      )}
      {data?.items.map(item => (
        <FilePreview key={item.id} root={root} item={item} />
      ))}
      {data && !data.items.length && !data.references && (
        <p>No submitted attachments or evidence references are available for this record.</p>
      )}
    </FormDialog>
  );
}
