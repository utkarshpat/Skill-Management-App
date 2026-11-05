import { readApiResponse } from './api-response';
export type RequestKind = 'REQUEST' | 'INCIDENT';
export const requestCategories = [
  {
    code: 'LEARNING',
    label: 'Learn & Grow',
    description: 'Learning plans, courses or certifications',
  },
  {
    code: 'SKILL',
    label: 'Skills & capability',
    description: 'Skill profile, proficiency or evidence',
  },
  {
    code: 'ASSESSMENT',
    label: 'Assessments & reviews',
    description: 'Assessment or skill review questions',
  },
  {
    code: 'PROJECT',
    label: 'Projects & demand',
    description: 'Project, assignment or demand questions',
  },
  {
    code: 'PROFILE_ACCESS',
    label: 'Profile & access',
    description: 'Profile details, permissions or access',
  },
  {
    code: 'PLATFORM',
    label: 'Platform issues & help',
    description: 'Report a bug or get help from platform administrators',
  },
  { code: 'OTHER', label: 'Something else', description: 'Any other question or service issue' },
] as const;
export type RequestCategory = (typeof requestCategories)[number]['code'];
export const categoryLabel = (code?: string) =>
  requestCategories.find(c => c.code === code)?.label ?? 'Something else';
export const requestStatusLabel = (status: string) =>
  ({
    SUBMITTED: 'Submitted',
    IN_PROGRESS: 'In progress',
    RESOLVED: 'Resolved',
    CANCELLED: 'Cancelled',
  })[status] ?? status;
export interface RequestRecord {
  id: string;
  reference: string;
  category: RequestCategory;
  kind: RequestKind;
  title: string;
  description: string;
  priority: 'NORMAL' | 'HIGH';
  status: 'SUBMITTED' | 'IN_PROGRESS' | 'RESOLVED' | 'CANCELLED';
  revision: number;
  requesterName: string;
  recipientName: string;
  createdAt: string;
  updatedAt: string;
  canComment: boolean;
  canCancel: boolean;
  canStart?: boolean;
  canResolve?: boolean;
  canReassign?: boolean;
}
export interface RequestOptions {
  canRequest: boolean;
  canIncident: boolean;
  categories: { code: RequestCategory; kind: RequestKind }[];
  recipients: {
    id: string;
    name: string;
    kind: RequestKind;
    reportingManager: boolean;
    sameTeam?: boolean;
    reportingLine?: boolean;
    systemAdmin?: boolean;
  }[];
}
export async function requestRead<T>(response: Response): Promise<T> {
  return readApiResponse<T>(response, 'Could not load requests. Try again.');
}
