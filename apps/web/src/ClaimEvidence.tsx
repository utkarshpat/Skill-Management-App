import { useEffect, useRef, useState } from 'react';
import { ImagePlus, RefreshCw, ExternalLink, FileText } from 'lucide-react';
import { authenticatedFetch } from './auth';
import type { Claim } from './MySkills';
import { prepareSkillEvidenceFile } from './evidence-image';
import { EvidenceVisibility } from './EvidenceVisibility';
import { notify } from './toast';
import './claim-evidence.css';
interface ImageItem {
  id: string;
  bytes: number;
  width: number | null;
  height: number | null;
  mimeType?: string;
  fileName?: string;
}
interface State {
  revision: number;
  canUpload: boolean;
  items: ImageItem[];
}
function EvidenceThumbnail({
  url,
  index,
  item,
  onUseAsCertificate,
}: {
  url: string;
  index: number;
  item: ImageItem;
  onUseAsCertificate?: (file: File) => void;
}) {
  const [src, setSrc] = useState(''),
    [failed, setFailed] = useState(false);
  const [usingCertificate, setUsingCertificate] = useState(false);
  const promotion = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => promotion.current?.abort(), [url]);
  useEffect(() => {
    const c = new AbortController();
    setSrc('');
    setFailed(false);
    let object = '';
    authenticatedFetch(url, { signal: c.signal })
      .then(async r => {
        if (!r.ok) throw Error();
        return r.blob();
      })
      .then(blob => {
        if (!c.signal.aborted) {
          object = URL.createObjectURL(blob);
          setSrc(object);
        }
      })
      .catch(() => {
        if (!c.signal.aborted) setFailed(true);
      });
    return () => {
      c.abort();
      if (object) URL.revokeObjectURL(object);
    };
  }, [url]);
  return src ? (
    <>
      {item.mimeType === 'application/pdf' ? (
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="claim-image-preview"
          aria-label={`View ${item.fileName ?? 'evidence.pdf'}`}
        >
          <div className="claim-document-preview">
            <FileText size={32} aria-hidden="true" />
            <strong title={item.fileName}>{item.fileName ?? 'evidence.pdf'}</strong>
          </div>
          <span>
            <ExternalLink size={14} /> View PDF
          </span>
        </a>
      ) : (
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="claim-image-preview"
          aria-label={`Open evidence image ${index + 1}`}
        >
          <img src={src} alt={`Evidence image ${index + 1}`} />
          <span>
            <ExternalLink size={14} />
            View image
          </span>
        </a>
      )}
      {onUseAsCertificate && (
        <button
          type="button"
          className="secondary-button"
          disabled={usingCertificate}
          onClick={async () => {
            if (promotion.current) return;
            const abort = new AbortController();
            promotion.current = abort;
            setUsingCertificate(true);
            try {
              const response = await authenticatedFetch(url, { signal: abort.signal });
              if (!response.ok) throw Error('Evidence could not be opened.');
              const blob = await response.blob();
              if (abort.signal.aborted) return;
              onUseAsCertificate(
                new File([blob], item.fileName ?? 'evidence.webp', {
                  type: item.mimeType ?? blob.type,
                }),
              );
            } catch (e) {
              if (!abort.signal.aborted) notify((e as Error).message, 'error');
            } finally {
              if (promotion.current === abort) promotion.current = undefined;
              if (!abort.signal.aborted) setUsingCertificate(false);
            }
          }}
        >
          {usingCertificate ? 'Opening file…' : 'Use as certificate'}
        </button>
      )}
    </>
  ) : (
    <div className="claim-image-placeholder">{failed ? 'File unavailable' : 'Loading file…'}</div>
  );
}
export function ClaimEvidence({
  claim,
  reviewer = false,
  onRevision,
  onBusy,
  onUseAsCertificate,
}: {
  claim: Claim;
  reviewer?: boolean;
  onRevision?: (revision: number) => void;
  onBusy?: (busy: boolean) => void;
  onUseAsCertificate?: (file: File) => void;
}) {
  const [state, setState] = useState<State>(),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0);
  const uploadController = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => uploadController.current?.abort(), []);
  const root = `${reviewer ? '/api/skill-reviews' : '/api/my-skills'}/${encodeURIComponent(claim.id)}/evidence`;
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setError('');
    authenticatedFetch(root, { signal: c.signal })
      .then(async r => {
        const data = await r.json();
        if (!r.ok) throw Error(data?.error?.message ?? 'Evidence is unavailable.');
        return data as State;
      })
      .then(data => {
        if (!c.signal.aborted) setState(data);
      })
      .catch(e => {
        if (!c.signal.aborted) {
          setState(undefined);
          setError(e.message);
        }
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [root, attempt]);
  async function upload(file?: File) {
    if (!file || !state || busy) return;
    const controller = new AbortController();
    uploadController.current = controller;
    setBusy(true);
    onBusy?.(true);
    setError('');
    try {
      const image = await prepareSkillEvidenceFile(file);
      if (controller.signal.aborted) return;
      const r = await authenticatedFetch(root, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': image.type,
          'X-Claim-Revision': String(state.revision),
          'X-Evidence-File-Name': encodeURIComponent(file.name),
        },
        body: image,
      });
      const data = await r.json();
      if (!r.ok) throw Error(data?.error?.message ?? 'File upload failed.');
      if (!controller.signal.aborted) {
        setState(data);
        onRevision?.(data.revision);
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        const message = e instanceof Error ? e.message : 'File upload failed.';
        setError(message);
        notify(message, 'error');
      }
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false);
        onBusy?.(false);
      }
      uploadController.current = undefined;
    }
  }

  const links = (claim.evidence ?? '')
    .split(/\s+/)
    .filter(value => /^https:\/\/[^\s]+$/i.test(value));
  return (
    <div className="claim-evidence">
      <p className="claim-evidence-text">{claim.evidence || 'No evidence references added.'}</p>
      {links.length > 0 && (
        <div className="claim-evidence-links">
          {links.slice(0, 8).map((link, i) => (
            <a key={i} href={link} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={14} />
              Open reference {i + 1}
            </a>
          ))}
        </div>
      )}
      <EvidenceVisibility status={claim.status} reviewer={reviewer} />
      {loading && <p role="status">Loading evidence files…</p>}
      {error && (
        <div className="claim-evidence-error">
          <span>{error}</span>
          <button
            type="button"
            className="secondary-button"
            disabled={loading || busy}
            onClick={() => setAttempt(n => n + 1)}
          >
            Retry files
          </button>
        </div>
      )}
      {state && (
        <>
          <div className="claim-evidence-heading">
            <strong>
              Files <span>{state.items.length}/6</span>
            </strong>
            {state.canUpload && !reviewer && (
              <label className={'claim-image-upload' + (busy ? ' busy' : '')}>
                {busy ? <RefreshCw className="review-spin" size={16} /> : <ImagePlus size={16} />}{' '}
                {busy ? 'Preparing & uploading…' : 'Add file'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  disabled={busy || state.items.length >= 6}
                  onChange={e => {
                    void upload(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>
            )}
          </div>
          {state.items.length ? (
            <div className="claim-image-grid">
              {state.items.map((item, i) => (
                <div key={item.id}>
                  <EvidenceThumbnail
                    url={root + '/' + item.id}
                    index={i}
                    item={item}
                    onUseAsCertificate={
                      state.canUpload && !reviewer ? onUseAsCertificate : undefined
                    }
                  />
                  <small>
                    {Math.ceil(item.bytes / 1024)} KB
                    {item.width && item.height ? ` · ${item.width} × ${item.height}` : ''}
                  </small>
                </div>
              ))}
            </div>
          ) : (
            <p className="claim-evidence-empty">
              {reviewer ? 'No uploaded evidence in this submission.' : 'No uploaded evidence yet.'}
            </p>
          )}
          {state.canUpload && !reviewer && (
            <small>PDF, JPEG, PNG or WebP · up to 10 MB · images compressed automatically</small>
          )}
        </>
      )}
    </div>
  );
}
