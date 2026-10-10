import { certificatePreviewUrl } from './certificate-preview-url';
import { CertificateFilePreview } from './CertificateFilePreview';
export { CertificateFilePreview } from './CertificateFilePreview';
import { useEffect, useRef, useState } from 'react';
import { FileText, ImagePlus, Upload } from 'lucide-react';
import { authenticatedFetch } from '../auth';
import { readApiResponse } from '../api-response';
import { prepareCertificateFile } from './certificate-file';
export { prepareCertificateFile } from './certificate-file';

export interface CertificateFileInfo {
  id: string;
  fileName: string;
  mimeType: string;
  bytes: number;
}

export function useCertificationImage(id?: string) {
  const [state, setState] = useState({
    id,
    url: '',
    loading: Boolean(id),
    error: '',
    file: undefined as CertificateFileInfo | undefined,
  });
  useEffect(() => {
    if (!id) {
      setState({ id, url: '', loading: false, error: '', file: undefined });
      return;
    }
    const controller = new AbortController();
    let url = '';
    setState({ id, url: '', loading: true, error: '', file: undefined });
    const root = `/api/certifications/${encodeURIComponent(id)}/image`;
    (async () => {
      const result = await readApiResponse<{ items: CertificateFileInfo[] }>(
        await authenticatedFetch(root, { signal: controller.signal }),
        'Certificate file could not be loaded.',
      );
      controller.signal.throwIfAborted();
      const file = result.items[0];
      if (file) {
        const response = await authenticatedFetch(`${root}/${encodeURIComponent(file.id)}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw Error('Certificate file could not be loaded.');
        url = await certificatePreviewUrl(() => response.blob(), controller.signal);
        if (controller.signal.aborted) {
          URL.revokeObjectURL(url);
          url = '';
          return;
        }
      }
      if (!controller.signal.aborted) setState({ id, url, loading: false, error: '', file });
    })().catch(e => {
      if (!controller.signal.aborted)
        setState({ id, url: '', loading: false, error: e.message, file: undefined });
    });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);
  return state.id === id ? state : { url: '', loading: Boolean(id), error: '', file: undefined };
}

export function CertificateImageUploader({
  url,
  file,
  loading,
  error,
  busy,
  available,
  onChange,
  onBusy,
}: {
  url: string;
  file?: CertificateFileInfo;
  loading: boolean;
  error: string;
  busy: boolean;
  available: boolean;
  onChange: (file: File) => void;
  onBusy: (busy: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null),
    locked = useRef(false);
  const mounted = useRef(true);
  const [dragging, setDragging] = useState(false),
    [localError, setLocalError] = useState('');
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const disabled = busy || loading || !available;
  async function choose(files: FileList | null) {
    if (disabled || locked.current || !files?.length) return;
    if (files.length !== 1) {
      setLocalError('Choose one certificate file.');
      return;
    }
    locked.current = true;
    onBusy(true);
    setLocalError('');
    try {
      const prepared = await prepareCertificateFile(files[0]);
      if (mounted.current) onChange(prepared);
    } catch (e) {
      if (mounted.current)
        setLocalError(e instanceof Error ? e.message : 'File could not be opened.');
    } finally {
      locked.current = false;
      if (mounted.current) onBusy(false);
      if (input.current) input.current.value = '';
    }
  }
  const displayedFile = file;
  return (
    <section className="certificate-image-uploader" aria-label="Certificate file">
      <h3>
        Certificate file{' '}
        <span className="cert-required-mark" aria-hidden="true">
          *
        </span>
        <span className="sr-only"> required</span>
      </h3>
      <div
        className={`certificate-dropzone${dragging ? ' dragging' : ''}`}
        onDragOver={e => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => {
          e.preventDefault();
          setDragging(false);
          void choose(e.dataTransfer.files);
        }}
      >
        {url && displayedFile ? (
          <CertificateFilePreview
            url={url}
            mimeType={displayedFile.mimeType}
            fileName={displayedFile.fileName}
          />
        ) : (
          <>
            <ImagePlus size={32} aria-hidden="true" />
            <p>
              {loading ? 'Loading certificate file...' : 'Drag and drop your certificate file here'}
            </p>
          </>
        )}
        <input
          ref={input}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.txt,application/pdf,image/jpeg,image/png,image/webp,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
          aria-label="Choose certificate file"
          aria-required="true"
          disabled={disabled}
          className="sr-only"
          tabIndex={-1}
          onChange={e => void choose(e.target.files)}
        />
        <div className="certificate-image-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={disabled}
            onClick={() => input.current?.click()}
          >
            <Upload size={16} aria-hidden="true" />
            {url ? 'Replace file' : 'Browse files'}
          </button>
        </div>
        <p className="cert-help">
          PDF, JPEG, PNG, WebP, DOCX or TXT · up to 5 MB. Images are compressed automatically.
        </p>
      </div>
      {!available && <p className="cert-help">Certificate file storage is not configured.</p>}
      {(error || localError) && <p role="alert">{error || localError}</p>}
    </section>
  );
}

export function CertificationImage({ id }: { id: string }) {
  const state = useCertificationImage(id);
  return (
    <section className="certificate-image-uploader">
      <h3>Certificate file</h3>
      {state.url && state.file ? (
        <CertificateFilePreview
          url={state.url}
          mimeType={state.file.mimeType}
          fileName={state.file.fileName}
          className="certificate-read-image"
        />
      ) : (
        <p className="cert-help">
          {state.loading
            ? 'Loading certificate file...'
            : state.error || 'No certificate file attached.'}
        </p>
      )}
    </section>
  );
}
