import type { CertificationRecord } from './types';

export function csvCell(value: string | number | undefined | null): string {
  const text = value === undefined || value === null ? '' : String(value);
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}
export function generateCertificationsCsv(records: CertificationRecord[]): string {
  const headers = [
    'Sr NO',
    'Name',
    'Employee Code',
    'DU',
    'Category',
    'Certification Name',
    'Certification Date',
    'Does Not Expire',
    'Expiry Date',
    'Active',
    'Email ID',
    'Email Type',
    'Provider',
    'Review Status',
    'Verified',
    'Credential ID',
    'Issuer Verification URL',
  ];
  return (
    '\uFEFF' +
    [
      headers,
      ...records.map((item, index) => [
        index + 1,
        item.name,
        item.employeeCode,
        item.du,
        item.category,
        item.certificationName,
        item.certificationDate,
        item.doesNotExpire,
        item.expiryDate,
        item.active,
        '',
        '',
        item.provider,
        item.status,
        item.verified ? 'Yes' : 'No',
        item.credentialId,
        item.credentialUrl,
      ]),
    ]
      .map(row => row.map(csvCell).join(','))
      .join('\r\n')
  );
}
export function downloadCertificationsCsv(
  records: CertificationRecord[],
  filename = `certifications-${new Date().toISOString().slice(0, 10)}.csv`,
): void {
  const url = URL.createObjectURL(
    new Blob([generateCertificationsCsv(records)], { type: 'text/csv;charset=utf-8' }),
  );
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    URL.revokeObjectURL(url);
  }
}
