import { AccessError } from '../../shared/errors.js';

export interface EmploymentDetails {
  jobTitle?: string | null;
  grade?: string | null;
}
function field(value: unknown, max: number, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new AccessError(400, `Enter a valid ${label}.`);
  const cleaned = value.trim();
  if (cleaned.length > max)
    throw new AccessError(400, `${label} must be ${max} characters or fewer.`);
  return cleaned || null;
}
export function employmentDetails(
  body: Record<string, unknown>,
  previous?: EmploymentDetails,
): EmploymentDetails {
  return {
    jobTitle:
      body.jobTitle === undefined
        ? (previous?.jobTitle ?? null)
        : field(body.jobTitle, 100, 'job title'),
    grade: body.grade === undefined ? (previous?.grade ?? null) : field(body.grade, 40, 'grade'),
  };
}
