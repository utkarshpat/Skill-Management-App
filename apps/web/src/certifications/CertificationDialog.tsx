import { uploadPrivateFile } from '../private-file-upload';
import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ExternalLink, Send, ShieldCheck, X } from 'lucide-react';
import '../skill-wizard.css';
import { FormDialog } from '../FormDialog';
import {
  certificationFieldError,
  certificationFields,
  emptyCertification,
  addCredentialMonths,
  credentialValidity,
} from './certification-model';
import type { CertificationFields, CertificationRecord } from './types';
import {
  CertificateFilePreview,
  CertificateImageUploader,
  useCertificationImage,
} from './CertificationImage';
import { authenticatedFetch } from '../auth';
import { readApiResponse } from '../api-response';
import { toast } from '../toast';
import {
  reconcileCertificationSave,
  uncertainCertificationSave,
} from './certification-save-recovery';

function RequiredMark() {
  return (
    <span className="cert-required-mark" aria-hidden="true">
      {' '}
      *
    </span>
  );
}

/* ── preset lists ─────────────────────────────────────── */
const ISSUERS = [
  'Microsoft',
  'AWS',
  'Google',
  'Oracle',
  'Cisco',
  'CompTIA',
  'PMI',
  'Scrum Alliance',
  'Salesforce',
  'IBM',
  'Red Hat',
  'HashiCorp',
  'Linux Foundation',
  'ISACA',
  'ISC²',
];

const CATEGORIES = [
  'Cloud Architecture',
  'Cloud & DevOps',
  'Cybersecurity',
  'Data / AI / ML',
  'Database & Data',
  'Frontend Development',
  'Backend & API',
  'Project Management',
  'Networking',
  'Software Development',
  'Professional / Collaboration',
  'Programming',
  'DevOps',
  'IT Infrastructure',
];

const EXPIRY_PRESETS = [
  { label: '3 months', months: 3 },
  { label: '6 months', months: 6 },
  { label: '1 year', months: 12 },
  { label: '2 years', months: 24 },
  { label: '3 years', months: 36 },
];

