import { useEffect, useState } from 'react';
import { authenticatedFetch } from '../auth';
import { readApiResponse } from '../api-response';
import { CertificateFilePreview } from '../certifications/CertificateFilePreview';
function Preview({ root, item }: { root: string; item: any }) {
  const [url, setUrl] = useState(''),
    [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    let object = '';
    authenticatedFetch(root + '/' + item.id, { signal: abort.signal })
      .then(async r => {
        if (!r.ok) await readApiResponse(r, 'Submitted file unavailable.');
        return r.blob();
      })
      .then(blob => {
        if (abort.signal.aborted) return;
        object = URL.createObjectURL(blob);
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
    <CertificateFilePreview
      url={url}
      mimeType={item.mimeType}
      fileName={item.fileName}
      noun="evidence"
    />
  ) : (
    <p role="status">Loading {item.fileName}…</p>
  );
}
export function CapabilityEvidence({
  submissionId,
  recordId,
}: {
  submissionId: string;
  recordId: string;
}) {
  const root = `/api/capability-submissions/${submissionId}/files/${recordId}`;
  const [items, setItems] = useState<any[]>(),
    [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    authenticatedFetch(root, { signal: abort.signal })
      .then(r => readApiResponse<any>(r, 'Submitted evidence unavailable.'))
      .then(data => {
        if (!abort.signal.aborted) setItems(data.items ?? []);
      })
      .catch(e => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [root]);
  return (
    <section>
      {error ? (
        <p role="alert">{error}</p>
      ) : !items ? (
        <p role="status">Loading evidence snapshot…</p>
      ) : items.length ? (
        items.map(item => <Preview key={item.id} root={root} item={item} />)
      ) : (
        <p className="cap-help">No uploaded supporting files in this submitted snapshot.</p>
      )}
    </section>
  );
}
