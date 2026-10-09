import type { CertificationRecord } from './types';

export function csvCell(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return '""';
  const text = String(value);
  // Prevent CSV injection by prepending apostrophe if cell starts with =, +, -, @
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export function generateCertificationsCsv(records: CertificationRecord[]): string {
  const headers = [
    'Name',
    'Employee Code',
    'Category',
    'Certification Name',
    'Certification Date',
    'Does Not Expire',
    'Expiry Date',
    'Review status',
  ];

  const rows = records.map(item => [
    item.name,
    item.employeeCode,
    item.category,
    item.certificationName,
    item.certificationDate,
    item.expiryDate === null ? 'Yes' : 'No',
    item.expiryDate,
    item.status,
  ]);

  const csvContent = [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');

  // Prefix UTF-8 BOM so Excel opens it with proper UTF-8 encoding
  return '\uFEFF' + csvContent;
}

export function downloadCertificationsCsv(
  records: CertificationRecord[],
  filename = `certifications-capability-report-${new Date().toISOString().slice(0, 10)}.csv`,
): void {
  const csv = generateCertificationsCsv(records);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
