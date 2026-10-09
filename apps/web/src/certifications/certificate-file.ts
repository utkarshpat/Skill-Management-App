import { compressEvidenceImage } from '../evidence-image';

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
};

export async function prepareCertificateFile(source: File): Promise<File> {
  if (!source.size || source.size > MAX_FILE_SIZE)
    throw Error('Choose a certificate file up to 5 MB.');
  const extension = source.name.split('.').pop()?.toLowerCase() ?? '',
    mimeType = source.type || MIME_BY_EXTENSION[extension];
  if (!mimeType || MIME_BY_EXTENSION[extension] !== mimeType)
    throw Error('Choose a PDF, JPEG, PNG, WebP, DOCX or TXT file.');
  if (mimeType.startsWith('image/')) {
    const compressed = await compressEvidenceImage(source, 5),
      stem = source.name.replace(/\.[^.]*$/, '').slice(0, 220) || 'certificate';
    return new File([compressed], `${stem}.webp`, { type: 'image/webp' });
  }
  return new File([source], source.name, { type: mimeType });
}
