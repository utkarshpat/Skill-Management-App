export type CertificationStatus =
  'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';
export type CertificationView = 'mine' | 'queue' | 'directory';
export interface CertificationFields {
  certificationName: string;
  provider: string;
  category: string;
  certificationDate: string;
  expiryDate: string | null;
  credentialId: string;
  credentialUrl: string;
}
export interface CertificationRecord extends CertificationFields {
  id: string;
  personId: string;
  reviewerId: string | null;
  revision: number;
  name: string;
  employeeCode: string;
  du: string;
  doesNotExpire: 'Yes' | 'No';
  active: 'Y' | 'N';
  status: CertificationStatus;
  verified: boolean;
  feedbackNote: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  submittedAt: string | null;
  canEdit: boolean;
  canReview: boolean;
  reviewReason: string;
  routingMismatch: boolean;
  history: { revision: number; action: string; at: string; actorName: string; feedback?: string }[];
}
export interface CertificationPage {
  items: CertificationRecord[];
  total: number;
  activeCount: number;
  expiringSoonCount: number;
  revision: number;
  page: number;
  pageSize: number;
}
export interface CertificationChange {
  id: string;
  revision: number;
  action: 'SAVE' | 'SUBMIT' | 'REROUTE' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';
  fields?: CertificationFields;
  feedback?: string;
}
export const statusLabel: Record<CertificationStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Awaiting review',
  APPROVED: 'Approved',
  CHANGES_REQUESTED: 'Changes requested',
  REJECTED: 'Rejected',
};
export function issuerLink(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}
