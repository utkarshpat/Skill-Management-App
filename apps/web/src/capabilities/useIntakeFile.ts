import { useEffect, useState } from 'react';
import { authenticatedFetch } from '../auth';
import { readApiResponse } from '../api-response';
import type { CertificateFileInfo } from '../certifications/CertificationImage';

function isFileInfo(value: unknown): value is CertificateFileInfo {
  if (!value || typeof value !== 'object') return false;
  return (
    'id' in value &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    'fileName' in value &&
    typeof value.fileName === 'string' &&
    'mimeType' in value &&
    typeof value.mimeType === 'string' &&
    'bytes' in value &&
    typeof value.bytes === 'number' &&
    Number.isFinite(value.bytes) &&
    value.bytes >= 0
  );
}

export function useIntakeFile(root?: string) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({
    root,
    url: '',
    file: undefined as CertificateFileInfo | undefined,
    error: '',
    loading: Boolean(root),
  });
  useEffect(() => {
    if (!root) {
      setState({ root, url: '', file: undefined, error: '', loading: false });
      return;
    }
    const abort = new AbortController();
    let url = '';
    setState({ root, url: '', file: undefined, error: '', loading: true });
    authenticatedFetch(root, { signal: abort.signal })
      .then(r => readApiResponse<{ items?: unknown }>(r, 'Draft file unavailable.'))
      .then(async meta => {
        abort.signal.throwIfAborted();
        if (!Array.isArray(meta.items)) throw Error('Draft file unavailable.');
        const item = meta.items[0];
        if (!meta.items.length) {
          if (!abort.signal.aborted)
            setState({ root, url: '', file: undefined, error: '', loading: false });
          return;
        }
        if (!isFileInfo(item)) throw Error('Draft file unavailable.');
        const response = await authenticatedFetch(root + '/' + encodeURIComponent(item.id), {
          signal: abort.signal,
        });
        if (!response.ok) await readApiResponse(response, 'Draft file unavailable.');
        const blob = await response.blob();
        if (abort.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setState({ root, url, file: item, error: '', loading: false });
      })
      .catch(e => {
        if (!abort.signal.aborted)
          setState({
            root,
            url: '',
            file: undefined,
            error: e instanceof Error ? e.message : 'Draft file unavailable.',
            loading: false,
          });
      });
    return () => {
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [root, attempt]);
  return {
    ...(state.root === root
      ? state
      : { url: '', file: undefined, error: '', loading: Boolean(root) }),
    retry: () => setAttempt(v => v + 1),
  };
}
