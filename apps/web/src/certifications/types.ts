export type CertificationStatus =
  'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';
export interface CertificationFields {
  certificationName: string;
  provider: string;
  category: string;
  certificationDate: string;
  expiryDate: string | null;
  credentialId: string;
  credentialUrl: string;
  notes: string;
}
export interface CertificationRecord extends CertificationFields {
  hasImage?: boolean;
  id: string;
  revision: number;
  personId: string;
  reviewerId?: string;
  name: string;
  employeeCode: string;
  status: CertificationStatus;
  feedback: string;
  reviewedBy?: string;
  reviewedAt?: string;
  submittedAt?: string;
  canEdit: boolean;
  canSubmit: boolean;
  canReview: boolean;
  reviewAccess?: { allowed: boolean; reasonCode: string };
}
export interface CertificationPage {
  canUploadImage?: boolean;
  records: CertificationRecord[];
  total: number;
  page: number;
  pageSize: number;
  canManage: boolean;
  canSubmitNew: boolean;
  canReview: boolean;
}
