import { useState, type ChangeEvent } from 'react';
import { FormDialog } from '../FormDialog';
import type { CertificationRecord } from './types';
import { extractFromDocument, extractFromUrl } from './ai-extractor';
import { toast } from '../toast';
import {
  Award,
  Calendar,
  FileCheck2,
  FileText,
  Link as LinkIcon,
  Loader2,
  Sparkles,
  Upload,
} from 'lucide-react';

interface CertificationDialogProps {
  initial?: CertificationRecord | null;
  onClose: () => void;
  onSave: (record: CertificationRecord, submitForReview: boolean) => void;
  currentUser?: {
    name: string;
    employeeCode: string;
    email?: string;
  };
}

export function CertificationDialog({
  initial,
  onClose,
  onSave,
  currentUser,
}: CertificationDialogProps) {
  const [activeTab, setActiveTab] = useState<'upload' | 'url' | 'manual'>('upload');
  const [analyzing, setAnalyzing] = useState(false);
  const [aiNotice, setAiNotice] = useState<string>('');

  // Form states
  const [name, setName] = useState(initial?.name || currentUser?.name || 'Anupriya Banerjee');
  const [employeeCode, setEmployeeCode] = useState(
    initial?.employeeCode || currentUser?.employeeCode || '704427',
  );
  const [du, setDu] = useState(initial?.du || 'DU UK (IN001)');
  const [emailId, setEmailId] = useState(
    initial?.emailId || currentUser?.email || 'anupriya.banerjee@soprasteria.com',
  );
  const [emailType, setEmailType] = useState(initial?.emailType || 'Sopra');

  const [category, setCategory] = useState(initial?.category || 'OCI Infra');
  const [provider, setProvider] = useState(initial?.provider || 'Oracle');
  const [certificationName, setCertificationName] = useState(
    initial?.certificationName || '',
  );
  const [certificationDate, setCertificationDate] = useState(
    initial?.certificationDate || new Date().toISOString().slice(0, 10),
  );
  const [doesNotExpire, setDoesNotExpire] = useState<'Yes' | 'No'>(
    initial?.doesNotExpire || 'Yes',
  );
  const [expiryDate, setExpiryDate] = useState(
    initial?.expiryDate || '2050-12-31',
  );
  const [credentialId, setCredentialId] = useState(initial?.credentialId || '');
  const [credentialUrl, setCredentialUrl] = useState(initial?.credentialUrl || '');
  const [urlInput, setUrlInput] = useState('');

  // Handle file drop / upload with AI extraction
  async function handleFileUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAnalyzing(true);
    setAiNotice('');
    try {
      const extracted = await extractFromDocument(file);
      if (extracted.certificationName) setCertificationName(extracted.certificationName);
      if (extracted.provider) setProvider(extracted.provider);
      if (extracted.category) setCategory(extracted.category);
      if (extracted.certificationDate) setCertificationDate(extracted.certificationDate);
      if (extracted.doesNotExpire) setDoesNotExpire(extracted.doesNotExpire);
      if (extracted.expiryDate) setExpiryDate(extracted.expiryDate);
      if (extracted.credentialId) setCredentialId(extracted.credentialId);
      if (extracted.credentialUrl) setCredentialUrl(extracted.credentialUrl);

      setAiNotice(
        `✨ AI Extracted: ${extracted.provider} - ${extracted.certificationName} (${Math.round(
          (extracted.confidenceScore ?? 0.95) * 100,
        )}% confidence). Review fields below.`,
      );
      toast.success('Certificate analyzed by AI. Details autofilled.');
    } catch {
      toast.error('AI extraction was unable to parse the document. Please enter details manually.');
    } finally {
      setAnalyzing(false);
    }
  }

  // Handle URL fetch
  async function handleUrlFetch() {
    if (!urlInput.trim()) {
      toast.error('Please enter a valid credential or badge URL.');
      return;
    }
    setAnalyzing(true);
    setAiNotice('');
    try {
      const extracted = await extractFromUrl(urlInput);
      if (extracted.certificationName) setCertificationName(extracted.certificationName);
      if (extracted.provider) setProvider(extracted.provider);
      if (extracted.category) setCategory(extracted.category);
      if (extracted.certificationDate) setCertificationDate(extracted.certificationDate);
      if (extracted.doesNotExpire) setDoesNotExpire(extracted.doesNotExpire);
      if (extracted.expiryDate) setExpiryDate(extracted.expiryDate);
      if (extracted.credentialId) setCredentialId(extracted.credentialId);
      setCredentialUrl(urlInput);

      setAiNotice(
        `✨ Verified badge fetched from ${extracted.provider}. Details autofilled below.`,
      );
      toast.success('Badge metadata resolved.');
    } catch {
      toast.error('Could not fetch badge metadata. Please enter details manually.');
    } finally {
      setAnalyzing(false);
    }
  }

  function handleSave(submitForReview: boolean) {
    if (!certificationName.trim()) {
      toast.error('Certification Name is required.');
      return;
    }
    if (!category.trim()) {
      toast.error('Category is required.');
      return;
    }

    const calculatedActive: 'Y' | 'N' =
      doesNotExpire === 'Yes' || new Date(expiryDate) >= new Date() ? 'Y' : 'N';

    const record: CertificationRecord = {
      srNo: initial?.srNo || Math.floor(100 + Math.random() * 900),
      id: initial?.id || `cert-${Date.now()}`,
      name,
      employeeCode,
      du,
      category,
      certificationName,
      certificationDate,
      doesNotExpire,
      expiryDate: doesNotExpire === 'Yes' ? '2050-12-31' : expiryDate,
      active: calculatedActive,
      emailId,
      emailType,
      provider,
      credentialId,
      credentialUrl,
      status: submitForReview ? 'SUBMITTED' : initial?.status || 'DRAFT',
      verified: submitForReview ? false : initial?.verified || false,
      submittedAt: submitForReview ? new Date().toISOString() : initial?.submittedAt,
    };

    onSave(record, submitForReview);
    onClose();
  }

  return (
    <FormDialog
      title={initial ? 'Edit Certification' : 'Add New Certification'}
      subtitle="Record official industry credentials with automated verification and compliance tracking."
      onClose={onClose}
      className="certification-dialog-modal"
    >
      <div className="certification-dialog-content">
        {/* Fast-Input Method Tabs */}
        {!initial && (
          <div className="cert-input-methods">
            <button
              type="button"
              className={`cert-method-btn ${activeTab === 'upload' ? 'active' : ''}`}
              onClick={() => setActiveTab('upload')}
            >
              <Sparkles size={16} />
              AI Certificate Scan
            </button>
            <button
              type="button"
              className={`cert-method-btn ${activeTab === 'url' ? 'active' : ''}`}
              onClick={() => setActiveTab('url')}
            >
              <LinkIcon size={16} />
              Paste Credential Link
            </button>
            <button
              type="button"
              className={`cert-method-btn ${activeTab === 'manual' ? 'active' : ''}`}
              onClick={() => setActiveTab('manual')}
            >
              <FileText size={16} />
              Manual Entry
            </button>
          </div>
        )}

        {/* AI File Drop Area */}
        {activeTab === 'upload' && !initial && (
          <div className="cert-dropzone-box">
            <input
              type="file"
              id="cert-file-upload"
              accept=".pdf,.png,.jpg,.jpeg,.webp"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
              disabled={analyzing}
            />
            <label htmlFor="cert-file-upload" className="cert-dropzone-label">
              {analyzing ? (
                <div className="cert-scanning-indicator">
                  <Loader2 size={36} className="cert-spin" />
                  <p className="cert-scan-title">AI Vision Analyzing Document…</p>
                  <p className="cert-scan-hint">
                    Extracting Provider, Certification Title, Issue & Expiry Dates, and Credential ID.
                  </p>
                </div>
              ) : (
                <div className="cert-dropzone-idle">
                  <div className="cert-dropzone-icon-circle">
                    <Upload size={28} />
                  </div>
                  <p className="cert-dropzone-title">Upload Certificate (PDF, PNG, JPG)</p>
                  <p className="cert-dropzone-hint">
                    Drop your certificate file here to automatically autofill details.
                  </p>
                  <span className="cert-browse-button">Browse File</span>
                </div>
              )}
            </label>
          </div>
        )}

        {/* URL Input Area */}
        {activeTab === 'url' && !initial && (
          <div className="cert-url-fetch-box">
            <label htmlFor="cred-url-input">Badge / Verification URL</label>
            <div className="cert-url-input-row">
              <input
                id="cred-url-input"
                type="url"
                placeholder="https://www.credly.com/badges/..."
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                disabled={analyzing}
              />
              <button
                type="button"
                className="secondary-button"
                onClick={handleUrlFetch}
                disabled={analyzing || !urlInput.trim()}
              >
                {analyzing ? <Loader2 size={16} className="cert-spin" /> : <Sparkles size={16} />}
                Autofill via Link
              </button>
            </div>
            <p className="field-hint">
              Supports Credly, Microsoft Learn, Oracle CertView, Accredible, and Coursera transcripts.
            </p>
          </div>
        )}

        {/* AI Notice Banner */}
        {aiNotice && (
          <div className="cert-ai-notice-banner" role="status">
            <Sparkles size={18} />
            <span>{aiNotice}</span>
          </div>
        )}

        {/* Form Fields Grid */}
        <div className="cert-form-grid">
          <div className="form-group">
            <label htmlFor="cert-name">Employee Name *</label>
            <input
              id="cert-name"
              type="text"
              value={name}
              disabled={Boolean(currentUser?.name)}
              onChange={e => setName(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="cert-code">Employee Code *</label>
            <input
              id="cert-code"
              type="text"
              value={employeeCode}
              disabled={Boolean(currentUser?.employeeCode)}
              onChange={e => setEmployeeCode(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="cert-du">Delivery Unit (DU) *</label>
            <input
              id="cert-du"
              type="text"
              value={du}
              onChange={e => setDu(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="cert-category">Category *</label>
            <select
              id="cert-category"
              value={category}
              onChange={e => setCategory(e.target.value)}
            >
              <option value="OCI Infra">OCI Infra</option>
              <option value="Oracle AI">Oracle AI</option>
              <option value="HR & Payroll">HR & Payroll</option>
              <option value="Cloud Architecture">Cloud Architecture</option>
              <option value="DevOps & SRE">DevOps & SRE</option>
              <option value="Cybersecurity">Cybersecurity</option>
              <option value="Data & Analytics">Data & Analytics</option>
              <option value="Agile & Scrum">Agile & Scrum</option>
            </select>
          </div>

          <div className="form-group form-group-full">
            <label htmlFor="cert-title">Certification Name *</label>
            <input
              id="cert-title"
              type="text"
              placeholder="e.g. Oracle Cloud Infrastructure Digital Assistant Professional"
              value={certificationName}
              onChange={e => setCertificationName(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="cert-provider">Provider / Issuer *</label>
            <input
              id="cert-provider"
              type="text"
              placeholder="e.g. Oracle, AWS, Microsoft"
              value={provider}
              onChange={e => setProvider(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="cert-date">Certification Date (Issued) *</label>
            <input
              id="cert-date"
              type="date"
              value={certificationDate}
              onChange={e => setCertificationDate(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="cert-no-expiry">Does Not Expire?</label>
            <select
              id="cert-no-expiry"
              value={doesNotExpire}
              onChange={e => {
                const val = e.target.value as 'Yes' | 'No';
                setDoesNotExpire(val);
                if (val === 'Yes') setExpiryDate('2050-12-31');
              }}
            >
              <option value="Yes">Yes (Lifetime / No Expiry)</option>
              <option value="No">No (Has Expiration Date)</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="cert-expiry">Expiry Date *</label>
            <input
              id="cert-expiry"
              type="date"
              value={expiryDate}
              disabled={doesNotExpire === 'Yes'}
              onChange={e => setExpiryDate(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="cert-id">Credential ID</label>
            <input
              id="cert-id"
              type="text"
              placeholder="e.g. OCI-DA-704427-23"
              value={credentialId}
              onChange={e => setCredentialId(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="cert-url">Credential / Badge URL</label>
            <input
              id="cert-url"
              type="url"
              placeholder="https://..."
              value={credentialUrl}
              onChange={e => setCredentialUrl(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="cert-email">Email ID</label>
            <input
              id="cert-email"
              type="email"
              value={emailId}
              onChange={e => setEmailId(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="cert-email-type">Email Type</label>
            <input
              id="cert-email-type"
              type="text"
              value={emailType}
              onChange={e => setEmailType(e.target.value)}
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="certification-dialog-footer">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <div className="cert-dialog-submit-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => handleSave(false)}
            >
              Save as Draft
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => handleSave(true)}
            >
              <FileCheck2 size={16} />
              Submit for Verification
            </button>
          </div>
        </div>
      </div>
    </FormDialog>
  );
}
