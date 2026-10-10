import { Download, FileText } from 'lucide-react';

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
  if (mimeType.startsWith('image/'))
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" aria-label="Open certificate image">
        <img className={className || undefined} src={url} alt="Certificate preview" />
      </a>
    );
  const canOpen = mimeType === 'application/pdf' || mimeType === 'text/plain';
  return (
    <div className="certificate-file-preview">
      <FileText size={32} aria-hidden="true" />
      <span title={fileName}>{fileName}</span>
      {canOpen && (
        <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${fileName}`}>
          Open file
        </a>
      )}
      <a href={url} download={fileName} aria-label={`Download ${fileName}`}>
        <Download size={16} aria-hidden="true" /> Download file
      </a>
    </div>
  );
}
