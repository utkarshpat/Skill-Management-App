import type { SkillChoice } from '../SkillClaimWizard';
import type { CertificationFields } from '../certifications/types';
export interface CertificateSkillSuggestion {
  skill: SkillChoice;
  reason: string;
  certificateId: string;
}

export function credentialSkillDefaults(
  definitions: { name: string; provider: string; relatedSkills?: SkillChoice[] }[],
  fields: { certificationName: string; provider: string },
) {
  const normalize = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase();
  const definition = definitions.find(
    d =>
      normalize(d.name) === normalize(fields.certificationName) &&
      normalize(d.provider) === normalize(fields.provider),
  );
  return (definition?.relatedSkills ?? []).map(skill => ({
    skill,
    reason: 'Catalogue mapping — confirm this skill is supported by your certificate.',
  }));
}

/** Recompute catalogue defaults from saved identity so continuing a draft keeps its suggestions. */
export function activeCertificateSuggestions(
  certificates: Pick<SelectedCertificate, 'id' | 'fields'>[],
  definitions: { name: string; provider: string; relatedSkills?: SkillChoice[] }[],
  suggestions: CertificateSkillSuggestion[],
) {
  const active = suggestions.filter(suggestion =>
    certificates.some(c => c.id === suggestion.certificateId),
  );
  const mapped = certificates.flatMap(c =>
    credentialSkillDefaults(definitions, c.fields).map(suggestion => ({
      ...suggestion,
      certificateId: c.id,
    })),
  );
  return [
    ...new Map(
      [...active, ...mapped].map(suggestion => [
        suggestion.certificateId + ':' + suggestion.skill.id.toLowerCase(),
        suggestion,
      ]),
    ).values(),
  ];
}
export function mergeCertificateSuggestions(
  previous: CertificateSkillSuggestion[],
  certificateId: string,
  incoming: { skill: SkillChoice; reason: string }[],
): CertificateSkillSuggestion[] {
  return [
    ...previous.filter(suggestion => suggestion.certificateId !== certificateId),
    ...incoming.map(suggestion => ({ ...suggestion, certificateId })),
  ];
}
export interface SelectedSkill {
  id: string;
  revision: number;
  choice: SkillChoice;
  reuse: boolean;
  rank: number;
  experienceMonths: number;
  description: string;
  projects: string;
  evidence: string;
  lastUsedOn: string;
}
export interface SelectedCertificate {
  id: string;
  revision: number;
  reuse: boolean;
  fields: CertificationFields;
  skillIds: string[];
  file?: File;
  uploaded: boolean;
  renewedFromId?: string;
  staged?: boolean;
}
export interface Submission {
  id: string;
  revision: number;
  status: string;
  canReroute?: boolean;
  skills: any[];
  certifications: any[];
  intake?: { skills: SelectedSkill[]; certifications: SelectedCertificate[] };
  stagedFiles?: {
    certificationId: string;
    id: string;
    fileName: string;
    mimeType: string;
    bytes: number;
  }[];
}

/** Ordinals alone do not identify the proficiency framework of a historical claim. */
export function submissionLevelName(skill: {
  rank: number;
  levels?: { rank: number; name: string }[];
}) {
  return skill.levels?.find(level => level.rank === skill.rank)?.name ?? '';
}

export function submissionReviewState(status: string, needsReview: boolean, canDecide: boolean) {
  if (canDecide && needsReview) return 'Needs decision';
  return (
    (
      {
        APPROVED: 'Manager reviewed',
        SUBMITTED: 'Awaiting review',
        CHANGES_REQUESTED: 'Changes requested',
        REJECTED: 'Not approved',
        DRAFT: 'Draft',
      } as Record<string, string>
    )[status] ?? status.replaceAll('_', ' ')
  );
}
export function relatedSkillIds(selected: string[], available: string[]) {
  return [...new Set(selected)].filter(id => available.includes(id));
}
export interface CertificateIdentity {
  certificationName: string;
  provider: string;
  credentialId: string;
}
/** Advisory form check. SQL rechecks identity under its transaction for races. */
export function sameCertificate(left: CertificateIdentity, right: CertificateIdentity): boolean {
  const normalize = (value: string) =>
    value
      .replace(/[\t\n\r\u00a0]/g, ' ')
      .trim()
      .replace(/ +/g, ' ')
      .toLowerCase();
  const issuer = normalize(left.provider);
  if (!issuer || issuer !== normalize(right.provider)) return false;
  const name = normalize(left.certificationName),
    printedId = normalize(left.credentialId);
  return Boolean(
    (name && name === normalize(right.certificationName)) ||
    (printedId && printedId === normalize(right.credentialId)),
  );
}

export function submissionPayload(
  id: string,
  revision: number,
  skills: SelectedSkill[],
  certifications: SelectedCertificate[],
  existingCertificates: (CertificateIdentity & { id: string })[] = [],
) {
  for (const c of certifications) {
    if (c.reuse || c.renewedFromId) continue;
    const duplicate =
      certifications.some(
        other =>
          other.id !== c.id && !other.renewedFromId && sameCertificate(c.fields, other.fields),
      ) ||
      existingCertificates.some(
        other => other.id.toLowerCase() !== c.id.toLowerCase() && sameCertificate(c.fields, other),
      );
    if (duplicate)
      throw Error(
        'This certification already exists. Link the existing certificate, continue its draft, or use Renew.',
      );
  }
  return {
    id,
    revision,
    skills: skills.map(s => ({
      id: s.id,
      revision: s.revision,
      skillId: s.choice.id,
      ...(!s.reuse
        ? {
            fields: {
              definitionRevision: s.choice.definitionRevision,
              rank: s.rank,
              experienceMonths: s.experienceMonths,
              description: s.description,
              projects: s.projects,
              evidence: s.evidence,
              lastUsedOn: s.lastUsedOn || null,
            },
          }
        : {}),
    })),
    certifications: certifications.map(c => ({
      id: c.id,
      revision: c.revision,
      skillIds: relatedSkillIds(
        c.skillIds,
        skills.map(s => s.choice.id),
      ),
      ...(!c.reuse ? { fields: c.fields } : {}),
      ...(c.renewedFromId ? { renewedFromId: c.renewedFromId } : {}),
    })),
  };
}
