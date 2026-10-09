import { useRef, useState } from 'react';
import { FormDialog } from '../FormDialog';
import {
  certificationFieldError,
  certificationFields,
  emptyCertification,
} from './certification-model';
import type { CertificationFields, CertificationRecord } from './types';

export function CertificationDialog({
  initial,
  onClose,
  onSave,
  canSubmit,
}: {
  initial?: CertificationRecord | null;
  canSubmit: boolean;
  onClose: () => void;
  onSave: (
    id: string,
    revision: number,
    fields: CertificationFields,
    submit: boolean,
  ) => Promise<void>;
}) {
  const [fields, setFields] = useState<CertificationFields>(() =>
    initial ? certificationFields(initial) : emptyCertification(),
  );
  const [step, setStep] = useState(0),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
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
    const invalid = certificationFieldError(fields, today);
    if (invalid) {
      setError(invalid);
      setStep(0);
      return;
    }
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      await onSave(id.current, initial?.revision ?? 0, fields, submit);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed. Your entries are still here.');
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <FormDialog
      title={initial ? 'Update certification' : 'Add certification'}
      subtitle="Record a credential, check its details, then send it to your current manager."
      onClose={onClose}
      busy={busy}
      className="certification-dialog-modal"
    >
      <div className="certification-dialog-content">
        <ol className="cert-steps" aria-label="Certification steps">
          <li aria-current={step === 0 ? 'step' : undefined}>1. Credential details</li>
          <li aria-current={step === 1 ? 'step' : undefined}>2. Review & submit</li>
        </ol>
        {error && <p role="alert">{error}</p>}
        {!canSubmit && (
          <p className="cert-help">
            You can save a draft. Submission needs an active current manager with review access.
          </p>
        )}
        {step === 0 ? (
          <fieldset className="cert-meta-grid" disabled={busy}>
            <legend className="sr-only">Credential details</legend>
            <label className="form-group">
              Certification name *
              <input
                value={fields.certificationName}
                maxLength={200}
                onChange={e => update('certificationName', e.target.value)}
                autoComplete="off"
              />
            </label>
            <label className="form-group">
              Issuer *
              <input
                value={fields.provider}
                maxLength={120}
                placeholder="e.g. Microsoft, AWS, Oracle"
                onChange={e => update('provider', e.target.value)}
              />
            </label>
            <label className="form-group">
              Category *
              <input
                value={fields.category}
                maxLength={80}
                placeholder="e.g. Cloud architecture"
                onChange={e => update('category', e.target.value)}
              />
            </label>
            <label className="form-group">
              Issue date *
              <input
                type="date"
                value={fields.certificationDate}
                max={today}
                onChange={e => update('certificationDate', e.target.value)}
              />
            </label>
            <label className="form-group">
              <span>
                <input
                  type="checkbox"
                  checked={fields.expiryDate === null}
                  onChange={e => update('expiryDate', e.target.checked ? null : '')}
                />{' '}
                This credential does not expire
              </span>
            </label>
            {fields.expiryDate !== null && (
              <label className="form-group">
                Expiry date *
                <input
                  type="date"
                  min={fields.certificationDate || undefined}
                  value={fields.expiryDate}
                  onChange={e => update('expiryDate', e.target.value)}
                />
              </label>
            )}
            <label className="form-group">
              Credential ID (optional)
              <input
                value={fields.credentialId}
                maxLength={200}
                onChange={e => update('credentialId', e.target.value)}
              />
            </label>
            <label className="form-group">
              Issuer / badge link (optional)
              <input
                type="url"
                value={fields.credentialUrl}
                maxLength={1000}
                placeholder="https://…"
                onChange={e => update('credentialUrl', e.target.value)}
              />
            </label>
            <label className="form-group">
              Supporting notes (optional)
              <textarea
                value={fields.notes}
                maxLength={2000}
                rows={3}
                onChange={e => update('notes', e.target.value)}
              />
            </label>
            <p className="cert-help">
              Enter the details printed on your credential. Document scanning and file uploads are
              not available in this release.
            </p>
          </fieldset>
        ) : (
          <section className="cert-review-banner">
            <h3>{fields.certificationName}</h3>
            <p>
              {fields.provider} · {fields.category}
            </p>
            <p>
              Issued {fields.certificationDate} ·{' '}
              {fields.expiryDate ? `Expires ${fields.expiryDate}` : 'No expiry'}
            </p>
            {fields.credentialId && <p>Credential ID: {fields.credentialId}</p>}
            {fields.credentialUrl && <p>{fields.credentialUrl}</p>}
            {fields.notes && <p>{fields.notes}</p>}
            <p>
              Submitting locks these details for your assigned current manager to review. Manager
              review records their decision; it does not verify the issuer or set a skill
              proficiency level.
            </p>
          </section>
        )}
        <div className="certification-dialog-footer">
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={step ? () => setStep(0) : onClose}
          >
            {step ? 'Back to details' : 'Cancel'}
          </button>
          <div className="cert-dialog-submit-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => void save(false)}
            >
              {busy ? 'Saving…' : 'Save draft'}
            </button>
            {step === 0 ? (
              <button
                type="button"
                className="primary-button"
                disabled={busy}
                onClick={() => {
                  const invalid = certificationFieldError(fields, today);
                  setError(invalid);
                  if (!invalid) setStep(1);
                }}
              >
                Review details
              </button>
            ) : (
              <button
                type="button"
                className="primary-button"
                disabled={busy || !canSubmit}
                onClick={() => void save(true)}
              >
                {busy ? 'Saving…' : canSubmit ? 'Submit to manager' : 'Manager review unavailable'}
              </button>
            )}
          </div>
        </div>
      </div>
    </FormDialog>
  );
}