/* ── helpers ──────────────────────────────────────────── */
/* ── Combobox component ───────────────────────────────── */
function ComboBox({
  value,
  onChange,
  presets,
  placeholder,
  maxLength,
  disabled,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  presets: string[];
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [inputVal, setInputVal] = useState(value);
  const [customActive, setCustomActive] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [showAllPresets, setShowAllPresets] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  // keep inputVal in sync when external value changes
  useEffect(() => {
    setInputVal(value);
    if (value && !presets.includes(value)) {
      setCustomActive(true);
    }
  }, [value, presets]);

  // close on outside click
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setFocused(false);
        setHighlightIndex(-1);
        setShowAllPresets(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const typed = inputVal.trim().toLowerCase();
  const listItems: string[] = ['Other', ...presets];
  const isFiltering = !showAllPresets && typed.length > 0;
  const filtered = isFiltering
    ? listItems.filter(p => p === 'Other' || p.toLowerCase().includes(typed))
    : listItems;
  const isOtherSelected = (value !== '' && !presets.includes(value)) || (customActive && !value);

  function select(item: string) {
    if (item === 'Other') {
      setCustomActive(true);
      onChange('');
      setInputVal('');
      inputRef.current?.focus();
    } else {
      setCustomActive(false);
      onChange(item);
      setInputVal(item);
    }
    setOpen(false);
    setHighlightIndex(-1);
    setShowAllPresets(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setOpen(true);
        setShowAllPresets(true);
        setHighlightIndex(0);
        return;
      }
    } else {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!filtered.length) return;
        setHighlightIndex(prev => (prev + 1) % filtered.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!filtered.length) return;
        setHighlightIndex(prev => (prev <= 0 ? filtered.length - 1 : prev - 1));
      } else if (e.key === 'Enter') {
        if (highlightIndex >= 0 && highlightIndex < filtered.length) {
          e.preventDefault();
          select(filtered[highlightIndex]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        setHighlightIndex(-1);
        setShowAllPresets(false);
      }
    }
  }

  const effectivePlaceholder = customActive ? 'Type custom name...' : placeholder;

  return (
    <div
      ref={containerRef}
      className="cert-combobox"
      style={{ position: 'relative' }}
      onBlur={e => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <div className={`cert-combobox-field${focused ? ' cert-combobox-focused' : ''}`}>
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={inputVal}
          disabled={disabled}
          placeholder={effectivePlaceholder}
          maxLength={maxLength}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={
            open && highlightIndex >= 0 ? `${listId}-${highlightIndex}` : undefined
          }
          onKeyDown={handleKeyDown}
          onChange={e => {
            setInputVal(e.target.value);
            onChange(e.target.value);
            setShowAllPresets(false);
            setHighlightIndex(-1);
            if (!open) setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            setFocused(true);
          }}
          onBlur={() => {
            setFocused(false);
          }}
        />
        {inputVal && !disabled && (
          <button
            type="button"
            className="cert-combobox-clear"
            aria-label="Clear selection"
            onMouseDown={e => e.preventDefault()}
            onClick={() => {
              onChange('');
              setInputVal('');
              setCustomActive(false);
              setHighlightIndex(-1);
              inputRef.current?.focus();
            }}
          >
            <X size={13} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className={`cert-combobox-toggle${open ? ' cert-combobox-toggle-open' : ''}`}
          disabled={disabled}
          aria-label="Show options"
          aria-controls={listId}
          aria-expanded={open}
          onMouseDown={e => e.preventDefault()}
          onClick={() => {
            const nextOpen = !open;
            inputRef.current?.focus();
            setShowAllPresets(true);
            setOpen(nextOpen);
            setFocused(true);
            setHighlightIndex(-1);
          }}
        >
          ▾
        </button>
      </div>
      {open && (
        <ul id={listId} className="cert-combobox-list" role="listbox">
          {filtered.map((item, idx) => {
            const isSelected = value === item || (item === 'Other' && isOtherSelected);
            const isHighlighted = idx === highlightIndex;
            return (
              <li
                key={item}
                id={`${listId}-${idx}`}
                role="option"
                aria-selected={isSelected}
                className={`${isSelected ? 'selected' : ''} ${isHighlighted ? 'highlighted' : ''}`}
                onMouseEnter={() => setHighlightIndex(idx)}
                onMouseDown={e => {
                  e.preventDefault();
                  select(item);
                }}
              >
                {item === 'Other' ? '✍️ Other (custom...)' : item}
              </li>
            );
          })}
          {filtered.length === 0 && <li className="cert-combobox-empty">No matches found</li>}
        </ul>
      )}
    </div>
  );
}

/* ── Main dialog ──────────────────────────────────────── */
export function CertificationDialog({
  initial,
  initialFields,
  renewal = false,
  renewalSource,
  onClose,
  onSave,
  canSubmit,
  imageAvailable = false,
}: {
  initial?: CertificationRecord | null;
  initialFields?: CertificationFields;
  renewal?: boolean;
  renewalSource?: CertificationRecord;
  canSubmit: boolean;
  imageAvailable?: boolean;
  onClose: () => void;
  onSave: (
    id: string,
    revision: number,
    fields: CertificationFields,
    submit: boolean,
  ) => Promise<number>;
}) {
  const [fields, setFields] = useState<CertificationFields>(() =>
    initial ? certificationFields(initial) : (initialFields ?? emptyCertification()),
  );
  const [step, setStep] = useState(0),
    [error, setError] = useState(''),
    [savingBusy, setBusy] = useState(false),
    [discard, setDiscard] = useState(false);
  const [imageBusy, setImageBusy] = useState(false),
    [selectedImage, setSelectedImage] = useState<File | undefined>(),
    [localImageUrl, setLocalImageUrl] = useState('');
  const [needsCheck, setNeedsCheck] = useState(false);
  const [phase, setPhase] = useState('Saving your certification…');
  const attemptedFields = useRef<CertificationFields>(fields);
  const submissionAttempted = useRef(false);
  const imageChanged = useRef(false),
    revision = useRef(initial?.revision ?? 0);
  const storedImage = useCertificationImage(imageAvailable ? initial?.id : undefined);
  const busy = savingBusy || imageBusy;
  useEffect(() => {
    if (!selectedImage) {
      setLocalImageUrl('');
      return;
    }
    const url = URL.createObjectURL(selectedImage);
    setLocalImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedImage]);
  const imageUrl = selectedImage === undefined ? storedImage.url : localImageUrl;
  function imageError() {
    if (imageBusy || storedImage.loading) return 'Wait for the certificate file to finish loading.';
    if (storedImage.error && selectedImage === undefined) return storedImage.error;
    if (!imageAvailable)
      return 'Certificate file storage is unavailable. Try again when uploads are configured.';
    return (selectedImage === undefined ? Boolean(storedImage.url) : Boolean(selectedImage))
      ? ''
      : 'Attach a certificate file before continuing.';
  }
  const baseline = useRef(
    JSON.stringify(
      initial ? certificationFields(initial) : (initialFields ?? emptyCertification()),
    ),
  );
  const close = () => {
    if (busy) return;
    if (needsCheck || JSON.stringify(fields) !== baseline.current || imageChanged.current)
      setDiscard(true);
    else onClose();
  };
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (
        saving.current ||
        needsCheck ||
        imageBusy ||
        JSON.stringify(fields) !== baseline.current ||
        imageChanged.current
      ) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [fields, imageBusy, needsCheck]);
  function changeStep(next: number) {
    if (busy) return;
    const invalid = next > step ? certificationFieldError(fields, today) || imageError() : '';
    setError(invalid);
    if (!invalid) {
      setStep(Math.min(next, step + 1));
      setDiscard(false);
    }
  }
  const id = useRef(initial?.id ?? crypto.randomUUID()),
    saving = useRef(false);
  const today = new Date().toISOString().slice(0, 10);
  const update = <K extends keyof CertificationFields>(key: K, value: CertificationFields[K]) => {
    setFields(f => ({ ...f, [key]: value }));
    setError('');
  };
  async function save(submit: boolean) {
    if (saving.current || needsCheck) return;
    if (submit && !canSubmit) {
      setError('Save a draft for now. A current manager with review access is needed to submit.');
      return;
    }
    const invalid = certificationFieldError(fields, today) || imageError();
    if (invalid) {
      setError(invalid);
      setStep(0);
      return;
    }
    saving.current = true;
    setBusy(true);
    setError('');
    attemptedFields.current = { ...fields };
    submissionAttempted.current = false;
    setPhase('Saving credential details…');
    try {
      if (imageChanged.current && !selectedImage)
        throw Error('Choose the replacement certificate file before saving.');
      if (imageChanged.current) {
        const file = selectedImage!;
        revision.current = await onSave(id.current, revision.current, fields, false);
        baseline.current = JSON.stringify(fields);
        setPhase('Uploading certificate file…');
        const root = `/api/certifications/${encodeURIComponent(id.current)}/image`;
        const result = await readApiResponse<{ revision: number }>(
          await uploadPrivateFile(root, {
            method: 'POST',
            headers: {
              'X-Certification-Revision': String(revision.current),
              'Content-Type': file.type,
              'X-Certificate-File-Name': encodeURIComponent(file.name),
            },
            body: file,
          }),
          'Your credential details were saved as a draft, but the file change failed. Retry to finish saving.',
        );
        if (!Number.isSafeInteger(result.revision) || result.revision <= revision.current)
          throw Error('File save could not be confirmed. Refresh your records before retrying.');
        revision.current = result.revision;
        imageChanged.current = false;
        if (submit) {
          setPhase('Submitting to your manager…');
          submissionAttempted.current = true;
          revision.current = await onSave(id.current, revision.current, fields, true);
        }
      } else {
        submissionAttempted.current = submit;
        revision.current = await onSave(id.current, revision.current, fields, submit);
      }
      toast.success(
        submit
          ? 'Certification submitted to your assigned current manager.'
          : 'Certification draft saved.',
      );
      window.dispatchEvent(new Event('notifications-updated'));
      onClose();
    } catch (e) {
      const uncertain = uncertainCertificationSave(e);
      setNeedsCheck(uncertain);
      setError(
        (revision.current > (initial?.revision ?? 0) ? 'A draft was saved. ' : '') +
          (e instanceof Error ? e.message : 'Save failed. Your entries are still here.') +
          (uncertain
            ? ' Check the saved draft before retrying. Your entries and selected file are still here.'
            : ''),
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  async function checkSavedDraft() {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    setPhase('Checking saved credential…');
    try {
      const result = await readApiResponse<{ record: CertificationRecord }>(
        await authenticatedFetch(`/api/certifications/${encodeURIComponent(id.current)}`),
        'Saved credential could not be checked. Your entries are still here.',
      );
      const recovered = reconcileCertificationSave(
        result.record,
        id.current,
        attemptedFields.current,
        revision.current,
      );
      if (recovered.complete && submissionAttempted.current) {
        toast.success(
          `Saved credential confirmed: ${result.record.status === 'APPROVED' ? 'Manager reviewed' : 'Pending review'}.`,
        );
        window.dispatchEvent(new Event('notifications-updated'));
        onClose();
        return;
      }
      if (!result.record.canEdit)
        throw Error('This credential is no longer editable. Your entries are still here.');
      revision.current = recovered.revision;
      setNeedsCheck(false);
      storedImage.retry();
      setError(
        'Saved draft checked. Your entries and selected file are still here; review them and retry saving.',
      );
    } catch (e) {
      if ((e as { status?: number }).status === 404 && revision.current === 0) {
        setNeedsCheck(false);
        setError('No saved draft was found. Your entries and file are still here; retry saving.');
      } else setError(e instanceof Error ? e.message : 'Saved credential could not be checked.');
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  /* ── review & save preview (left: file, right: details) ── */
  const reviewContent = (
    <div className="cert-review-split">
      {/* LEFT — certificate file */}
      <section className="cert-review-image-col">
        <h3>Certificate file</h3>
        {imageUrl && (selectedImage || storedImage.file) ? (
          <CertificateFilePreview
            url={imageUrl}
            mimeType={selectedImage?.type ?? storedImage.file!.mimeType}
            fileName={selectedImage?.name ?? storedImage.file!.fileName}
            className="certificate-read-image"
          />
        ) : (
          <p className="cert-help">No file attached.</p>
        )}
      </section>

      {/* RIGHT — details to verify */}
      <section className="cert-review-details-col">
        <h3>Verify details</h3>
        <div className="cert-review-field-list">
          {[
            ['Certification name', fields.certificationName],
            ['Issuer', fields.provider],
            ['Category', fields.category],
            ['Issue date', fields.certificationDate],
            [
              'Expiry date',
              fields.expiryDate === null ? 'Does not expire (Lifetime)' : fields.expiryDate || '—',
            ],
            ['Credential ID', fields.credentialId || '—'],
            ['Issuer / badge link', fields.credentialUrl || '—'],
            ['Supporting notes', fields.notes || '—'],
          ].map(([label, value]) => (
            <div className="cert-review-field-row" key={label}>
              <span className="cert-review-field-label">{label}</span>
              {label === 'Issuer / badge link' && fields.credentialUrl ? (
                <a
                  href={fields.credentialUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="cert-review-link"
                >
                  <span>{fields.credentialUrl}</span>
                  <ExternalLink size={13} aria-hidden="true" />
                </a>
              ) : (
                <span className="cert-review-field-value">{value}</span>
              )}
            </div>
          ))}
        </div>
        <button type="button" className="skill-text-button" onClick={() => changeStep(0)}>
          ← Edit details &amp; file
        </button>
        <div className="skill-next-steps">
          <h3>What happens next</h3>
          <ol>
            <li>Save a draft and finish it later from My certifications.</li>
            <li>Submit when ready for your assigned current manager's review.</li>
            <li>Track feedback and status in My certifications.</li>
          </ol>
        </div>
        <p className="cert-help">
          Manager review records a decision; it does not verify the issuer or set a skill
          proficiency level.
        </p>
      </section>
    </div>
  );

  return (
    <FormDialog
      title={
        initial ? 'Update certification' : renewal ? 'Renew certification' : 'Add certification'
      }
      subtitle={fields.certificationName || 'Record a credential for your capability profile'}
      onClose={close}
      busy={busy}
      className="skill-wizard certification-wizard"
      stepNavigation
      page={step}
      onPageChange={changeStep}
      message={
        busy ? (
          <p role="status">{imageBusy ? 'Preparing certificate file…' : phase}</p>
        ) : error || needsCheck ? (
          <div>
            <p role="alert">
              {error ||
                'Check the previous save before retrying. Your current entries are still here.'}
            </p>
            {needsCheck && (
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => void checkSavedDraft()}
              >
                Check saved draft
              </button>
            )}
          </div>
        ) : undefined
      }
      pages={[
        {
          label: 'Certificate & details',
          content: (
            <div className="skill-details-layout certification-entry-layout">
              {renewal && (
                <p className="cert-renewal-note">
                  This creates a new credential record. Your current manager-reviewed credential
                  stays unchanged while the renewed certificate is submitted for review.
                  {renewalSource && (
                    <span className="cert-renewal-source">
                      Original: {renewalSource.certificationName} · {renewalSource.provider}.{' '}
                      Manager reviewed · {credentialValidity(renewalSource.expiryDate, today)}
                      {renewalSource.expiryDate && ` (expiry: ${renewalSource.expiryDate})`}. Attach
                      the renewed certificate and enter its new validity dates below.
                    </span>
                  )}
                </p>
              )}
              <section className="certification-image-pane">
                <CertificateImageUploader
                  url={selectedImage === undefined ? storedImage.url : localImageUrl}
                  file={
                    selectedImage
                      ? {
                          id: 'selected',
                          fileName: selectedImage.name,
                          mimeType: selectedImage.type,
                          bytes: selectedImage.size,
                        }
                      : storedImage.file
                  }
                  loading={storedImage.loading}
                  error={selectedImage ? '' : storedImage.error}
                  onRetry={storedImage.retry}
                  busy={busy}
                  available={imageAvailable}
                  onBusy={setImageBusy}
                  onChange={image => {
                    setSelectedImage(image);
                    imageChanged.current = true;
                    setError('');
                  }}
                />
              </section>
              <section className="certification-details-pane">
                <h3>Certification details</h3>
                <p className="cert-help">Fill in all details printed on your certificate.</p>
                <fieldset className="cert-meta-grid" disabled={busy}>
                  <legend className="sr-only">Credential details</legend>

                  {/* Certification name — full width */}
                  <label className="form-group" style={{ gridColumn: '1 / -1' }}>
                    <span>
                      Certification name
                      <RequiredMark />
                    </span>
                    <input
                      value={fields.certificationName}
                      maxLength={200}
                      onChange={e => update('certificationName', e.target.value)}
                      autoComplete="off"
                    />
                  </label>

                  {/* Issuer combobox */}
                  <label className="form-group">
                    <span>
                      Issuer
                      <RequiredMark />
                    </span>
                    <ComboBox
                      value={fields.provider}
                      onChange={v => update('provider', v)}
                      presets={ISSUERS}
                      placeholder="e.g. Microsoft, AWS, Oracle"
                      maxLength={120}
                      disabled={busy}
                    />
                  </label>

                  {/* Category combobox */}
                  <label className="form-group">
                    <span>
                      Category
                      <RequiredMark />
                    </span>
                    <ComboBox
                      value={fields.category}
                      onChange={v => update('category', v)}
                      presets={CATEGORIES}
                      placeholder="e.g. Cloud Architecture"
                      maxLength={80}
                      disabled={busy}
                    />
                  </label>

                  {/* Issue date + Expiry date side by side */}
                  <label className="form-group">
                    <span>
                      Issue date
                      <RequiredMark />
                    </span>
                    <input
                      type="date"
                      value={fields.certificationDate}
                      max={today}
                      onChange={e => update('certificationDate', e.target.value)}
                    />
                  </label>

                  {/* Expiry date column */}
                  <div className="form-group cert-expiry-col">
                    <label htmlFor={fields.expiryDate !== null ? 'cert-expiry-date' : undefined}>
                      <span>Expiry date{fields.expiryDate !== null && <RequiredMark />}</span>
                    </label>
                    {fields.expiryDate !== null ? (
                      <div className="cert-expiry-row">
                        <input
                          id="cert-expiry-date"
                          type="date"
                          min={fields.certificationDate || undefined}
                          value={fields.expiryDate}
                          onChange={e => update('expiryDate', e.target.value)}
                        />
                        <select
                          className="cert-expiry-preset"
                          aria-label="Quick-fill expiry date"
                          value=""
                          onChange={e => {
                            const months = parseInt(e.target.value, 10);
                            if (months && fields.certificationDate) {
                              update(
                                'expiryDate',
                                addCredentialMonths(fields.certificationDate, months),
                              );
                            }
                          }}
                        >
                          <option value="">Quick fill…</option>
                          {EXPIRY_PRESETS.map(p => (
                            <option key={p.months} value={p.months}>
                              {p.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div className="cert-lifetime-badge">
                        <ShieldCheck size={16} aria-hidden="true" />
                        <span>Lifetime credential — does not expire</span>
                      </div>
                    )}
                    <label className="cert-no-expire-check">
                      <input
                        type="checkbox"
                        checked={fields.expiryDate === null}
                        onChange={e => update('expiryDate', e.target.checked ? null : '')}
                      />
                      <span>Does not expire</span>
                    </label>
                  </div>

                  {/* Credential ID */}
                  <label className="form-group">
                    Credential ID
                    <input
                      value={fields.credentialId}
                      maxLength={200}
                      onChange={e => update('credentialId', e.target.value)}
                    />
                  </label>

                  {/* Badge link */}
                  <label className="form-group">
                    Issuer / badge link
                    <input
                      type="url"
                      value={fields.credentialUrl}
                      maxLength={1000}
                      placeholder="https://…"
                      onChange={e => update('credentialUrl', e.target.value)}
                    />
                  </label>

                  {/* Notes — full width */}
                  <label className="form-group" style={{ gridColumn: '1 / -1' }}>
                    Supporting notes
                    <textarea
                      value={fields.notes}
                      maxLength={2000}
                      rows={3}
                      onChange={e => update('notes', e.target.value)}
                    />
                  </label>

                  <p className="cert-help">
                    Enter the details printed on your credential. Attach your certificate file on
                    the left.
                  </p>
                </fieldset>
              </section>
            </div>
          ),
        },
        {
          label: 'Review & save',
          content: reviewContent,
        },
      ]}
      footer={
        <>
          {discard ? (
            <div className="cert-discard-prompt" role="alert">
              <span>Discard unsaved certification changes?</span>
              <button type="button" className="secondary-button" onClick={() => setDiscard(false)}>
                Keep editing
              </button>
              <button type="button" className="secondary-button" onClick={onClose}>
                Discard changes
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="secondary-button skill-back"
                disabled={busy || step === 0}
                onClick={() => changeStep(step - 1)}
              >
                <ArrowLeft size={16} aria-hidden="true" />
                Back
              </button>
              <span>{fields.certificationName || 'New certification'}</span>
              <button type="button" className="secondary-button" disabled={busy} onClick={close}>
                Cancel
              </button>
              {step < 1 ? (
                <button
                  type="button"
                  className="admin-primary skill-next"
                  disabled={busy}
                  onClick={() => changeStep(step + 1)}
                >
                  Next
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy || needsCheck}
                    onClick={() => void save(false)}
                  >
                    Save draft
                  </button>
                  <button
                    type="button"
                    className="admin-primary skill-next"
                    disabled={busy || needsCheck || !canSubmit}
                    onClick={() => void save(true)}
                  >
                    Submit for review
                    <Send size={16} aria-hidden="true" />
                  </button>
                </>
              )}
            </>
          )}
        </>
      }
    >
      {!canSubmit && (
        <p className="cert-wizard-help">
          You can save a draft. Submission needs an active current manager with review access.
        </p>
      )}
    </FormDialog>
  );
}
