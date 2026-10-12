import type { SkillChoice } from '../SkillClaimWizard';
import type { CertificationFields } from '../certifications/types';
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
export function relatedSkillIds(selected: string[], available: string[]) {
  return [...new Set(selected)].filter(id => available.includes(id));
}
export function submissionPayload(
  id: string,
  revision: number,
  skills: SelectedSkill[],
  certifications: SelectedCertificate[],
) {
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
