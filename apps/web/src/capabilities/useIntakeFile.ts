import { useEffect, useState } from 'react';
import { authenticatedFetch } from '../auth';
import { readApiResponse } from '../api-response';
export function useIntakeFile(root?: string) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({
    url: '',
    file: undefined as any,
    error: '',
    loading: false,
  });
  useEffect(() => {
    if (!root) {
      setState({ url: '', file: undefined, error: '', loading: false });
      return;
    }
    const abort = new AbortController();
    let url = '';
    setState({ url: '', file: undefined, error: '', loading: true });
    authenticatedFetch(root, { signal: abort.signal })
      .then(r => readApiResponse<any>(r, 'Draft file unavailable.'))
      .then(async meta => {
        const item = meta.items[0];
        if (!item) {
          if (!abort.signal.aborted)
            setState({ url: '', file: undefined, error: '', loading: false });
          return;
        }
        const response = await authenticatedFetch(root + '/' + item.id, { signal: abort.signal });
        if (!response.ok) await readApiResponse(response, 'Draft file unavailable.');
        const blob = await response.blob();
        if (abort.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setState({ url, file: item, error: '', loading: false });
      })
      .catch(e => {
        if (!abort.signal.aborted)
          setState({ url: '', file: undefined, error: e.message, loading: false });
      });
    return () => {
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [root, attempt]);
  return { ...state, retry: () => setAttempt(v => v + 1) };
}
