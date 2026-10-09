import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Send } from 'lucide-react';
import '../skill-wizard.css';
import { FormDialog } from '../FormDialog';
import {
  certificationFieldError,
  certificationFields,
  emptyCertification,
  addCredentialMonths,
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

function RequiredMark() {
  return (
    <>
      {' '}
      <span className="cert-required-mark" aria-hidden="true">
        *
      </span>
      <span className="sr-only">required</span>
    </>
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
  const [inputVal, setInputVal] = useState(value);
  const containerRef = useRef<HTMLDivElement>(null);

  // keep inputVal in sync when external value changes
  useEffect(() => {
    setInputVal(value);
  }, [value]);

  // close on outside click
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const isOtherSelected = value !== '' && !presets.includes(value);
  const typed = inputVal.trim().toLowerCase();

  // suggestions: when user types ≥3 chars, filter presets
  const suggestions =
    typed.length >= 3
      ? presets.filter(p => p.toLowerCase().includes(typed) && p.toLowerCase() !== typed)
      : [];

  const listItems: string[] = ['Other', ...presets];
  const filtered =
    typed.length >= 3
      ? listItems.filter(p => p === 'Other' || p.toLowerCase().includes(typed))
      : listItems;

  function select(item: string) {
    if (item === 'Other') {
      onChange('');
      setInputVal('');
    } else {
      onChange(item);
      setInputVal(item);
    }
    setOpen(false);
  }

  const showDropdown = open || suggestions.length > 0;
  const showSuggestions = !open && suggestions.length > 0;

  return (
    <div ref={containerRef} className="cert-combobox" style={{ position: 'relative' }}>
      <div className="cert-combobox-field">
        <input
          id={id}
          type="text"
          value={inputVal}
          disabled={disabled}
          placeholder={isOtherSelected ? 'Type to enter...' : placeholder}
          maxLength={maxLength}
          autoComplete="off"
          onChange={e => {
            setInputVal(e.target.value);
            onChange(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
        <button
          type="button"
          tabIndex={-1}
          className="cert-combobox-toggle"
          disabled={disabled}
          aria-label="Show options"
          onClick={() => setOpen(o => !o)}
        >
          ▾
        </button>
      </div>
      {(open || showSuggestions) && (
        <ul className="cert-combobox-list" role="listbox">
          {(open ? filtered : suggestions).map(item => (
            <li
              key={item}
              role="option"
              aria-selected={value === item}
              className={value === item || (item === 'Other' && isOtherSelected) ? 'selected' : ''}
              onMouseDown={e => {
                e.preventDefault();
                select(item);
              }}
            >
              {item}
            </li>
          ))}
          {open && filtered.length === 0 && <li className="cert-combobox-empty">No matches</li>}
        </ul>
      )}
    </div>
  );
}

/* ── Main dialog ──────────────────────────────────────── */
export function CertificationDialog({
  initial,
  onClose,
  onSave,
  canSubmit,
  imageAvailable = false,
}: {
  initial?: CertificationRecord | null;
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
    initial ? certificationFields(initial) : emptyCertification(),
  );
  const [step, setStep] = useState(0),
    [error, setError] = useState(''),
    [savingBusy, setBusy] = useState(false),
    [discard, setDiscard] = useState(false);
  const [imageBusy, setImageBusy] = useState(false),
    [selectedImage, setSelectedImage] = useState<File | undefined>(),
    [localImageUrl, setLocalImageUrl] = useState('');
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
    JSON.stringify(initial ? certificationFields(initial) : emptyCertification()),
  );
  const close = () => {
    if (busy) return;
    if (JSON.stringify(fields) !== baseline.current || imageChanged.current) setDiscard(true);
    else onClose();
  };
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
    if (saving.current) return;
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
    try {
      if (imageChanged.current && !selectedImage)
        throw Error('Choose the replacement certificate file before saving.');
      if (imageChanged.current) {
        const file = selectedImage!;
        revision.current = await onSave(id.current, revision.current, fields, false);
        baseline.current = JSON.stringify(fields);
        const root = `/api/certifications/${encodeURIComponent(id.current)}/image`;
        const result = await readApiResponse<{ revision: number }>(
          await authenticatedFetch(root, {
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
        if (submit) revision.current = await onSave(id.current, revision.current, fields, true);
      } else revision.current = await onSave(id.current, revision.current, fields, submit);
      toast.success(
        submit
          ? 'Certification submitted to your assigned current manager.'
          : 'Certification draft saved.',
      );
      window.dispatchEvent(new Event('notifications-updated'));
      onClose();
    } catch (e) {
      setError(
        (revision.current > (initial?.revision ?? 0) ? 'A draft was saved. ' : '') +
          (e instanceof Error ? e.message : 'Save failed. Your entries are still here.'),
      );
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
              fields.expiryDate === null ? 'Does not expire' : fields.expiryDate || '—',
            ],
            ['Credential ID', fields.credentialId || '—'],
            ['Issuer / badge link', fields.credentialUrl || '—'],
            ['Supporting notes', fields.notes || '—'],
          ].map(([label, value]) => (
            <div className="cert-review-field-row" key={label}>
              <span className="cert-review-field-label">{label}</span>
              <span className="cert-review-field-value">{value}</span>
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
      title={initial ? 'Update certification' : 'Add certification'}
      subtitle={fields.certificationName || 'Record a credential for your capability profile'}
      onClose={close}
      busy={busy}
      className="skill-wizard certification-wizard"
      stepNavigation
      page={step}
      onPageChange={changeStep}
      message={error ? <p role="alert">{error}</p> : undefined}
      pages={[
        {
          label: 'Certificate & details',
          content: (
            <div className="skill-details-layout certification-entry-layout">
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
                  error={storedImage.error}
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
                    Certification name
                    <RequiredMark />
                    <input
                      value={fields.certificationName}
                      maxLength={200}
                      onChange={e => update('certificationName', e.target.value)}
                      autoComplete="off"
                    />
                  </label>

                  {/* Issuer combobox */}
                  <label className="form-group">
                    Issuer
                    <RequiredMark />
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
                    Category
                    <RequiredMark />
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
                    Issue date
                    <RequiredMark />
                    <input
                      type="date"
                      value={fields.certificationDate}
                      max={today}
                      onChange={e => update('certificationDate', e.target.value)}
                    />
                  </label>

                  {/* Expiry date column */}
                  <div className="form-group cert-expiry-col">
                    <label htmlFor="cert-expiry-date">
                      Expiry date{fields.expiryDate !== null && <RequiredMark />}
                    </label>
                    {fields.expiryDate !== null && (
                      <>
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
                      </>
                    )}
                    <label className="cert-no-expire-check">
                      <input
                        type="checkbox"
                        checked={fields.expiryDate === null}
                        onChange={e => update('expiryDate', e.target.checked ? null : '')}
                      />
                      Does not expire
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
                    disabled={busy}
                    onClick={() => void save(false)}
                  >
                    {busy ? 'Saving...' : 'Save draft'}
                  </button>
                  <button
                    type="button"
                    className="admin-primary skill-next"
                    disabled={busy || !canSubmit}
                    onClick={() => void save(true)}
                  >
                    {busy ? 'Saving...' : 'Submit for review'}
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
