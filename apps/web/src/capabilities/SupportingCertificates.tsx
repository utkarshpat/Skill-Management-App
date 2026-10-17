import { Award } from 'lucide-react';
import type { CertificationRecord } from '../certifications/types';
import {
  certificationStatusLabels,
  credentialValidity,
} from '../certifications/certification-model';

export const uniqueCertificates = (records: CertificationRecord[]) =>
  Array.from(new Map(records.map(record => [record.id.toLowerCase(), record])).values());
export function indexCertificatesBySkill(records: CertificationRecord[]) {
  const index = new Map<string, CertificationRecord[]>();
  for (const record of uniqueCertificates(records)) {
    if (record.supersededById) continue;
    for (const id of new Set(record.relatedSkills?.map(skill => skill.id.toLowerCase()))) {
      const entries = index.get(id);
      if (entries) entries.push(record);
      else index.set(id, [record]);
    }
  }
  return index;
}
export const certificatesForSkill = (records: CertificationRecord[], skillId: string) =>
  indexCertificatesBySkill(records).get(skillId.toLowerCase()) ?? [];

export function SupportingCertificates({
  records,
  index,
  skillId,
  onOpen,
  disabled = false,
  today = new Date().toISOString().slice(0, 10),
}: {
  records: CertificationRecord[];
  index?: ReturnType<typeof indexCertificatesBySkill>;
  skillId: string;
  onOpen: (id: string) => void;
  disabled?: boolean;
  today?: string;
}) {
  const certificates = index
    ? (index.get(skillId.toLowerCase()) ?? [])
    : certificatesForSkill(records, skillId);
  if (!certificates.length) return null;
  return (
    <details className="skills-supporting-certificates">
      <summary>
        <Award size={14} /> {certificates.length}{' '}
        {certificates.length === 1 ? 'certificate' : 'certificates'}
      </summary>
      <div>
        {certificates.map(c => (
          <button key={c.id} type="button" disabled={disabled} onClick={() => onOpen(c.id)}>
            <strong>{c.certificationName}</strong>
            <small>
              {certificationStatusLabels[c.status]} · {credentialValidity(c.expiryDate, today)}
              {c.expiryDate && ` · ${c.expiryDate}`}
            </small>
          </button>
        ))}
      </div>
    </details>
  );
}
