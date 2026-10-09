import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router';
import type { CertificationRecord } from './types';
import { loadStoredCertifications, saveStoredCertifications } from './initial-data';
import { downloadCertificationsCsv } from './certification-reports';
import { CertificationDialog } from './CertificationDialog';
import { CertificationReviewDialog } from './CertificationReviewDialog';
import { toast } from '../toast';
import type { WorkspaceState } from '../Workspace';
import './certifications.css';
import {
  Award,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileSpreadsheet,
  Filter,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCheck,
  Users,
} from 'lucide-react';

export function Certifications({
  workspace,
  actionsContainer,
}: {
  workspace?: WorkspaceState;
  actionsContainer?: HTMLDivElement | null;
}) {
  const [searchParams, setSearchParams] = useSearchParams();

  // Role detection
  const person = workspace?.person;
  const roles = person?.roles || [];
  const capabilities = workspace?.capabilities;

  const isCapabilityLead = useMemo(() => {
    return Boolean(
      roles.some(r =>
        /capability lead|delivery unit head|department head|chro|administrator|admin/i.test(r),
      ) ||
        capabilities?.administration ||
        capabilities?.manageCatalogue,
    );
  }, [roles, capabilities]);

  const isManager = useMemo(() => {
    return Boolean(
      isCapabilityLead ||
        capabilities?.reviewSkills ||
        roles.some(r => /manager|lead/i.test(r)),
    );
  }, [isCapabilityLead, capabilities, roles]);

  // Allowed tabs based on role
  const allowedTabs = useMemo(() => {
    if (isCapabilityLead) return ['directory', 'queue', 'mine'] as const;
    if (isManager) return ['queue', 'mine'] as const;
    return ['mine'] as const;
  }, [isCapabilityLead, isManager]);

  // Tab State
  const defaultTab = isCapabilityLead ? 'directory' : isManager ? 'queue' : 'mine';
  const paramTab = searchParams.get('tab');
  const initialTab =
    paramTab && (allowedTabs as readonly string[]).includes(paramTab)
      ? (paramTab as 'directory' | 'queue' | 'mine')
      : defaultTab;

  const [activeTab, setActiveTab] = useState<'directory' | 'queue' | 'mine'>(initialTab);

  // Sync tab with URL search params
  const handleTabChange = (tab: 'directory' | 'queue' | 'mine') => {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };

  const [records, setRecords] = useState<CertificationRecord[]>(() =>
    loadStoredCertifications(),
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDu, setSelectedDu] = useState<string>('ALL');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedActive, setSelectedActive] = useState<string>('ALL');

  // Modals state
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingCert, setEditingCert] = useState<CertificationRecord | null>(null);
  const [reviewingCert, setReviewingCert] = useState<CertificationRecord | null>(null);

  // Listen for storage sync
  useEffect(() => {
    const handleUpdate = () => {
      setRecords(loadStoredCertifications());
    };
    window.addEventListener('certifications-updated', handleUpdate);
    return () => window.removeEventListener('certifications-updated', handleUpdate);
  }, []);

  function persistAndSet(updated: CertificationRecord[]) {
    setRecords(updated);
    saveStoredCertifications(updated);
  }

  // Calculate Metrics
  const metrics = useMemo(() => {
    // If regular employee, metrics only reflect own portfolio
    const baseRecords =
      !isManager && person?.displayName
        ? records.filter(
            r =>
              r.name.toLowerCase() === person.displayName.toLowerCase() ||
              (person.employeeCode && r.employeeCode === person.employeeCode),
          )
        : records;

    const total = baseRecords.length;
    const activeCount = baseRecords.filter(r => r.active === 'Y').length;
    const pendingQueueCount = records.filter(r => r.status === 'SUBMITTED').length;

    const now = new Date();
    const in90Days = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    const expiringSoonCount = baseRecords.filter(r => {
      if (r.doesNotExpire === 'Yes' || r.active !== 'Y') return false;
      const exp = new Date(r.expiryDate);
      return exp >= now && exp <= in90Days;
    }).length;

    return { total, activeCount, pendingQueueCount, expiringSoonCount };
  }, [records, isManager, person]);

  // Unique filters
  const duOptions = useMemo(() => {
    return Array.from(new Set(records.map(r => r.du))).sort();
  }, [records]);

  const categoryOptions = useMemo(() => {
    return Array.from(new Set(records.map(r => r.category))).sort();
  }, [records]);

  // Filtered records
  const filteredRecords = useMemo(() => {
    return records.filter(r => {
      // Tab based scoping
      if (activeTab === 'queue' && r.status !== 'SUBMITTED') return false;

      if (activeTab === 'mine') {
        const currentName = person?.displayName?.toLowerCase();
        const currentCode = person?.employeeCode;
        const matchesCurrent =
          (currentName && r.name.toLowerCase() === currentName) ||
          (currentCode && r.employeeCode === currentCode);
        // Fallback for demo when user is Anupriya
        if (!matchesCurrent && (!person || person.displayName === 'Anupriya Banerjee')) {
          if (r.name !== 'Anupriya Banerjee' && r.employeeCode !== '704427') return false;
        } else if (!matchesCurrent) {
          return false;
        }
      }

      if (selectedDu !== 'ALL' && r.du !== selectedDu) return false;
      if (selectedCategory !== 'ALL' && r.category !== selectedCategory) return false;
      if (selectedActive !== 'ALL' && r.active !== selectedActive) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const match =
          r.name.toLowerCase().includes(q) ||
          r.employeeCode.toLowerCase().includes(q) ||
          r.certificationName.toLowerCase().includes(q) ||
          r.category.toLowerCase().includes(q) ||
          r.emailId.toLowerCase().includes(q) ||
          r.provider.toLowerCase().includes(q);
        if (!match) return false;
      }

      return true;
    });
  }, [records, activeTab, selectedDu, selectedCategory, selectedActive, searchQuery, person]);

  // Handlers
  function handleSaveCertification(
    newRecord: CertificationRecord,
    submittedForReview: boolean,
  ) {
    let updated: CertificationRecord[];
    const exists = records.some(r => r.id === newRecord.id);

    if (exists) {
      updated = records.map(r => (r.id === newRecord.id ? newRecord : r));
    } else {
      updated = [newRecord, ...records];
    }

    persistAndSet(updated);
    toast.success(
      submittedForReview
        ? 'Certification submitted for verification to Capability Lead / Manager.'
        : 'Certification saved as draft.',
    );
  }

  function handleReviewDecision(
    id: string,
    decision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED',
    feedbackNote?: string,
  ) {
    const updated = records.map(r => {
      if (r.id !== id) return r;
      return {
        ...r,
        status: decision,
        active: decision === 'APPROVED' ? ('Y' as const) : r.active,
        verified: decision === 'APPROVED',
        feedbackNote,
        reviewedBy: person?.displayName || 'Capability Reviewer',
        reviewedAt: new Date().toISOString().slice(0, 10),
      };
    });

    persistAndSet(updated);

    if (decision === 'APPROVED') {
      toast.success('Certification approved and verified successfully.');
    } else if (decision === 'CHANGES_REQUESTED') {
      toast.success('Feedback sent. Changes requested from candidate.');
    } else {
      toast.error('Certification rejected.');
    }
  }

  function handleDownloadReport() {
    downloadCertificationsCsv(
      records,
      `sopra-steria-capability-certifications-${new Date().toISOString().slice(0, 10)}.csv`,
    );
    toast.success('Capability Lead Certification report downloaded (CSV).');
  }

  const actionButtons = (
    <div className="cert-header-actions">
      {isCapabilityLead && (
        <button
          type="button"
          className="secondary-button"
          onClick={handleDownloadReport}
          title="Download CSV report matching Capability Lead format"
        >
          <FileSpreadsheet size={16} />
          Export Capability Report (CSV)
        </button>
      )}
      <button
        type="button"
        className="primary-button"
        onClick={() => {
          setEditingCert(null);
          setShowAddDialog(true);
        }}
      >
        <Plus size={16} />
        Add Certification
      </button>
    </div>
  );

  return (
    <div className="certifications-container">
      {/* Top Header */}
      <header className="certifications-header">
        <div className="cert-header-title-wrap">
          <h1>
            <Award className="cert-header-award-icon" size={26} />
            Certifications & Credentials
          </h1>
          <p>
            {isCapabilityLead
              ? 'Organization capability governance, credential compliance, and verification workbench.'
              : isManager
                ? 'Team verification queue and professional credential compliance.'
                : 'Manage your verified industry credentials, licenses, and renewals.'}
          </p>
        </div>
        {!actionsContainer && actionButtons}
      </header>

      {actionsContainer && createPortal(actionButtons, actionsContainer)}

      {/* KPI Metric Summary Cards */}
      <section className="cert-kpi-grid" aria-label="Certification Metrics">
        <div className="cert-kpi-card">
          <div className="cert-kpi-icon kpi-blue">
            <Award size={22} />
          </div>
          <div className="cert-kpi-body">
            <span className="cert-kpi-label">
              {isCapabilityLead ? 'Total Credentials' : 'My Credentials'}
            </span>
            <span className="cert-kpi-value">{metrics.total}</span>
            <span className="cert-kpi-hint">
              {isCapabilityLead ? 'Across capability units' : 'Registered in profile'}
            </span>
          </div>
        </div>

        <div className="cert-kpi-card">
          <div className="cert-kpi-icon kpi-teal">
            <CheckCircle2 size={22} />
          </div>
          <div className="cert-kpi-body">
            <span className="cert-kpi-label">Active & Valid</span>
            <span className="cert-kpi-value">{metrics.activeCount}</span>
            <span className="cert-kpi-hint">Compliance verified</span>
          </div>
        </div>

        <div className="cert-kpi-card">
          <div className="cert-kpi-icon kpi-amber">
            <Clock size={22} />
          </div>
          <div className="cert-kpi-body">
            <span className="cert-kpi-label">Expiring Soon</span>
            <span className="cert-kpi-value">{metrics.expiringSoonCount}</span>
            <span className="cert-kpi-hint">Within 90 days</span>
          </div>
        </div>

        {isManager && (
          <div className="cert-kpi-card">
            <div className="cert-kpi-icon kpi-rose">
              <ShieldCheck size={22} />
            </div>
            <div className="cert-kpi-body">
              <span className="cert-kpi-label">Verification Queue</span>
              <span className="cert-kpi-value">{metrics.pendingQueueCount}</span>
              <span className="cert-kpi-hint">Awaiting manager decision</span>
            </div>
          </div>
        )}
      </section>

      {/* Navigation Sub-Tabs with Role Gating */}
      <nav className="cert-nav-tabs" role="tablist" aria-label="Certification Views">
        {isCapabilityLead && (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'directory'}
            className={`cert-nav-tab-btn ${activeTab === 'directory' ? 'active' : ''}`}
            onClick={() => handleTabChange('directory')}
          >
            <FileSpreadsheet size={16} />
            Capability Lead Directory
          </button>
        )}

        {isManager && (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'queue'}
            className={`cert-nav-tab-btn ${activeTab === 'queue' ? 'active' : ''}`}
            onClick={() => handleTabChange('queue')}
          >
            <ShieldCheck size={16} />
            Verification Queue
            {metrics.pendingQueueCount > 0 && (
              <span className="cert-tab-badge">{metrics.pendingQueueCount}</span>
            )}
          </button>
        )}

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'mine'}
          className={`cert-nav-tab-btn ${activeTab === 'mine' ? 'active' : ''}`}
          onClick={() => handleTabChange('mine')}
        >
          <UserCheck size={16} />
          My Certifications
        </button>
      </nav>

      {/* Filter and Search Bar */}
      <section className="cert-filter-bar">
        <div className="cert-search-box">
          <Search size={16} className="cert-search-icon" />
          <input
            type="search"
            placeholder={
              activeTab === 'mine'
                ? 'Search your certifications by title, provider, category...'
                : 'Search candidate, employee code, cert name, category...'
            }
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="cert-filter-selects">
          {activeTab !== 'mine' && (
            <select
              value={selectedDu}
              onChange={e => setSelectedDu(e.target.value)}
              aria-label="Filter by DU"
            >
              <option value="ALL">All DUs</option>
              {duOptions.map(du => (
                <option key={du} value={du}>
                  {du}
                </option>
              ))}
            </select>
          )}

          <select
            value={selectedCategory}
            onChange={e => setSelectedCategory(e.target.value)}
            aria-label="Filter by Category"
          >
            <option value="ALL">All Categories</option>
            {categoryOptions.map(c => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            value={selectedActive}
            onChange={e => setSelectedActive(e.target.value)}
            aria-label="Filter by Active Status"
          >
            <option value="ALL">All Statuses</option>
            <option value="Y">Active (Y)</option>
            <option value="N">Inactive / Expired (N)</option>
          </select>
        </div>
      </section>

      {/* Table Section */}
      <section className="cert-table-container">
        <table className="cert-data-table">
          <thead>
            <tr>
              <th>Sr NO</th>
              {activeTab !== 'mine' && <th>Name</th>}
              {activeTab !== 'mine' && <th>Employee Code</th>}
              <th>DU</th>
              <th>Category</th>
              <th>Certification Name</th>
              <th>Certification Date</th>
              <th>Does Not Expire</th>
              <th>Expiry Date</th>
              <th>Active</th>
              {activeTab !== 'mine' && <th>Email ID</th>}
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredRecords.length === 0 ? (
              <tr>
                <td
                  colSpan={activeTab === 'mine' ? 10 : 13}
                  className="cert-empty-state-cell"
                >
                  <Award size={32} className="cert-empty-icon" />
                  <p className="cert-empty-title">
                    {activeTab === 'queue'
                      ? 'No pending verification requests'
                      : activeTab === 'mine'
                        ? 'No personal certifications recorded'
                        : 'No records matching the selected filters'}
                  </p>
                  <p className="cert-empty-hint">
                    {activeTab === 'mine'
                      ? 'Add your professional certifications to showcase verified credentials in your profile.'
                      : 'All submissions have been reviewed.'}
                  </p>
                  {activeTab === 'mine' && (
                    <button
                      type="button"
                      className="primary-button"
                      style={{ marginTop: '0.75rem' }}
                      onClick={() => setShowAddDialog(true)}
                    >
                      <Plus size={15} /> Add Certification
                    </button>
                  )}
                </td>
              </tr>
            ) : (
              filteredRecords.map(item => (
                <tr key={item.id}>
                  <td>{item.srNo}</td>
                  {activeTab !== 'mine' && <td className="cert-name-cell">{item.name}</td>}
                  {activeTab !== 'mine' && <td>{item.employeeCode}</td>}
                  <td>{item.du}</td>
                  <td>
                    <span className="cert-category-badge">{item.category}</span>
                  </td>
                  <td style={{ fontWeight: 500, maxWidth: '280px' }}>
                    {item.certificationName}
                  </td>
                  <td>{item.certificationDate}</td>
                  <td>{item.doesNotExpire}</td>
                  <td>{item.expiryDate}</td>
                  <td>
                    <span className={`badge-active-${item.active.toLowerCase()}`}>
                      {item.active}
                    </span>
                  </td>
                  {activeTab !== 'mine' && (
                    <td style={{ fontSize: '0.8rem' }}>{item.emailId}</td>
                  )}
                  <td>
                    <span className={`status-pill status-${item.status.toLowerCase()}`}>
                      {item.status}
                    </span>
                  </td>
                  <td>
                    {isManager && item.status === 'SUBMITTED' ? (
                      <button
                        type="button"
                        className="secondary-button"
                        style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
                        onClick={() => setReviewingCert(item)}
                      >
                        Verify
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="secondary-button"
                        style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
                        onClick={() => {
                          setEditingCert(item);
                          setShowAddDialog(true);
                        }}
                      >
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {/* Add / Edit Certification Dialog with AI Autofill */}
      {showAddDialog && (
        <CertificationDialog
          initial={editingCert}
          currentUser={{
            name: person?.displayName || 'Anupriya Banerjee',
            employeeCode: person?.employeeCode || '704427',
          }}
          onClose={() => {
            setShowAddDialog(false);
            setEditingCert(null);
          }}
          onSave={handleSaveCertification}
        />
      )}

      {/* Verification Review Dialog (Skill Review Flow) */}
      {reviewingCert && (
        <CertificationReviewDialog
          certification={reviewingCert}
          reviewerName={person?.displayName || 'Capability Lead'}
          onClose={() => setReviewingCert(null)}
          onDecision={handleReviewDecision}
        />
      )}
    </div>
  );
}
