import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Award,
  Check,
  ChevronRight,
  Plus,
  Search,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import { compressEvidenceImage } from '../evidence-image';
import { ClaimEvidence } from '../ClaimEvidence';
import type { Claim } from '../MySkills';
import { FormDialog } from '../FormDialog';
import { authenticatedFetch } from '../auth';
import { readApiResponse } from '../api-response';
import { toast } from '../toast';
import type { CertificationFields } from '../certifications/types';
import type { SkillChoice } from '../SkillClaimWizard';
import {
  CertificateFilePreview,
  CertificateImageUploader,
  useCertificationImage,
} from '../certifications/CertificationImage';
import {
  addCredentialMonths,
  emptyCertification,
  certificationFieldError,
  certificationFields,
} from '../certifications/certification-model';
import { skillDateError } from '../skill-dates';
import {
  relatedSkillIds,
  submissionPayload,
  type SelectedSkill,
  type SelectedCertificate,
  type Submission,
} from './capability-model';
import '../certifications/certifications.css';
import './capabilities.css';
import { useIntakeFile } from './useIntakeFile';
const root = '/api/capability-submissions';
async function json<T>(path: string, body?: object, signal?: AbortSignal) {
  return readApiResponse<T>(
    await authenticatedFetch(path, {
      ...(body
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        : {}),
      signal,
    }),
    'Your changes could not be confirmed.',
  );
}
function FileCard({
  certificate,
  busy,
  onFile,
  onBusy,
  submissionId,
  fileAvailable,
  onStoredFile,
}: {
  certificate: SelectedCertificate;
  busy: boolean;
  onFile: (file: File) => void;
  onBusy: (busy: boolean) => void;
  submissionId: string;
  fileAvailable: boolean;
  onStoredFile: () => void;
}) {
  const saved = useCertificationImage(certificate.revision ? certificate.id : undefined);
  const staged = useIntakeFile(
    certificate.staged ? `${root}/${submissionId}/staged/${certificate.id}` : undefined,
  );
  const stored = certificate.staged ? staged : saved;
  useEffect(() => {
    if (stored.file && !certificate.file && !certificate.uploaded) onStoredFile();
  }, [stored.file?.id, certificate.file, certificate.uploaded]);
  const [local, setLocal] = useState('');
  useEffect(() => {
    if (!certificate.file) {
      setLocal('');
      return;
    }
    const url = URL.createObjectURL(certificate.file);
    setLocal(url);
    return () => URL.revokeObjectURL(url);
  }, [certificate.file]);
  return (
    <CertificateImageUploader
      url={local || stored.url}
      file={
        certificate.file
          ? {
              id: certificate.id,
              fileName: certificate.file.name,
              mimeType: certificate.file.type,
              bytes: certificate.file.size,
            }
          : stored.file
      }
      loading={stored.loading && !local}
      error={stored.error}
      busy={busy || certificate.reuse}
      available={fileAvailable}
      onChange={onFile}
      onBusy={onBusy}
      onRetry={stored.retry}
    />
  );
}
export function CapabilityComposer({
  initialCertificate: _initialCertificate = false,
  submissionId,
  renewal,
  initialCredential,
  onClose,
  onSaved,
}: {
  initialCertificate?: boolean;
  submissionId?: string;
  renewal?: { id: string; fields: CertificationFields };
  initialCredential?: {
    id: string;
    revision: number;
    fields: CertificationFields;
    hasImage?: boolean;
    relatedSkills?: { skillId?: string; id?: string }[];
  };
  onClose: () => void;
  onSaved: () => void;
}) {
  const id = useRef(submissionId ?? crypto.randomUUID()),
    version = useRef(0),
    lock = useRef(false),
    mounted = useRef(true);
  const [page, setPage] = useState(0),
    [hasCertificate, setHasCertificate] = useState(true),
    [skills, setSkills] = useState<SelectedSkill[]>([]),
    [certs, setCerts] = useState<SelectedCertificate[]>(() =>
      renewal
        ? [
            {
              id: crypto.randomUUID(),
              revision: 0,
              reuse: false,
              fields: renewal.fields,
              skillIds: [],
              uploaded: false,
              renewedFromId: renewal.id,
            },
          ]
        : initialCredential
          ? [
              {
                id: initialCredential.id,
                revision: initialCredential.revision,
                reuse: false,
                fields: initialCredential.fields,
                skillIds:
                  initialCredential.relatedSkills
                    ?.map(s => s.skillId ?? s.id)
                    .filter((v): v is string => Boolean(v)) ?? [],
                uploaded: Boolean(initialCredential.hasImage),
              },
            ]
          : [
              {
                id: crypto.randomUUID(),
                revision: 0,
                reuse: false,
                fields: { ...emptyCertification(), expiryDate: '' },
                skillIds: [],
                uploaded: false,
              },
            ],
    ),
    [busy, setBusy] = useState(false),
    [uploadBusy, setUploadBusy] = useState(false),
    [error, setError] = useState(''),
    [phase, setPhase] = useState(''),
    [discard, setDiscard] = useState(false),
    [recovery, setRecovery] = useState(false);
  const [expandedCertificate, setExpandedCertificate] = useState<string | undefined>(certs[0]?.id);
  const [autofillingCertificate, setAutofillingCertificate] = useState<string>();
  const [editingSkill, setEditingSkill] = useState<string>();
  const [skillDialogError, setSkillDialogError] = useState('');
  const [pendingEvidence, setPendingEvidence] = useState<Record<string, File[]>>({});
  const loadedCataloguePage = useRef(0);
  const [catalogueAttempt, setCatalogueAttempt] = useState(0);
  const [cataloguePage, setCataloguePage] = useState(1);
  const [catalogueTotal, setCatalogueTotal] = useState(0);
  const [query, setQuery] = useState(''),
    [options, setOptions] = useState<SkillChoice[]>([]),
    [searching, setSearching] = useState(false),
    [ownClaims, setOwnClaims] = useState<any[]>([]),
    [ownCertificates, setOwnCertificates] = useState<any[]>([]),
    [aiAvailable, setAiAvailable] = useState(false),
    [fileAvailable, setFileAvailable] = useState(false),
    [suggestions, setSuggestions] = useState<{ skill: SkillChoice; reason: string }[]>([]),
    [suggestionCertificate, setSuggestionCertificate] = useState<string>(),
    [credentialSuggestion, setCredentialSuggestion] = useState<any>(),
    [catalogueError, setCatalogueError] = useState('');
  const dirty = useRef(false),
    request = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, []);
  const [initializing, setInitializing] = useState(true),
    [personalReady, setPersonalReady] = useState(false),
    [bootstrapAttempt, setBootstrapAttempt] = useState(0),
    [definitions, setDefinitions] = useState<any[]>([]);
  const hasUploadedCertificate = certs.some(c => Boolean(c.file || c.uploaded || c.reuse));
  const working = busy || uploadBusy || initializing || !personalReady || recovery;
  const patchCertificate = (certId: string, patch: Partial<SelectedCertificate>) => {
    dirty.current = true;
    setCerts(old => old.map(c => (c.id === certId ? { ...c, ...patch } : c)));
  };
  const patchSkill = (skillId: string, patch: Partial<SelectedSkill>) => {
    dirty.current = true;
    setSkills(old => old.map(s => (s.id === skillId ? { ...s, ...patch } : s)));
  };
  function addSkill(choice: SkillChoice) {
    if (working || skills.some(s => s.choice.id === choice.id) || skills.length >= 10) return;
    setSkillDialogError('');
    setEditingSkill(choice.id);
    const own = ownClaims.find(c => c.skillId === choice.id);
    if (own?.status === 'SUBMITTED') {
      setEditingSkill(undefined);
      setError(
        'This skill is already awaiting review. Finish that review before including it here.',
      );
      return;
    }
    dirty.current = true;
    setSkills(old => [
      ...old,
      {
        id: own?.id ?? crypto.randomUUID(),
        revision: own?.revision ?? 0,
        choice,
        reuse: own?.status === 'APPROVED',
        rank: own?.rank ?? 0,
        experienceMonths: own?.experienceMonths ?? 0,
        description: own?.description ?? '',
        projects: own?.projects ?? '',
        evidence: own?.evidence ?? '',
        lastUsedOn: own?.lastUsedOn?.slice(0, 10) ?? '',
      },
    ]);
  }
  const addCertificate = () => {
    if (working || certs.length >= 10) return;
    dirty.current = true;
    const certificateId = crypto.randomUUID();
    setExpandedCertificate(certificateId);
    setHasCertificate(true);
    setCerts(old => [
      ...old,
      {
        id: certificateId,
        revision: 0,
        reuse: false,
        fields: { ...emptyCertification(), expiryDate: '' },
        skillIds: skills.map(s => s.choice.id),
        uploaded: false,
      },
    ]);
  };
  function sync(value: Submission, restore = false) {
    version.current = value.revision;
    if (restore && value.intake) {
      setSkills(value.intake.skills);
      setCerts(
        value.intake.certifications.map(c => ({
          ...c,
          file: certs.find(old => old.id === c.id)?.file,
          uploaded: Boolean(
            value.stagedFiles?.some(f => f.certificationId.toLowerCase() === c.id.toLowerCase()),
          ),
          staged: Boolean(
            value.stagedFiles?.some(f => f.certificationId.toLowerCase() === c.id.toLowerCase()),
          ),
        })),
      );
      setHasCertificate(value.intake.certifications.length > 0);
      setExpandedCertificate(value.intake.certifications[0]?.id);
      setPage(value.intake.certifications.length ? 0 : 1);
      return;
    }
    setSkills(old =>
      restore
        ? value.skills.map(s => ({
            id: s.id,
            revision: s.revision,
            choice: {
              id: s.skillId,
              name: s.name,
              category: s.category,
              definitionRevision: s.definitionRevision,
              levels: [1, 2, 3, 4, 5].map(rank => ({
                rank,
                name: `Level ${rank}`,
                description: '',
              })),
            },
            reuse: !s.needsReview,
            rank: s.rank,
            experienceMonths: s.experienceMonths,
            description: s.description,
            projects: s.projects ?? '',
            evidence: s.evidence ?? '',
            lastUsedOn: s.lastUsedOn?.slice(0, 10) ?? '',
          }))
        : old.map(s => ({
            ...s,
            revision: value.skills.find(v => v.id === s.id)?.revision ?? s.revision,
          })),
    );
    setCerts(old =>
      restore
        ? value.certifications.map(c => ({
            id: c.id,
            revision: c.revision,
            reuse: !c.needsReview,
            fields: certificationFields(c),
            skillIds: (c.relatedSkills ?? []).map((s: any) => s.skillId),
            uploaded: Boolean(c.hasImage),
          }))
        : old.map(c => ({
            ...c,
            revision: value.certifications.find(v => v.id === c.id)?.revision ?? c.revision,
          })),
    );
    if (restore) {
      setHasCertificate(value.certifications.length > 0);
      setExpandedCertificate(value.certifications[0]?.id);
      setPage(value.certifications.length ? 0 : 1);
    }
  }
  useEffect(() => {
    const abort = new AbortController();
    async function bootstrap() {
      try {
        const [availability, personal] = await Promise.all([
          json<{ aiAvailable: boolean; fileAvailable: boolean }>(
            root + '/availability',
            undefined,
            abort.signal,
          ),
          json<any>(root + '/options', undefined, abort.signal),
        ]);
        if (!abort.signal.aborted) {
          setAiAvailable(availability.aiAvailable);
          setFileAvailable(availability.fileAvailable);
        }
        if (!abort.signal.aborted) {
          setOwnClaims(personal.claims ?? []);
          setOwnCertificates(
            (personal.certifications ?? []).filter((c: any) => c.status !== 'SUBMITTED'),
          );
          setDefinitions(personal.definitions ?? []);
          setPersonalReady(true);
        }
        if (submissionId) {
          const saved = await json<Submission>(root + '/' + submissionId, undefined, abort.signal);
          if (!abort.signal.aborted) {
            if (saved.status !== 'DRAFT')
              throw Error(
                'This submission is already locked. Open the review to see its progress.',
              );
            sync(saved, true);
          }
        }
      } catch (e) {
        if (!abort.signal.aborted) setError('Your form could not open. Please try again.');
      } finally {
        if (!abort.signal.aborted) setInitializing(false);
      }
    }
    void bootstrap();
    return () => abort.abort();
  }, [submissionId, bootstrapAttempt]);
  useEffect(() => {
    const abort = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      setCatalogueError('');
      json<any>(
        '/api/my-skills/catalogue?search=' +
          encodeURIComponent(query) +
          '&page=' +
          cataloguePage +
          '&pageSize=12',
        undefined,
        abort.signal,
      )
        .then(v => {
          if (!abort.signal.aborted) {
            setCatalogueTotal(v.total);
            setOptions(old =>
              cataloguePage === 1
                ? v.skills
                : [
                    ...old,
                    ...v.skills.filter(
                      (item: SkillChoice) => !old.some(existing => existing.id === item.id),
                    ),
                  ],
            );
          }
        })
        .catch(e => {
          if (!abort.signal.aborted) {
            if (cataloguePage === 1) {
              setOptions([]);
              setCatalogueTotal(0);
            }
            setCatalogueError(e.message);
          }
        })
        .finally(() => {
          if (!abort.signal.aborted) setSearching(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query, cataloguePage, catalogueAttempt]);
  async function autofill(cert: SelectedCertificate) {
    if (lock.current || !cert.file) return;
    lock.current = true;
    setBusy(true);
    setAutofillingCertificate(cert.id);
    setError('');
    setPhase('');
    const abort = new AbortController();
    request.current = abort;
    try {
      const data = await readApiResponse<any>(
        await authenticatedFetch(root + '/autofill', {
          method: 'POST',
          headers: {
            'Content-Type': cert.file.type,
            'X-File-Name': encodeURIComponent(cert.file.name),
          },
          body: cert.file,
          signal: abort.signal,
        }),
        'AI could not read this file. Continue manually.',
      );
      if (!mounted.current) return;
      patchCertificate(cert.id, {
        fields: {
          ...cert.fields,
          ...Object.fromEntries(
            Object.entries(data.fields).filter(([, v]) => v !== '' && v !== null),
          ),
        },
      });
      setSuggestions(data.suggestions ?? []);
      setSuggestionCertificate(cert.id);
      setCredentialSuggestion(data.catalogueSuggestion);
      toast.info(data.warning);
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      lock.current = false;
      if (mounted.current) {
        setBusy(false);
        setAutofillingCertificate(undefined);
        setPhase('');
      }
    }
  }
  function checkCertificates() {
    for (const c of certs) {
      if (c.reuse) continue;
      const invalid =
        certificationFieldError(c.fields, new Date().toISOString().slice(0, 10)) ||
        (!c.file && !c.uploaded ? 'Upload a file for each certificate.' : '');
      if (invalid) {
        setExpandedCertificate(c.id);
        setError(invalid);
        return false;
      }
    }
    return true;
  }
  function validate() {
    if (!skills.length) return 'Select at least one published skill.';
    for (const s of skills) {
      if (
        !s.reuse &&
        (!s.rank ||
          !Number.isInteger(s.experienceMonths) ||
          s.experienceMonths < 0 ||
          s.experienceMonths > 600)
      )
        return `Complete proficiency and experience for ${s.choice.name}.`;
      const date = skillDateError(s.lastUsedOn);
      if (date) return date;
    }
    if (hasCertificate && !certs.length)
      return 'Add or link a certification, or choose skill without certification.';
    for (const c of certs) {
      const invalid = c.reuse
        ? ''
        : certificationFieldError(c.fields, new Date().toISOString().slice(0, 10));
      if (invalid) return invalid;
      if (
        !relatedSkillIds(
          c.skillIds,
          skills.map(s => s.choice.id),
        ).length
      )
        return `Choose related skills for ${c.fields.certificationName || 'each certification'}.`;
    }
    return '';
  }
  async function save(submit: boolean) {
    if (lock.current || working || recovery) return;
    const invalid = validate();
    if (invalid) {
      if (!submit) {
        if (Object.values(pendingEvidence).some(files => files.length)) {
          setError(
            'Complete proficiency and certificate details before saving your evidence images.',
          );
          return;
        }
        await saveIncomplete();
        return;
      }
      setError(invalid);
      setPage(1);
      return;
    }
    if (submit && certs.some(c => !c.reuse && !c.file && !c.uploaded)) {
      setError('Attach a file to every new certificate before submitting.');
      setPage(1);
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    setPhase('Saving linked drafts…');
    const abort = new AbortController();
    request.current = abort;
    try {
      const saved = await json<Submission>(
        root,
        submissionPayload(id.current, version.current, skills, certs, ownCertificates),
        abort.signal,
      );
      if (!mounted.current) return;
      sync(saved);
      const skillRevisions = saved.skills.map(s => ({ id: s.id, revision: s.revision }));
      const certRevisions = saved.certifications.map(c => ({ id: c.id, revision: c.revision }));
      for (const skill of skills) {
        const current = skillRevisions.find(v => v.id === skill.id)!;
        for (const file of pendingEvidence[skill.id] ?? []) {
          setPhase(`Uploading evidence for ${skill.choice.name}-`);
          const image = await compressEvidenceImage(file);
          const uploaded = await readApiResponse<{ revision: number }>(
            await authenticatedFetch(`/api/my-skills/${skill.id}/evidence`, {
              method: 'POST',
              signal: abort.signal,
              headers: { 'Content-Type': image.type, 'X-Claim-Revision': String(current.revision) },
              body: image,
            }),
            'Draft saved, but evidence upload could not be confirmed.',
          );
          current.revision = uploaded.revision;
          if (!mounted.current) return;
          patchSkill(skill.id, { revision: uploaded.revision });
          setPendingEvidence(old => ({
            ...old,
            [skill.id]: (old[skill.id] ?? []).filter(v => v !== file),
          }));
        }
      }
      for (const certificate of certs) {
        if (!certificate.file || certificate.uploaded) continue;
        setPhase(`Uploading ${certificate.file.name}…`);
        const current = certRevisions.find(c => c.id === certificate.id)!;
        const uploaded = await readApiResponse<any>(
          await authenticatedFetch(`/api/certifications/${certificate.id}/image`, {
            method: 'POST',
            headers: {
              'Content-Type': certificate.file.type,
              'X-Certificate-File-Name': encodeURIComponent(certificate.file.name),
              'X-Certification-Revision': String(current.revision),
            },
            body: certificate.file,
            signal: abort.signal,
          }),
          'Draft saved, but certificate upload could not be confirmed.',
        );
        current.revision = uploaded.revision;
        if (mounted.current)
          patchCertificate(certificate.id, { revision: uploaded.revision, uploaded: true });
      }
      if (submit) {
        setPhase('Submitting one review request…');
        await json<Submission>(
          root +
            (skills.every(s => s.reuse) && certs.every(c => c.reuse)
              ? '/publish-links'
              : '/submit'),
          {
            id: id.current,
            revision: saved.revision,
            skills: skillRevisions,
            certifications: certRevisions,
          },
          abort.signal,
        );
      }
      if (!mounted.current) return;
      dirty.current = false;
      toast.success(
        submit
          ? skills.every(s => s.reuse) && certs.every(c => c.reuse)
            ? 'Links saved. Previously reviewed skills and certificates stay unchanged.'
            : 'Skills and certificates submitted in one review request.'
          : 'Linked capability drafts saved.',
      );
      window.dispatchEvent(new Event('own-skills-updated'));
      onSaved();
    } catch (e) {
      if (mounted.current) {
        setError(
          (e as Error).message +
            ' Your entries remain here. Check the saved draft before retrying.',
        );
        setRecovery(true);
      }
    } finally {
      lock.current = false;
      if (mounted.current) {
        setBusy(false);
        setPhase('');
      }
    }
  }
  async function saveIncomplete() {
    if (lock.current || working || recovery) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setPhase('Saving your incomplete draft…');
    const abort = new AbortController();
    request.current = abort;
    try {
      const certificates = certs.map(c => ({
        id: c.id,
        revision: c.revision,
        reuse: c.reuse,
        fields: c.fields,
        skillIds: c.skillIds,
        ...(c.renewedFromId ? { renewedFromId: c.renewedFromId } : {}),
      }));
      const value = await json<Submission>(
        root + '/intake',
        { id: id.current, revision: version.current, skills, certifications: certificates },
        abort.signal,
      );
      version.current = value.revision;
      for (const c of certs) {
        if (!c.file || c.uploaded) continue;
        setPhase(`Saving ${c.file.name} in your private draft…`);
        const uploaded = await readApiResponse<any>(
          await authenticatedFetch(`${root}/${id.current}/staged/${c.id}`, {
            method: 'POST',
            headers: {
              'Content-Type': c.file.type,
              'X-Certificate-File-Name': encodeURIComponent(c.file.name),
              'X-Submission-Revision': String(version.current),
            },
            body: c.file,
            signal: abort.signal,
          }),
          'Draft details saved; the file upload was not confirmed.',
        );
        version.current = uploaded.revision;
        if (mounted.current) patchCertificate(c.id, { uploaded: true, staged: true });
      }
      if (!mounted.current) return;
      dirty.current = false;
      toast.success(
        'Private draft and selected files saved. Complete the details before submitting.',
      );
      window.dispatchEvent(new Event('own-skills-updated'));
      onSaved();
    } catch (e) {
      if (mounted.current) {
        setError(
          (e as Error).message +
            ' Your entries remain here. Check the saved draft before retrying.',
        );
        setRecovery(true);
      }
    } finally {
      lock.current = false;
      if (mounted.current) {
        setBusy(false);
        setPhase('');
      }
    }
  }
  async function recover() {
    if (busy || uploadBusy || initializing || !personalReady) return;
    setBusy(true);
    try {
      const saved = await json<Submission>(root + '/' + id.current);
      if (saved.status !== 'DRAFT') {
        toast.info('Submission was already completed.');
        onSaved();
        return;
      }
      sync(saved, true);
      setPendingEvidence({});
      setRecovery(false);
      setError(
        'Saved draft loaded. Review your details and reselect any file whose upload was not completed.',
      );
    } catch (e) {
      setError(
        (e as Error).message +
          ' If the initial save did not complete, retry with the same submission ID.',
      );
      setRecovery(false);
    } finally {
      setBusy(false);
    }
  }
  const certificateFieldsUI = (c: SelectedCertificate) => (
    <div className="cap-fields">
      <label className="cap-wide">
        Choose an approved credential definition
        <select
          disabled={working || c.reuse}
          value=""
          onChange={e => {
            const definition = definitions.find(d => d.id === e.target.value);
            if (definition)
              patchCertificate(c.id, {
                fields: {
                  ...c.fields,
                  certificationName: definition.name,
                  provider: definition.provider,
                  category: definition.category,
                },
              });
          }}
        >
          <option value="">Select a catalogue credential or enter the details below…</option>
          {definitions.map(d => (
            <option key={d.id} value={d.id}>
              {d.name} · {d.provider}
            </option>
          ))}
        </select>
      </label>
      {[
        ['certificationName', 'Certification name', 200],
        ['provider', 'Issuer', 120],
        ['category', 'Category', 80],
        ['certificationDate', 'Issue date', 10],
        ['expiryDate', 'Expiry date', 10],
      ].map(([key, label, max]) => (
        <label key={String(key)} className={key === 'certificationName' ? 'cap-wide' : undefined}>
          <span>
            {label}
            {['certificationName', 'provider', 'category', 'certificationDate'].includes(
              String(key),
            ) ||
            (key === 'expiryDate' && c.fields.expiryDate !== null) ? (
              <span className="cert-required-mark"> *</span>
            ) : null}
          </span>
          <input
            type={String(key).includes('Date') ? 'date' : key === 'credentialUrl' ? 'url' : 'text'}
            value={String(c.fields[key as keyof typeof c.fields] ?? '')}
            maxLength={Number(max)}
            disabled={working || c.reuse || (key === 'expiryDate' && c.fields.expiryDate === null)}
            max={key === 'certificationDate' ? new Date().toISOString().slice(0, 10) : undefined}
            min={key === 'expiryDate' ? c.fields.certificationDate || undefined : undefined}
            onChange={e =>
              patchCertificate(c.id, {
                fields: {
                  ...c.fields,
                  [key]: key === 'expiryDate' ? e.target.value || '' : e.target.value,
                },
              })
            }
          />
        </label>
      ))}
      <div className="cap-wide cap-expiry-options">
        <div className="cap-expiry-presets" aria-label="Certificate validity duration">
          {[
            [6, '6 months'],
            [12, '1 year'],
            [24, '2 years'],
          ].map(([months, label]) => {
            const expiry = addCredentialMonths(c.fields.certificationDate, Number(months));
            return (
              <button
                type="button"
                key={months}
                className="secondary-button"
                disabled={working || c.reuse || !expiry}
                aria-pressed={Boolean(expiry && c.fields.expiryDate === expiry)}
                onClick={() =>
                  patchCertificate(c.id, { fields: { ...c.fields, expiryDate: expiry } })
                }
              >
                {label}
              </button>
            );
          })}
        </div>
        <label className="cap-checkbox">
          <input
            type="checkbox"
            checked={c.fields.expiryDate === null}
            disabled={working || c.reuse}
            onChange={e =>
              patchCertificate(c.id, {
                fields: { ...c.fields, expiryDate: e.target.checked ? null : '' },
              })
            }
          />
          Does not expire
        </label>
      </div>
      {(
        [
          ['credentialId', 'Credential ID', 200],
          ['credentialUrl', 'Verification URL', 1000],
        ] as const
      ).map(([key, label, max]) => (
        <label key={key}>
          {label}
          <input
            type={key === 'credentialUrl' ? 'url' : 'text'}
            value={c.fields[key]}
            maxLength={max}
            disabled={working || c.reuse}
            onChange={e =>
              patchCertificate(c.id, { fields: { ...c.fields, [key]: e.target.value } })
            }
          />
        </label>
      ))}
      <label>
        Notes
        <textarea
          maxLength={2000}
          disabled={working || c.reuse}
          value={c.fields.notes}
          onChange={e =>
            patchCertificate(c.id, {
              fields: { ...c.fields, notes: e.target.value },
            })
          }
        />
      </label>
    </div>
  );
  const close = () => {
    if (busy || uploadBusy) return;
    if (dirty.current) setDiscard(true);
    else onClose();
  };
  return (
    <>
      <FormDialog
        title="Add skill"
        className="capability-composer"
        busy={busy || uploadBusy}
        onClose={close}
        stepNavigation
        page={page}
        onPageChange={visiblePage => {
          const next = visiblePage;
          if (working) return;
          if (page === 0 && next > 0 && hasUploadedCertificate && !checkCertificates()) return;
          if (page === 0 && next === 1 && !hasUploadedCertificate) {
            setCerts([]);
            setHasCertificate(false);
          }
          if (next === 2) {
            const invalid = validate();
            if (invalid) {
              setError(invalid);
              return;
            }
          }
          setError('');
          setPage(next);
        }}
        message={
          error ? (
            <p role="alert">{error}</p>
          ) : phase ? (
            <p role="status">{phase}</p>
          ) : initializing ? (
            <p role="status">Getting your form ready…</p>
          ) : undefined
        }
        pages={[
          {
            label: 'Certificates',
            content: (
              <section className="cap-entry">
                {hasCertificate && (
                  <section className="cap-upload-step">
                    {certs.map((c, index) => (
                      <details
                        key={c.id}
                        className="cap-accordion cap-entry-certificate"
                        open={expandedCertificate === c.id}
                      >
                        <summary
                          onClick={e => {
                            e.preventDefault();
                            if (!working)
                              setExpandedCertificate(
                                expandedCertificate === c.id ? undefined : c.id,
                              );
                          }}
                        >
                          <Award size={18} />
                          <span>
                            <strong>
                              {c.fields.certificationName || `Certificate ${index + 1}`}
                            </strong>
                          </span>
                          <span className="cap-pill">{c.reuse ? 'Reviewed' : 'Draft'}</span>
                        </summary>
                        <section
                          className="cap-upload-card"
                          aria-busy={autofillingCertificate === c.id}
                        >
                          <div
                            className={`cap-upload-file${autofillingCertificate === c.id ? ' is-reading' : ''}`}
                          >
                            {page === 0 && expandedCertificate === c.id && (
                              <FileCard
                                certificate={c}
                                busy={working}
                                onBusy={setUploadBusy}
                                onFile={file => patchCertificate(c.id, { file, uploaded: false })}
                                submissionId={id.current}
                                fileAvailable={initializing || fileAvailable}
                                onStoredFile={() =>
                                  setCerts(old =>
                                    old.map(item =>
                                      item.id === c.id ? { ...item, uploaded: true } : item,
                                    ),
                                  )
                                }
                              />
                            )}
                            {autofillingCertificate === c.id && (
                              <p className="cap-reading-status" role="status">
                                <Sparkles size={16} /> Reading certificate…
                              </p>
                            )}
                          </div>
                          <div className="cap-upload-guide">
                            <div className="cap-guide-header">
                              <span className="cap-guide-title">Certificate details</span>
                              {!c.reuse && (
                                <button
                                  type="button"
                                  className="admin-primary cap-autofill-btn"
                                  disabled={working || !c.file || !aiAvailable}
                                  onClick={() => void autofill(c)}
                                  title={!c.file ? 'Upload a certificate to autofill' : undefined}
                                >
                                  <Sparkles size={14} />{' '}
                                  {autofillingCertificate === c.id
                                    ? 'Reading certificate…'
                                    : 'Autofill with AI'}
                                </button>
                              )}
                            </div>
                            {c.reuse && <p>Already reviewed</p>}
                            {!aiAvailable && !initializing && !c.reuse && (
                              <p className="cap-help">
                                AI unavailable. You can fill the details yourself.
                              </p>
                            )}
                            {suggestionCertificate === c.id && suggestions.length > 0 && (
                              <p className="cap-upload-result" role="status">
                                Details and skill suggestions ready.
                              </p>
                            )}
                            {certificateFieldsUI(c)}
                          </div>
                          <button
                            type="button"
                            className="cap-remove"
                            disabled={working}
                            onClick={() => {
                              dirty.current = true;
                              const remaining = certs.filter(item => item.id !== c.id);
                              setCerts(remaining);
                              if (expandedCertificate === c.id)
                                setExpandedCertificate(remaining[0]?.id);
                            }}
                          >
                            Remove certificate from this draft
                          </button>
                        </section>
                      </details>
                    ))}
                    {ownCertificates.some(c => !certs.some(v => v.id === c.id)) && (
                      <label>
                        Link an existing certification
                        <select
                          value=""
                          disabled={working || certs.length >= 10}
                          onChange={e => {
                            const own = ownCertificates.find(c => c.id === e.target.value);
                            if (!own) return;
                            dirty.current = true;
                            setHasCertificate(true);
                            setExpandedCertificate(own.id);
                            setCerts(old => [
                              ...old,
                              {
                                id: own.id,
                                revision: own.revision,
                                reuse: own.status === 'APPROVED',
                                fields: certificationFields(own),
                                skillIds: skills.map(s => s.choice.id),
                                uploaded: Boolean(own.hasImage),
                              },
                            ]);
                          }}
                        >
                          <option value="">Choose from my credentials…</option>
                          {ownCertificates
                            .filter(c => !certs.some(v => v.id === c.id))
                            .map(c => (
                              <option key={c.id} value={c.id}>
                                {c.certificationName} · {c.provider}
                              </option>
                            ))}
                        </select>
                      </label>
                    )}
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={working || certs.length >= 10}
                      onClick={addCertificate}
                    >
                      <Plus size={16} /> Add another certificate
                    </button>
                  </section>
                )}
                {!hasCertificate && (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={working}
                    onClick={addCertificate}
                  >
                    <Plus size={16} /> Upload a certificate
                  </button>
                )}
              </section>
            ),
          },
          {
            label: 'Skills',
            content: (
              <div className="cap-composer-body">
                <section className="cap-skill-select">
                  <header>
                    <div>
                      <h3>
                        <span className="cap-section-number">1</span> Choose your skills{' '}
                        <span className="cert-required-mark">*</span>
                      </h3>
                      <p>
                        Choose published catalogue skills. Each skill has its own proficiency and
                        experience.
                      </p>
                    </div>
                    <span className="cap-count">{skills.length}/10</span>
                  </header>
                  <div className="cap-search">
                    <div className="cap-chips" aria-label="Selected related skills">
                      {skills.map(s => (
                        <span key={s.id}>
                          <button
                            type="button"
                            disabled={working}
                            onClick={() => {
                              setSkillDialogError('');
                              setEditingSkill(s.choice.id);
                            }}
                          >
                            {s.choice.name}
                          </button>
                          <button
                            type="button"
                            disabled={working}
                            aria-label={`Remove ${s.choice.name}`}
                            onClick={() => {
                              dirty.current = true;
                              setSkills(old => old.filter(v => v.id !== s.id));
                              setPendingEvidence(old => {
                                const next = { ...old };
                                delete next[s.id];
                                return next;
                              });
                              setCerts(old =>
                                old.map(c => ({
                                  ...c,
                                  skillIds: c.skillIds.filter(v => v !== s.choice.id),
                                })),
                              );
                            }}
                          >
                            <X size={14} />
                          </button>
                        </span>
                      ))}
                    </div>
                    <Search size={18} />
                    <input
                      aria-label="Search related skills"
                      value={query}
                      maxLength={100}
                      disabled={working}
                      onChange={e => {
                        setQuery(e.target.value);
                        setCataloguePage(1);
                        loadedCataloguePage.current = 0;
                        setOptions([]);
                        setCatalogueTotal(0);
                        setSearching(true);
                      }}
                      placeholder="Search skill name or category…"
                    />
                    <details className="cap-show-all">
                      <summary>Show all</summary>{' '}
                      <div className="cap-skill-grid" aria-busy={searching}>
                        {options.map(option => (
                          <button
                            key={option.id}
                            type="button"
                            disabled={
                              working ||
                              skills.some(s => s.choice.id === option.id) ||
                              skills.length >= 10
                            }
                            onClick={() => addSkill(option)}
                          >
                            <Plus size={15} />
                            {option.name}
                            <small>{option.category}</small>
                          </button>
                        ))}
                        {searching && <span role="status">Searching catalogue…</span>}
                        {options.length < catalogueTotal && (
                          <button
                            type="button"
                            disabled={working || searching}
                            onClick={() => {
                              setSearching(true);
                              setCataloguePage(loadedCataloguePage.current + 1);
                              setCatalogueAttempt(v => v + 1);
                            }}
                          >
                            Show more skills <Plus size={16} />
                          </button>
                        )}
                      </div>
                    </details>
                  </div>
                  {catalogueError && <p role="alert">{catalogueError}</p>}
                  <div className="cap-suggestion-bar">
                    <div className="cap-skill-results" aria-busy={searching}>
                      {[
                        ...suggestions.map(v => v.skill),
                        ...options.filter(
                          option => !suggestions.some(v => v.skill.id === option.id),
                        ),
                      ]
                        .filter(
                          option =>
                            !query.trim() ||
                            `${option.name} ${option.category}`
                              .toLowerCase()
                              .includes(query.trim().toLowerCase()),
                        )
                        .slice(0, 12)
                        .map(option => {
                          const suggested = suggestions.find(v => v.skill.id === option.id);
                          return (
                            <button
                              key={option.id}
                              type="button"
                              className={suggested ? 'cap-ai-suggested-skill' : undefined}
                              title={suggested?.reason}
                              disabled={
                                working ||
                                skills.some(s => s.choice.id === option.id) ||
                                skills.length >= 10
                              }
                              onClick={() => {
                                addSkill(option);
                                if (suggested && suggestionCertificate)
                                  patchCertificate(suggestionCertificate, {
                                    skillIds: [
                                      ...new Set([
                                        ...(certs.find(c => c.id === suggestionCertificate)
                                          ?.skillIds ?? []),
                                        option.id,
                                      ]),
                                    ],
                                  });
                              }}
                            >
                              {suggested ? <Sparkles size={15} /> : <Plus size={15} />}
                              {option.name}
                              <small>{suggested ? 'AI suggested' : option.category}</small>
                            </button>
                          );
                        })}
                      {searching && <span role="status">Searching catalogue…</span>}
                    </div>
                  </div>
                  {credentialSuggestion && (
                    <section className="cap-ai-suggestions">
                      <h4>Suggested catalogue credential</h4>
                      <p>
                        {credentialSuggestion.name} - {credentialSuggestion.provider}
                      </p>
                      <button
                        type="button"
                        disabled={working}
                        onClick={() => {
                          const cert = certs.find(c => c.id === suggestionCertificate);
                          if (cert)
                            patchCertificate(cert.id, {
                              fields: {
                                ...cert.fields,
                                certificationName: credentialSuggestion.name,
                                provider: credentialSuggestion.provider,
                                category: credentialSuggestion.category,
                              },
                            });
                          setCredentialSuggestion(undefined);
                        }}
                      >
                        Use these catalogue details
                      </button>
                    </section>
                  )}

                  {certs.map(c => (
                    <div key={c.id}>
                      <fieldset disabled={working} className="cap-related">
                        <legend>
                          Skills supported by {c.fields.certificationName || 'this certificate'}{' '}
                          <span className="cert-required-mark">*</span>
                        </legend>
                        {!skills.length && (
                          <p>
                            Choose skills in the next section, then tick which ones this certificate
                            supports.
                          </p>
                        )}
                        {skills.map(s => (
                          <label key={s.id}>
                            <input
                              type="checkbox"
                              checked={c.skillIds.includes(s.choice.id)}
                              onChange={e =>
                                patchCertificate(c.id, {
                                  skillIds: e.target.checked
                                    ? [...c.skillIds, s.choice.id]
                                    : c.skillIds.filter(id => id !== s.choice.id),
                                })
                              }
                            />
                            {s.choice.name}
                          </label>
                        ))}
                      </fieldset>
                    </div>
                  ))}
                </section>
                <section className="cap-skills">
                  <h3>Skill details</h3>
                  <p>Select a skill to fill its details. Click a selected skill to edit it.</p>
                  {skills.map(s => (
                    <button
                      key={s.id}
                      type="button"
                      className="cap-skill-summary"
                      disabled={working}
                      onClick={() => {
                        setSkillDialogError('');
                        setEditingSkill(s.choice.id);
                      }}
                    >
                      <strong>{s.choice.name}</strong>
                      <span>
                        {s.reuse
                          ? 'Manager reviewed'
                          : s.rank
                            ? `L${s.rank} · ${s.experienceMonths} months`
                            : 'Complete skill details'}
                      </span>
                      <ChevronRight size={16} />
                    </button>
                  ))}
                </section>
              </div>
            ),
          },
          {
            label: 'Review',
            content: (
              <section className="cap-final">
                <h3>Review your linked capabilities</h3>
                <p>
                  {skills.length} distinct skills · {certs.length} distinct certifications.
                  Certificate support does not automatically verify proficiency.
                </p>
                <div className="cap-final-grid">
                  <section>
                    <h4>Skills</h4>
                    {skills.map(s => (
                      <div className="cap-final-item" key={s.id}>
                        <strong>{s.choice.name}</strong>
                        <span>
                          {s.reuse
                            ? 'Existing reviewed skill'
                            : `L${s.rank} · ${s.experienceMonths} months`}
                        </span>
                        <p>{s.description}</p>
                      </div>
                    ))}
                  </section>
                  <section>
                    <h4>Certificates</h4>
                    {certs.map(c => (
                      <div className="cap-final-item" key={c.id}>
                        <strong>{c.fields.certificationName}</strong>
                        <span>
                          {c.fields.provider} ·{' '}
                          {c.fields.expiryDate
                            ? `Expires ${c.fields.expiryDate}`
                            : 'Does not expire'}
                        </span>
                        <div className="cap-chips">
                          {skills
                            .filter(s => c.skillIds.includes(s.choice.id))
                            .map(s => (
                              <span key={s.id}>{s.choice.name}</span>
                            ))}
                        </div>
                      </div>
                    ))}
                    {!certs.length && (
                      <p>
                        No supporting certificates. Your skill claims can be reviewed independently.
                      </p>
                    )}
                  </section>
                </div>
                <p className="cap-callout">
                  One request goes to your assigned current manager. Each new skill and certificate
                  gets its own decision. Previously reviewed skills and certificates stay unchanged.
                </p>
              </section>
            ),
          },
        ]}
        footer={
          <>
            <button
              type="button"
              className="secondary-button"
              disabled={working || page === 0}
              onClick={() => setPage(p => p - 1)}
            >
              <ArrowLeft size={16} />
              Back
            </button>
            <span className="cap-footer-note">
              {phase || 'Your progress can be saved as a draft'}
            </span>
            <button
              type="button"
              className="secondary-button"
              disabled={busy || uploadBusy}
              onClick={close}
            >
              Cancel
            </button>
            {!personalReady && !initializing && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setInitializing(true);
                  setBootstrapAttempt(v => v + 1);
                }}
              >
                Try again
              </button>
            )}
            {page < 2 ? (
              <>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={working || recovery || (!skills.length && !certs.length)}
                  onClick={() => void save(false)}
                >
                  Save draft
                </button>
                <button
                  type="button"
                  className="admin-primary"
                  disabled={working}
                  onClick={() => {
                    if (page === 0 && hasUploadedCertificate && !checkCertificates()) return;
                    const invalid = page === 1 ? validate() : '';
                    if (invalid) {
                      setError(invalid);
                      return;
                    }
                    if (page === 0 && !hasUploadedCertificate) {
                      setCerts([]);
                      setHasCertificate(false);
                      setError('');
                    }
                    setPage(p => p + 1);
                  }}
                >
                  {page === 1
                    ? 'Review'
                    : hasUploadedCertificate
                      ? 'Continue'
                      : 'Continue without certificate'}
                  <ArrowRight size={16} />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={working || recovery}
                  onClick={() => void save(false)}
                >
                  Save drafts
                </button>
                <button
                  type="button"
                  className="admin-primary"
                  disabled={working || recovery}
                  onClick={() => void save(true)}
                >
                  <Send size={16} />{' '}
                  {skills.every(s => s.reuse) && certs.every(c => c.reuse)
                    ? 'Save links'
                    : 'Submit for review'}
                </button>
              </>
            )}
            {recovery && (
              <button
                type="button"
                className="secondary-button"
                disabled={busy || uploadBusy}
                onClick={() => void recover()}
              >
                Check saved submission
              </button>
            )}
          </>
        }
      ></FormDialog>
      {editingSkill &&
        skills
          .filter(s => s.choice.id === editingSkill)
          .map(s => (
            <FormDialog
              key={s.id}
              title={s.choice.name}
              subtitle="Your proficiency and experience"
              className="cap-skill-dialog"
              busy={working}
              onClose={() => setEditingSkill(undefined)}
              message={skillDialogError ? <p role="alert">{skillDialogError}</p> : undefined}
              footer={
                <button
                  type="button"
                  className="admin-primary"
                  disabled={working}
                  onClick={() => {
                    const dateError = skillDateError(s.lastUsedOn);
                    if (!s.reuse && (!s.rank || dateError)) {
                      setSkillDialogError(dateError || 'Choose your proficiency.');
                      return;
                    }
                    setEditingSkill(undefined);
                  }}
                >
                  Done <Check size={16} />
                </button>
              }
            >
              {s.reuse ? (
                <p className="cap-help">
                  This reviewed skill is linked without changing its proficiency or starting another
                  skill review.
                </p>
              ) : (
                <div className="cap-skill-fields">
                  <label>
                    <span>
                      Proficiency <span className="cert-required-mark">*</span>
                    </span>
                    <select
                      value={s.rank}
                      disabled={working}
                      onChange={e => patchSkill(s.id, { rank: Number(e.target.value) })}
                    >
                      <option value={0}>Choose level…</option>
                      {s.choice.levels.map(l => (
                        <option key={l.rank} value={l.rank}>
                          L{l.rank} · {l.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {s.choice.levels.find(l => l.rank === s.rank)?.description && (
                    <p className="cap-help cap-wide">
                      {s.choice.levels.find(l => l.rank === s.rank)?.description}
                    </p>
                  )}
                  <label>
                    <span>
                      Experience in months <span className="cert-required-mark">*</span>
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={600}
                      value={s.experienceMonths}
                      disabled={working}
                      onChange={e => patchSkill(s.id, { experienceMonths: Number(e.target.value) })}
                    />
                  </label>
                  <label>
                    Last used
                    <input
                      type="date"
                      max={new Date().toISOString().slice(0, 10)}
                      value={s.lastUsedOn}
                      disabled={working}
                      onChange={e => patchSkill(s.id, { lastUsedOn: e.target.value })}
                    />
                  </label>
                  <label className="cap-wide">
                    <span>Describe your experience</span>
                    <textarea
                      maxLength={2000}
                      value={s.description}
                      disabled={working}
                      onChange={e => patchSkill(s.id, { description: e.target.value })}
                    />
                  </label>
                  <details className="cap-extra-field cap-wide">
                    <summary>
                      <Plus size={15} /> Projects
                    </summary>
                    <label>
                      Projects
                      <textarea
                        maxLength={2000}
                        value={s.projects}
                        disabled={working}
                        onChange={e => patchSkill(s.id, { projects: e.target.value })}
                      />
                    </label>
                  </details>
                  <details className="cap-extra-field cap-wide">
                    <summary>
                      <Plus size={15} /> Evidence
                    </summary>
                    <label>
                      Evidence references
                      <textarea
                        maxLength={2000}
                        value={s.evidence}
                        disabled={working}
                        onChange={e => patchSkill(s.id, { evidence: e.target.value })}
                      />
                    </label>
                    {s.revision > 0 ? (
                      <ClaimEvidence
                        claim={{ id: s.id, revision: s.revision, evidence: s.evidence } as Claim}
                        onRevision={revision => patchSkill(s.id, { revision })}
                        onBusy={setUploadBusy}
                      />
                    ) : (
                      <>
                        <label className="cap-evidence-upload">
                          <Plus size={15} /> Add evidence image
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            disabled={working || (pendingEvidence[s.id]?.length ?? 0) >= 6}
                            onChange={e => {
                              const file = e.target.files?.[0];
                              e.target.value = '';
                              if (!file) return;
                              if (
                                !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
                                file.size > 10 * 1024 * 1024
                              ) {
                                setSkillDialogError('Choose JPEG, PNG or WebP, up to 10 MB.');
                                return;
                              }
                              dirty.current = true;
                              setPendingEvidence(old => ({
                                ...old,
                                [s.id]: [...(old[s.id] ?? []), file].slice(0, 6),
                              }));
                            }}
                          />
                        </label>
                        <small>JPEG, PNG or WebP - up to 10 MB - compressed when saved</small>
                      </>
                    )}
                    {(pendingEvidence[s.id] ?? []).map((file, index) => (
                      <div className="cap-pending-evidence" key={index}>
                        <span>{file.name}</span>
                        <button
                          type="button"
                          disabled={working}
                          aria-label={`Remove ${file.name}`}
                          onClick={() =>
                            setPendingEvidence(old => ({
                              ...old,
                              [s.id]: old[s.id].filter((_, i) => i !== index),
                            }))
                          }
                        >
                          <X size={15} />
                        </button>
                      </div>
                    ))}
                  </details>
                </div>
              )}
            </FormDialog>
          ))}
      {discard && (
        <FormDialog
          title="Discard unsaved changes?"
          className="cap-discard-dialog"
          onClose={() => setDiscard(false)}
          footer={
            <>
              <button
                type="button"
                className="secondary-button"
                autoFocus
                onClick={() => setDiscard(false)}
              >
                Keep editing
              </button>
              <button type="button" className="admin-primary" onClick={onClose}>
                Discard
              </button>
            </>
          }
        >
          <p>Your unsaved changes will be lost.</p>
        </FormDialog>
      )}
    </>
  );
}
