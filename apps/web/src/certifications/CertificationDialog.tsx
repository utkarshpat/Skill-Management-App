import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Send } from 'lucide-react';
import '../skill-wizard.css';
import { FormDialog } from '../FormDialog';
import {
  certificationFieldError,
  certificationFields,
  emptyCertification,
} from './certification-model';
import type { CertificationFields, CertificationRecord } from './types';
import { CertificateImageUploader, useCertificationImage } from './CertificationImage';
import { authenticatedFetch } from '../auth';
import { readApiResponse } from '../api-response';
import { toast } from '../toast';

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
    [selectedImage, setSelectedImage] = useState<Blob | null | undefined>(),
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
    if (imageBusy || storedImage.loading)
      return 'Wait for the certificate image to finish loading.';
    if (storedImage.error && selectedImage === undefined) return storedImage.error;
    if (!imageAvailable)
      return 'Certificate image storage is unavailable. Try again when uploads are configured.';
    return (selectedImage === undefined ? Boolean(storedImage.url) : Boolean(selectedImage))
      ? ''
      : 'Attach a certificate image before continuing.';
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
      if (imageChanged.current) {
        revision.current = await onSave(id.current, revision.current, fields, false);
        baseline.current = JSON.stringify(fields);
        const root = `/api/certifications/${encodeURIComponent(id.current)}/image`;
        const result = await readApiResponse<{ revision: number }>(
          await authenticatedFetch(root, {
            method: selectedImage ? 'POST' : 'DELETE',
            headers: {
              'X-Certification-Revision': String(revision.current),
              ...(selectedImage ? { 'Content-Type': selectedImage.type } : {}),
            },
            ...(selectedImage ? { body: selectedImage } : {}),
          }),
          'Your credential details were saved as a draft, but the image change failed. Retry to finish saving.',
        );
        if (!Number.isSafeInteger(result.revision) || result.revision <= revision.current)
          throw Error('Image save could not be confirmed. Refresh your records before retrying.');
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
  const preview = (
    <div className="skill-preview-card">
      {imageUrl && (
        <img className="certificate-read-image" src={imageUrl} alt="Certificate image preview" />
      )}
      <h3>{fields.certificationName || 'Your certification'}</h3>
      <p>
        {fields.provider || 'Issuer'} &middot; {fields.category || 'Category'}
      </p>
      <span className="cert-category-badge">Draft</span>
      <p>Issued: {fields.certificationDate || 'Choose an issue date'}</p>
      <p>
        {fields.expiryDate === null
          ? 'Does not expire'
          : `Expires: ${fields.expiryDate || 'Choose an expiry date'}`}
      </p>
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

                <p className="cert-help">
                  Your image is compressed automatically before saving. Use a clear, readable
                  certificate.
                </p>
              </section>
              <section className="certification-details-pane">
                <h3>Certification details</h3>
                <p className="cert-help">Fill in all details printed on your certificate.</p>
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
                    Enter the details printed on your credential. Attach your certificate image on
                    the left.
                  </p>
                </fieldset>
              </section>
            </div>
          ),
        },
        {
          label: 'Review & save',
          content: (
            <div className="skill-review-layout">
              <section>
                <h3>Review your certification information</h3>
                <div className="skill-review-section">
                  <h3>{fields.certificationName}</h3>
                  <p>
                    {fields.provider} &middot; {fields.category}
                  </p>
                  <button type="button" className="skill-text-button" onClick={() => changeStep(0)}>
                    Edit credential
                  </button>
                </div>
                {[
                  ['Issue date', fields.certificationDate],
                  [
                    'Expiry date',
                    fields.expiryDate === null ? 'Does not expire' : fields.expiryDate,
                  ],
                  ['Credential ID', fields.credentialId || 'Not provided'],
                  ['Issuer / badge link', fields.credentialUrl || 'Not provided'],
                  ['Supporting notes', fields.notes || 'Not provided'],
                ].map(([label, value]) => (
                  <div className="skill-review-section" key={label}>
                    <h3>{label}</h3>
                    <p className="skill-summary-text">{value}</p>
                  </div>
                ))}
                <button type="button" className="skill-text-button" onClick={() => changeStep(0)}>
                  Edit details & image
                </button>
              </section>
              <section className="skill-save-preview">
                <h3>Certification preview</h3>
                {preview}
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
          ),
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
