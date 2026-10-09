import { useRef, useState } from 'react';
import { FormDialog } from '../FormDialog';
import { editableFields } from './certification-api';
import type { CertificationChange, CertificationFields, CertificationRecord } from './types';

export function CertificationDialog({
  initial,
  onClose,
  onSave,
  currentUser,
}: {
  initial?: CertificationRecord;
  currentUser: { displayName: string; employeeCode: string };
  onClose: () => void;
  onSave: (input: CertificationChange) => Promise<void>;
}) {
  const [id] = useState(() => initial?.id ?? crypto.randomUUID());
  const [fields, setFields] = useState<CertificationFields>(() =>
    initial
      ? editableFields(initial)
      : {
          certificationName: '',
          provider: '',
          category: '',
          certificationDate: new Date().toISOString().slice(0, 10),
          expiryDate: null,
          credentialId: '',
          credentialUrl: '',
        },
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const intent = useRef<'SAVE' | 'SUBMIT'>('SAVE');
  const pending = useRef(false);
  function field<K extends keyof CertificationFields>(key: K, value: CertificationFields[K]) {
    setFields(previous => ({ ...previous, [key]: value }));
  }
  async function submit() {
    if (pending.current) return;
    const action = intent.current;
    if (
      fields.certificationDate > new Date().toISOString().slice(0, 10) ||
      (fields.expiryDate !== null && fields.expiryDate < fields.certificationDate)
    ) {
      setError('Issue date cannot be in the future. Expiry must be on or after issue.');
      return;
    }
    if (action === 'SUBMIT' && !fields.credentialUrl.trim()) {
      setError('Add an HTTPS issuer verification link before submitting.');
      return;
    }
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await onSave({ id, revision: initial?.revision ?? 0, action, fields });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The certification could not be saved.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <FormDialog
      title={initial ? 'Edit certification draft' : 'Add certification'}
      subtitle="Manual entry. A credential does not automatically verify skill proficiency."
      className="certification-dialog-modal"
      formId="certification-form"
      onSubmit={() => void submit()}
      onClose={onClose}
      busy={busy}
      message={error ? <p role="alert">{error}</p> : undefined}
      footer={
        <div className="certification-dialog-footer">
          <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <div className="cert-dialog-submit-actions">
            <button
              className="secondary-button"
              type="submit"
              form="certification-form"
              disabled={busy}
              onClick={() => {
                intent.current = 'SAVE';
              }}
            >
              Save draft
            </button>
            <button
              className="primary-button"
              type="submit"
              form="certification-form"
              disabled={busy}
              onClick={() => {
                intent.current = 'SUBMIT';
              }}
            >
              {busy ? 'Saving...' : 'Submit to current manager'}
            </button>
          </div>
        </div>
      }
    >
      <p>
        {currentUser.displayName} ({currentUser.employeeCode}). Identity and delivery unit are
        resolved by the server.
      </p>
      <p className="field-hint">
        AI extraction and file uploads are not available. Add facts from your certificate and a
        public issuer verification link; a human reviewer must check the recipient and provenance.
      </p>
      {initial?.feedbackNote && (
        <p className="cert-feedback-note">
          <strong>Latest reviewer feedback:</strong> {initial.feedbackNote}
        </p>
      )}
      <div className="cert-form-grid">
        <div className="form-group form-group-full">
          <label htmlFor="cert-title">Certification name (required)</label>
          <input
            id="cert-title"
            value={fields.certificationName}
            required
            maxLength={200}
            onChange={e => field('certificationName', e.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="cert-provider">Issuer (required)</label>
          <input
            id="cert-provider"
            value={fields.provider}
            required
            maxLength={100}
            onChange={e => field('provider', e.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="cert-category">Category (required)</label>
          <input
            id="cert-category"
            value={fields.category}
            required
            maxLength={100}
            onChange={e => field('category', e.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="cert-date">Issue date (required)</label>
          <input
            id="cert-date"
            type="date"
            value={fields.certificationDate}
            required
            min="1900-01-01"
            max={new Date().toISOString().slice(0, 10)}
            onChange={e => field('certificationDate', e.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="cert-lifetime">Expiration</label>
          <select
            id="cert-lifetime"
            value={fields.expiryDate === null ? 'lifetime' : 'dated'}
            onChange={e => field('expiryDate', e.target.value === 'lifetime' ? null : '')}
          >
            <option value="lifetime">Does not expire</option>
            <option value="dated">Has an expiry date</option>
          </select>
        </div>
        {fields.expiryDate !== null && (
          <div className="form-group">
            <label htmlFor="cert-expiry">Expiry date (required)</label>
            <input
              id="cert-expiry"
              type="date"
              value={fields.expiryDate}
              required
              min={fields.certificationDate}
              onChange={e => field('expiryDate', e.target.value)}
            />
          </div>
        )}
        <div className="form-group">
          <label htmlFor="cert-id">Credential ID</label>
          <input
            id="cert-id"
            value={fields.credentialId}
            maxLength={100}
            onChange={e => field('credentialId', e.target.value)}
          />
        </div>
        <div className="form-group form-group-full">
          <label htmlFor="cert-url">HTTPS issuer verification link (required to submit)</label>
          <input
            id="cert-url"
            type="url"
            value={fields.credentialUrl}
            maxLength={500}
            placeholder="https://..."
            pattern="https://.*"
            onChange={e => field('credentialUrl', e.target.value)}
            aria-describedby="cert-proof-help"
          />
          <p id="cert-proof-help" className="field-hint">
            Use the issuer's public credential page, not a file path. Saving a draft does not verify
            this link.
          </p>
        </div>
      </div>
    </FormDialog>
  );
}
