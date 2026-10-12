import { Award } from 'lucide-react';
import type { CertificationRecord } from '../certifications/types';
import {
  certificationStatusLabels,
  credentialValidity,
} from '../certifications/certification-model';

export const uniqueCertificates = (records: CertificationRecord[]) =>
  Array.from(new Map(records.map(record => [record.id.toLowerCase(), record])).values());
export const certificatesForSkill = (records: CertificationRecord[], skillId: string) =>
  uniqueCertificates(records).filter(record =>
    record.relatedSkills?.some(skill => skill.id.toLowerCase() === skillId.toLowerCase()),
  );

export function SupportingCertificates({
  records,
  skillId,
  onOpen,
  disabled = false,
  today = new Date().toISOString().slice(0, 10),
}: {
  records: CertificationRecord[];
  skillId: string;
  onOpen: (id: string) => void;
  disabled?: boolean;
  today?: string;
}) {
  const certificates = certificatesForSkill(records, skillId);
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
