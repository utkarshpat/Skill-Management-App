import type { CertificationFields, CertificationRecord, CertificationStatus } from './types';
export const certificationStatusLabels: Record<CertificationStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Awaiting manager review',
  APPROVED: 'Manager reviewed',
  CHANGES_REQUESTED: 'Changes requested',
  REJECTED: 'Not approved',
};
export function credentialValidity(expiry: string | null, today: string) {
  if (!expiry) return 'No expiry';
  if (expiry < today) return 'Expired';
  const days = (Date.parse(expiry + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86400000;
  return days <= 90 ? 'Expires soon' : 'Current';
}
export function certificationIdentityError(fields: CertificationFields) {
  if (!fields.certificationName.trim() || fields.certificationName.trim().length > 200)
    return 'Enter a certification name (up to 200 characters).';
  if (!fields.provider.trim() || fields.provider.trim().length > 120)
    return 'Enter an issuer (up to 120 characters).';
  if (!fields.category.trim() || fields.category.trim().length > 80)
    return 'Enter a category (up to 80 characters).';
  return '';
}
export function certificationFieldError(fields: CertificationFields, today: string) {
  const identityError = certificationIdentityError(fields);
  if (identityError) return identityError;
  const validDay = (value: string) =>
    /^20\d{2}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + 'T12:00:00Z')) &&
    new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value;
  if (!validDay(fields.certificationDate) || fields.certificationDate > today)
    return 'Choose a valid issue date that is not in the future.';
  if (
    fields.expiryDate !== null &&
    (!validDay(fields.expiryDate) || fields.expiryDate < fields.certificationDate)
  )
    return 'Expiry date must be on or after the issue date.';
  if (fields.credentialUrl) {
    try {
      const url = new URL(fields.credentialUrl);
      if (url.protocol !== 'https:' || url.username || url.password)
        return 'Use a valid HTTPS issuer or badge URL.';
    } catch {
      return 'Use a valid HTTPS issuer or badge URL.';
    }
  }
  if (
    fields.credentialUrl.length > 1000 ||
    fields.credentialId.length > 200 ||
    fields.notes.length > 2000
  )
    return 'Shorten the credential link, ID or notes.';
  return '';
}
export const emptyCertification = (): CertificationFields => ({
  certificationName: '',
  provider: '',
  category: '',
  certificationDate: '',
  expiryDate: null,
  credentialId: '',
  credentialUrl: '',
  notes: '',
});
export function certificationFields(record: CertificationRecord): CertificationFields {
  const {
    certificationName,
    provider,
    category,
    certificationDate,
    expiryDate,
    credentialId,
    credentialUrl,
    notes,
  } = record;
  return {
    certificationName,
    provider,
    category,
    certificationDate,
    expiryDate,
    credentialId,
    credentialUrl,
    notes,
  };
}
