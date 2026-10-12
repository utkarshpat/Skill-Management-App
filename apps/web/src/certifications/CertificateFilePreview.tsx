import { Download, Eye, FileText, Upload } from 'lucide-react';
import { CertificatePdfPreview } from './CertificatePdfPreview';

export function CertificateFilePreview({
  url,
  mimeType,
  fileName,
  className = '',
  noun = 'certificate',
  onReplace,
  disabled = false,
}: {
  url: string;
  mimeType: string;
  fileName: string;
  className?: string;
  noun?: 'certificate' | 'evidence';
  onReplace?: () => void;
  disabled?: boolean;
}) {
  const image = mimeType.startsWith('image/');
  const pdf = mimeType === 'application/pdf';
  const canOpen = image || pdf || mimeType === 'text/plain';
  const hasVisualPreview = image || pdf;

  return (
    <div
      className={`certificate-file-preview${hasVisualPreview ? ' has-visual-preview' : ' is-document'}`}
    >
      <div className="certificate-preview-overlay">
        <span className="certificate-preview-filename" title={fileName}>
          {fileName}
        </span>
        <div className="certificate-preview-actions">
          {canOpen && (
            <a
              className={hasVisualPreview ? 'certificate-overlay-btn' : 'secondary-button'}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`View ${noun}`}
            >
              <Eye size={13} aria-hidden="true" /> View {noun}
            </a>
          )}
          <a
            className={hasVisualPreview ? 'certificate-overlay-btn' : 'secondary-button'}
            href={url}
            download={fileName}
            aria-label={`Download ${fileName}`}
          >
            <Download size={13} aria-hidden="true" /> Download
          </a>
          {onReplace && (
            <button
              type="button"
              className={hasVisualPreview ? 'certificate-overlay-btn' : 'secondary-button'}
              disabled={disabled}
              onClick={onReplace}
              aria-label="Replace file"
            >
              <Upload size={13} aria-hidden="true" /> Replace
            </button>
          )}
        </div>
      </div>
      {image ? (
        <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${noun} image`}>
          <img
            className={className || undefined}
            src={url}
            alt={`${noun === 'certificate' ? 'Certificate' : 'Evidence'} preview`}
          />
        </a>
      ) : pdf ? (
        <CertificatePdfPreview url={url} fileName={fileName} />
      ) : (
        <FileText size={32} aria-hidden="true" />
      )}
      {!canOpen && (
        <p className="cert-help">Download this document to view it in Word or a compatible app.</p>
      )}
    </div>
  );
}
