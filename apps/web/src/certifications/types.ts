export type CertificationStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'CHANGES_REQUESTED'
  | 'REJECTED';

export interface CertificationRecord {
  srNo: number;
  id: string;
  name: string;
  employeeCode: string;
  du: string;
  category: string;
  certificationName: string;
  certificationDate: string; // YYYY-MM-DD
  doesNotExpire: 'Yes' | 'No';
  expiryDate: string; // YYYY-MM-DD (e.g. 2050-12-31 if Does Not Expire)
  active: 'Y' | 'N';
  emailId: string;
  emailType: string;
  provider: string; // e.g. Oracle, AWS, Microsoft, Google
  credentialId?: string;
  credentialUrl?: string;
  evidenceUrl?: string;
  evidenceFileName?: string;
  status: CertificationStatus;
  feedbackNote?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  submittedAt?: string;
  verified: boolean;
}

export interface ExtractedCertificationDetails {
  certificationName?: string;
  provider?: string;
  category?: string;
  certificationDate?: string;
  doesNotExpire?: 'Yes' | 'No';
  expiryDate?: string;
  credentialId?: string;
  credentialUrl?: string;
  recipientName?: string;
  confidenceScore?: number;
}
