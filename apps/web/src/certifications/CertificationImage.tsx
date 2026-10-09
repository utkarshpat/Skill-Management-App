import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Upload } from 'lucide-react';
import { authenticatedFetch } from '../auth';
import { readApiResponse } from '../api-response';
import { compressEvidenceImage } from '../evidence-image';

export function useCertificationImage(id?: string) {
  const [state, setState] = useState({ url: '', loading: Boolean(id), error: '' });
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    let url = '';
    setState({ url: '', loading: true, error: '' });
    const root = `/api/certifications/${encodeURIComponent(id)}/image`;
    (async () => {
      const result = await readApiResponse<{ items: { id: string }[] }>(
        await authenticatedFetch(root, { signal: controller.signal }),
        'Certificate image could not be loaded.',
      );
      if (result.items[0]) {
        const response = await authenticatedFetch(
          `${root}/${encodeURIComponent(result.items[0].id)}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw Error('Certificate image could not be loaded.');
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
      }
      if (!controller.signal.aborted) setState({ url, loading: false, error: '' });
    })().catch(e => {
      if (!controller.signal.aborted) setState({ url: '', loading: false, error: e.message });
    });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);
  return state;
}

export function CertificateImageUploader({
  url,
  loading,
  error,
  busy,
  available,
  onChange,
  onBusy,
}: {
  url: string;
  loading: boolean;
  error: string;
  busy: boolean;
  available: boolean;
  onChange: (image: Blob) => void;
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
  const disabled = busy || loading || !available || Boolean(error);
  async function choose(files: FileList | null) {
    if (disabled || locked.current || !files?.length) return;
    if (files.length !== 1) {
      setLocalError('Choose one certificate image.');
      return;
    }
    locked.current = true;
    onBusy(true);
    setLocalError('');
    try {
      const image = await compressEvidenceImage(files[0], 5);
      if (mounted.current) onChange(image);
    } catch (e) {
      if (mounted.current)
        setLocalError(e instanceof Error ? e.message : 'Image could not be opened.');
    } finally {
      locked.current = false;
      if (mounted.current) onBusy(false);
      if (input.current) input.current.value = '';
    }
  }
  return (
    <section className="certificate-image-uploader" aria-label="Certificate image">
      <h3>
        Certificate image <span className="cert-help">Required</span>
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
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open certificate image"
          >
            <img src={url} alt="Certificate image preview" />
          </a>
        ) : (
          <>
            <ImagePlus size={32} aria-hidden="true" />
            <p>
              {loading
                ? 'Loading certificate image...'
                : 'Drag and drop your certificate image here'}
            </p>
          </>
        )}
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-label="Choose certificate image"
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
            {url ? 'Replace image' : 'Browse image'}
          </button>
        </div>
        <p className="cert-help">
          JPEG, PNG or WebP up to 5 MB. Automatically compressed below 1 MB. Saved with your draft;
          shared with your assigned manager when submitted.
        </p>
      </div>
      {!available && <p className="cert-help">Certificate image storage is not configured.</p>}
      {(error || localError) && <p role="alert">{error || localError}</p>}
    </section>
  );
}
export function CertificationImage({ id }: { id: string }) {
  const state = useCertificationImage(id);
  return (
    <section className="certificate-image-uploader">
      <h3>Certificate image</h3>
      {state.url ? (
        <a href={state.url} target="_blank" rel="noopener noreferrer">
          <img className="certificate-read-image" src={state.url} alt="Certificate image" />
        </a>
      ) : (
        <p className="cert-help">
          {state.loading
            ? 'Loading certificate image...'
            : state.error || 'No certificate image attached.'}
        </p>
      )}
    </section>
  );
}
