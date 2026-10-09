import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router';
import { Award, FileSpreadsheet, Plus, RefreshCw } from 'lucide-react';
import type { WorkspaceState } from '../Workspace';
import { toast } from '../toast';
import { CertificationDialog } from './CertificationDialog';
import { CertificationReviewDialog } from './CertificationReviewDialog';
import { fetchCertifications, saveCertification } from './certification-api';
import { downloadCertificationsCsv } from './certification-reports';
import {
  statusLabel,
  type CertificationChange,
  type CertificationPage,
  type CertificationRecord,
  type CertificationView,
} from './types';
import './certifications.css';

export function Certifications({
  workspace,
  actionsContainer,
}: {
  workspace?: WorkspaceState;
  actionsContainer?: HTMLDivElement | null;
}) {
  const [params, setParams] = useSearchParams();
  const caps = workspace?.capabilities;
  const allowed: CertificationView[] = [
    ...(caps?.ownCertifications ? ['mine' as const] : []),
    ...(caps?.reviewCertifications ? ['queue' as const] : []),
    ...(caps?.certificationDirectory ? ['directory' as const] : []),
  ];
  const rawTab = params.get('tab');
  const view = allowed.includes(rawTab as CertificationView)
    ? (rawTab as CertificationView)
    : allowed[0];
  const search = params.get('search') ?? '',
    category = params.get('category') ?? '';
  const du = params.get('du') ?? '';
  const rawActive = params.get('active') ?? 'ALL',
    active = ['ALL', 'Y', 'N'].includes(rawActive) ? rawActive : 'ALL';
  const rawPage = Number(params.get('page') ?? 1),
    page = Number.isSafeInteger(rawPage) && rawPage >= 1 && rawPage <= 10000 ? rawPage : 1;
  const [feed, setFeed] = useState<CertificationPage>(),
    [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0),
    [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<CertificationRecord | 'new'>(),
    [detail, setDetail] = useState<CertificationRecord>();
  const [exporting, setExporting] = useState(false),
    [routing, setRouting] = useState(false);
  const exportController = useRef<AbortController | null>(null);
  const mutationPending = useRef(false);
  const query = new URLSearchParams({
    view: view ?? 'mine',
    page: String(page),
    search,
    category,
    du,
    active,
  });
  const queryKey = query.toString();
  const capabilityKey =
    allowed.join(',') +
    ':' +
    Boolean(caps?.manageCertifications) +
    ':' +
    Boolean(caps?.exportCertifications);
  function change(values: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!('page' in values)) next.delete('page');
    setParams(next, { replace: true });
  }
  useEffect(() => {
    if (view && rawTab !== view) {
      const next = new URLSearchParams(params);
      next.set('tab', view);
      next.delete('page');
      setParams(next, { replace: true });
    }
  }, [view, rawTab, params, setParams]);
  useEffect(() => {
    const controller = new AbortController();
    exportController.current?.abort();
    setFeed(undefined);
    setDetail(undefined);
    setEditing(undefined);
    setError('');
    setLoading(true);
    if (!view) {
      setLoading(false);
      return;
    }
    fetchCertifications(new URLSearchParams(queryKey), controller.signal)
      .then(value => {
        if (controller.signal.aborted) return;
        const lastPage = Math.max(1, Math.ceil(value.total / value.pageSize));
        if (page > lastPage) {
          setParams(
            previous => {
              const next = new URLSearchParams(previous);
              if (lastPage === 1) next.delete('page');
              else next.set('page', String(lastPage));
              return next;
            },
            { replace: true },
          );
          return;
        }
        setFeed(value);
      })
      .catch(reason => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error ? reason.message : 'Certifications could not be loaded.',
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      exportController.current?.abort();
    };
  }, [queryKey, attempt, view, workspace?.person.id, capabilityKey]);
  async function save(input: CertificationChange) {
    await saveCertification(input);
    toast.success(
      input.action === 'SAVE'
        ? 'Certification draft saved.'
        : input.action === 'SUBMIT'
          ? 'Certification submitted to your assigned current manager.'
          : input.action === 'REROUTE'
            ? 'Unchanged submission routed to your current manager.'
            : 'Review decision saved.',
    );
    setAttempt(value => value + 1);
    window.dispatchEvent(new Event('workspace-mutation'));
  }
  async function reroute(record: CertificationRecord) {
    if (mutationPending.current) return;
    mutationPending.current = true;
    setRouting(true);
    setError('');
    try {
      await save({ id: record.id, revision: record.revision, action: 'REROUTE' });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Routing could not be updated.');
    } finally {
      mutationPending.current = false;
      setRouting(false);
    }
  }
  async function exportReport() {
    if (
      !caps?.exportCertifications ||
      view !== 'directory' ||
      exporting ||
      (exportController.current && !exportController.current.signal.aborted)
    )
      return;
    const controller = new AbortController();
    exportController.current = controller;
    setExporting(true);
    setError('');
    try {
      const report = await fetchCertifications(
        new URLSearchParams(queryKey),
        controller.signal,
        true,
      );
      if (controller.signal.aborted) return;
      downloadCertificationsCsv(report.items);
      toast.success('Filtered certification report downloaded.');
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : 'The report could not be downloaded.');
    } finally {
      if (exportController.current === controller) {
        exportController.current = null;
        setExporting(false);
      }
    }
  }
  const actions = (
    <div className="cert-header-actions">
      <button
        type="button"
        className="secondary-button"
        disabled={loading || routing}
        onClick={() => setAttempt(value => value + 1)}
      >
        <RefreshCw size={16} />
        Refresh
      </button>
      {view === 'directory' && caps?.exportCertifications && (
        <button
          type="button"
          className="secondary-button"
          disabled={loading || exporting || !feed}
          onClick={() => void exportReport()}
        >
          <FileSpreadsheet size={16} />
          {exporting ? 'Preparing report...' : 'Export filtered report'}
        </button>
      )}
      {caps?.manageCertifications && view === 'mine' && (
        <button
          type="button"
          className="primary-button"
          disabled={loading}
          onClick={() => setEditing('new')}
        >
          <Plus size={16} />
          Add certification
        </button>
      )}
    </div>
  );
  if (!view)
    return (
      <section className="profile-panel">
        <h2>Certification access is not assigned</h2>
        <p>Your administrator must assign an implemented certification action.</p>
      </section>
    );
  return (
    <section className="certifications-container" aria-label="Certifications and credentials">
      <header className="certifications-header">
        <div>
          <h1>
            <Award size={25} /> Certifications &amp; credentials
          </h1>
          <p>
            Evidence-backed credentials. Approval and current validity are separate from skill
            proficiency.
          </p>
        </div>
        {!actionsContainer && actions}
      </header>
      {actionsContainer && createPortal(actions, actionsContainer)}
      <nav className="cert-nav-tabs" aria-label="Certification views">
        {allowed.map(tab => (
          <button
            type="button"
            className="secondary-button"
            key={tab}
            aria-pressed={view === tab}
            onClick={() => change({ tab, search: '', category: '', du: '', active: '' })}
          >
            {tab === 'mine'
              ? 'My certifications'
              : tab === 'queue'
                ? 'Assigned verification queue'
                : 'Organization directory'}
          </button>
        ))}
      </nav>
      <p className="field-hint">
        {view === 'mine'
          ? 'Drafts are private. Submitted and approved records are locked.'
          : view === 'queue'
            ? 'Only submissions assigned to you from your current active direct reports appear here.'
            : 'Private drafts are excluded. Reports use the current filters, include review status, and are limited to 5,000 rows.'}
      </p>
      {view === 'mine' && (
        <p className="field-hint">
          Earlier browser-only demo records are not migrated or treated as verified credentials.
          Enter genuine issuer evidence to create a server record.
        </p>
      )}
      <div className="cert-filter-bar">
        <div className="cert-filter-field">
          <label htmlFor="cert-search">Search</label>
          <input
            id="cert-search"
            type="search"
            maxLength={100}
            value={search}
            placeholder="Name, code, certification or issuer"
            onChange={e => change({ search: e.target.value })}
          />
        </div>
        <div className="cert-filter-field">
          <label htmlFor="cert-category-filter">Category (exact match)</label>
          <input
            id="cert-category-filter"
            value={category}
            maxLength={100}
            onChange={e => change({ category: e.target.value })}
          />
        </div>
        {view !== 'mine' && (
          <div className="cert-filter-field">
            <label htmlFor="cert-du-filter">Delivery unit (exact match)</label>
            <input
              id="cert-du-filter"
              value={du}
              maxLength={100}
              onChange={e => change({ du: e.target.value })}
            />
          </div>
        )}
        <div className="cert-filter-field">
          <label htmlFor="cert-active-filter">Current compliance</label>
          <select
            id="cert-active-filter"
            value={active}
            onChange={e => change({ active: e.target.value })}
          >
            <option value="ALL">All records</option>
            <option value="Y">Approved and currently valid</option>
            <option value="N">Not currently compliant</option>
          </select>
        </div>
      </div>
      {error && (
        <p role="alert">
          {error}{' '}
          <button
            type="button"
            className="secondary-button"
            onClick={() => setAttempt(value => value + 1)}
          >
            Retry
          </button>
        </p>
      )}
      {loading ? (
        <p role="status">Loading current certifications...</p>
      ) : (
        feed && (
          <>
            <dl className="cert-summary" aria-label="Filtered certification totals">
              <div>
                <dt>Records</dt>
                <dd>{feed.total}</dd>
              </div>
              <div>
                <dt>Approved and currently valid</dt>
                <dd>{feed.activeCount}</dd>
              </div>
              <div>
                <dt>Compliant credentials expiring within 90 days</dt>
                <dd>{feed.expiringSoonCount}</dd>
              </div>
            </dl>
            <div
              className="cert-table-container"
              tabIndex={0}
              role="region"
              aria-label="Certification records, horizontally scrollable"
            >
              <table className="cert-data-table">
                <caption>
                  Current{' '}
                  {view === 'mine'
                    ? 'personal portfolio'
                    : view === 'queue'
                      ? 'assigned submissions'
                      : 'organization records'}
                </caption>
                <thead>
                  <tr>
                    {view !== 'mine' && (
                      <>
                        <th scope="col">Employee</th>
                        <th scope="col">Code</th>
                      </>
                    )}
                    <th scope="col">Delivery unit</th>
                    <th scope="col">Certification</th>
                    <th scope="col">Issuer / category</th>
                    <th scope="col">Issued</th>
                    <th scope="col">Expires</th>
                    <th scope="col">Review status</th>
                    <th scope="col">Current compliance</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {feed.items.length ? (
                    feed.items.map(record => (
                      <tr key={record.id}>
                        {view !== 'mine' && (
                          <>
                            <td>{record.name}</td>
                            <td>{record.employeeCode}</td>
                          </>
                        )}
                        <td>{record.du}</td>
                        <td>{record.certificationName}</td>
                        <td>
                          {record.provider}
                          <br />
                          {record.category}
                        </td>
                        <td>{record.certificationDate}</td>
                        <td>{record.expiryDate ?? 'Does not expire'}</td>
                        <td>
                          <span
                            className={`cert-status cert-status-${record.status.toLowerCase()}`}
                          >
                            {statusLabel[record.status]}
                          </span>
                          {record.feedbackNote && (
                            <p className="cert-row-feedback">{record.feedbackNote}</p>
                          )}
                          {record.routingMismatch && (
                            <p className="cert-row-feedback">Reviewer routing changed</p>
                          )}
                        </td>
                        <td>{record.active === 'Y' ? 'Yes' : 'No'}</td>
                        <td>
                          <div className="cert-row-actions">
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => setDetail(record)}
                              aria-label={`${record.canReview ? 'Review' : 'View'} ${record.certificationName}`}
                            >
                              {record.canReview ? 'Review' : 'Details'}
                            </button>
                            {record.canEdit && caps?.manageCertifications && (
                              <button
                                type="button"
                                className="secondary-button"
                                onClick={() => setEditing(record)}
                                aria-label={`Edit ${record.certificationName}`}
                              >
                                Edit draft
                              </button>
                            )}
                            {record.routingMismatch &&
                              view === 'mine' &&
                              caps?.manageCertifications && (
                                <button
                                  type="button"
                                  className="secondary-button"
                                  disabled={routing}
                                  onClick={() => void reroute(record)}
                                >
                                  Route unchanged submission to current manager
                                </button>
                              )}
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={view === 'mine' ? 8 : 10}>
                        {search || category || du || active !== 'ALL'
                          ? 'No records match these filters.'
                          : view === 'queue'
                            ? 'No currently eligible assigned submissions.'
                            : 'No certifications recorded.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <nav className="cert-pagination" aria-label="Certification pages">
              <button
                type="button"
                className="secondary-button"
                disabled={page <= 1}
                onClick={() => change({ page: String(page - 1) })}
              >
                Previous
              </button>
              <span>
                Page {page} of {Math.max(1, Math.ceil(feed.total / feed.pageSize))}
              </span>
              <button
                type="button"
                className="secondary-button"
                disabled={page * feed.pageSize >= feed.total}
                onClick={() => change({ page: String(page + 1) })}
              >
                Next
              </button>
            </nav>
          </>
        )
      )}
      {editing && workspace && (
        <CertificationDialog
          initial={editing === 'new' ? undefined : editing}
          currentUser={workspace.person}
          onClose={() => setEditing(undefined)}
          onSave={save}
        />
      )}
      {detail && (
        <CertificationReviewDialog
          certification={detail}
          onClose={() => setDetail(undefined)}
          onDecision={save}
        />
      )}
    </section>
  );
}
