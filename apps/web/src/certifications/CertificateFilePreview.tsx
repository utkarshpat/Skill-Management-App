import { Download, Eye, FileText } from 'lucide-react';
import { CertificatePdfPreview } from './CertificatePdfPreview';

export function CertificateFilePreview({
  url,
  mimeType,
  fileName,
  className = '',
}: {
  url: string;
  mimeType: string;
  fileName: string;
  className?: string;
}) {
  const image = mimeType.startsWith('image/');
  const pdf = mimeType === 'application/pdf';
  const canOpen = image || pdf || mimeType === 'text/plain';
  return (
    <div className="certificate-file-preview">
      {image ? (
        <a href={url} target="_blank" rel="noopener noreferrer" aria-label="Open certificate image">
          <img className={className || undefined} src={url} alt="Certificate preview" />
        </a>
      ) : pdf ? (
        <CertificatePdfPreview url={url} fileName={fileName} />
      ) : (
        <FileText size={32} aria-hidden="true" />
      )}
      <span title={fileName}>{fileName}</span>
      <div className="certificate-preview-actions">
        {canOpen && (
          <a
            className="secondary-button"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`View ${fileName}`}
          >
            <Eye size={16} aria-hidden="true" /> View certificate
          </a>
        )}
        <a
          className="secondary-button"
          href={url}
          download={fileName}
          aria-label={`Download ${fileName}`}
        >
          <Download size={16} aria-hidden="true" /> Download
        </a>
      </div>
      {!canOpen && (
        <p className="cert-help">Download this document to view it in Word or a compatible app.</p>
      )}
      {pdf && (
        <p className="cert-help">
          If the preview is unavailable, use View certificate or Download.
        </p>
      )}
    </div>
  );
}
