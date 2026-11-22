import { useState } from 'react';
import {
  Award,
  AlertCircle,
  Layers,
  ShieldCheck,
  Clock3,
  FilePenLine,
  Eye,
  Pencil,
  Send,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
} from 'lucide-react';
import { PortfolioSearch } from '../PortfolioSearch';
import type { CertificationRecord } from './types';
import { certificationStatusLabels, credentialValidity } from './certification-model';
export function CertificationProfileView({
  records: allRecords,
  loading = false,
  today,
  canManage,
  onAdd,
  onView,
  onEdit,
  canRenew = false,
  onRenew = () => {},
  onSubmit,
}: {
  records: CertificationRecord[];
  loading?: boolean;
  today: string;
  canManage: boolean;
  onAdd: () => void;
  onView: (record: CertificationRecord) => void;
  onEdit: (record: CertificationRecord) => void;
  canRenew?: boolean;
  onRenew?: (record: CertificationRecord) => void;
  onSubmit: (record: CertificationRecord) => void;
}) {
  const records = allRecords.filter(r => !r.supersededById);
  const [query, setQuery] = useState(''),
    [category, setCategory] = useState(''),
    [status, setStatus] = useState(''),
    [validity, setValidity] = useState('');
  const [tab, setTab] = useState('all'),
    [page, setPage] = useState(1),
    [size, setSize] = useState(10);
  const approved = records.filter(r => r.status === 'APPROVED').length;
  const pending = records.filter(r => r.status === 'SUBMITTED').length;
  const drafts = records.filter(r => r.status === 'DRAFT').length;
  const attention = records.length - approved - pending - drafts;
  const categories = [...new Set(records.map(r => r.category))].sort();
  const matching = records.filter(
    r =>
      (!query.trim() ||
        `${r.certificationName} ${r.provider} ${r.credentialId}`
          .toLowerCase()
          .includes(query.trim().toLowerCase())) &&
      (!category || r.category === category) &&
      (!status || r.status === status) &&
      (!validity || credentialValidity(r.expiryDate, today) === validity) &&
      (tab === 'all' ||
        (tab === 'reviewed'
          ? r.status === 'APPROVED'
          : ['DRAFT', 'CHANGES_REQUESTED', 'REJECTED'].includes(r.status))),
  );
  const current = Math.min(page, Math.max(1, Math.ceil(matching.length / size)));
  const rows = matching.slice((current - 1) * size, current * size);
  const reset = () => {
    setQuery('');
    setCategory('');
    setStatus('');
    setValidity('');
    setTab('all');
    setPage(1);
  };
  const filterStatus = (value: string) => {
    reset();
    setStatus(value);
  };
  const distribution = [
    { label: 'Approved', count: approved, color: 'var(--skill-reviewed)' },
    { label: 'Pending approval', count: pending, color: 'var(--skill-pending)' },
    { label: 'Drafts', count: drafts, color: 'var(--skill-draft)' },
    { label: 'Needs attention', count: attention, color: 'var(--skill-attention)' },
  ];
  let stop = 0;
  const gradient = distribution
    .map(item => {
      const start = stop;
      stop += records.length ? (item.count / records.length) * 100 : 0;
      return `${item.color} ${start}% ${stop}%`;
    })
    .join(',');
  const renewable = records.filter(r => r.status === 'APPROVED');
  const expired = renewable.filter(
    r => credentialValidity(r.expiryDate, today) === 'Expired',
  ).length;
  const soon = renewable.filter(
    r => credentialValidity(r.expiryDate, today) === 'Expires soon',
  ).length;
  return (
    <section className="skills-profile" aria-label="My certification profile" aria-busy={loading}>
      <div className="skills-metrics">
        {[
          {
            label: 'Total certifications',
            count: records.length,
            Icon: Layers,
            tone: 'total',
            filter: '',
          },
          {
            label: 'Approved',
            count: approved,
            Icon: ShieldCheck,
            tone: 'reviewed',
            filter: 'APPROVED',
          },
          {
            label: 'Pending approval',
            count: pending,
            Icon: Clock3,
            tone: 'pending',
            filter: 'SUBMITTED',
          },
          { label: 'Drafts', count: drafts, Icon: FilePenLine, tone: 'draft', filter: 'DRAFT' },
        ].map(({ label, count, Icon, tone, filter }) => (
          <button
            key={tone}
            className={'skills-metric ' + tone}
            aria-label={`${label}: ${count}. Filter certifications`}
            aria-pressed={tab === 'all' && status === filter}
            onClick={() => filterStatus(filter)}
          >
            <div>
              <strong>{count}</strong>
              <span>{label}</span>
            </div>
            <span className="skills-metric-icon">
              <Icon size={22} />
            </span>
          </button>
        ))}
      </div>
      {!canManage && (
        <p className="skills-readonly">
          You can view your certifications. Adding and editing are not currently assigned.
        </p>
      )}
      <div className="skills-content-grid">
        <section className="skills-list-card" aria-label="Your certifications">
          <div className="skills-card-header">
            <PortfolioSearch
              label="Search your certifications"
              query={query}
              onChange={value => {
                setQuery(value);
                setPage(1);
              }}
            />
            <div className="skills-list-tabs" role="group" aria-label="Certification views">
              {[
                { id: 'all', label: 'All certifications' },
                { id: 'attention', label: 'Action needed', count: drafts + attention },
                { id: 'reviewed', label: 'Approved', count: approved },
              ].map(item => (
                <button
                  key={item.id}
                  aria-pressed={tab === item.id}
                  onClick={() => {
                    setTab(item.id);
                    setStatus('');
                    setPage(1);
                  }}
                >
                  {item.label}
                  {item.count !== undefined && <span>{item.count}</span>}
                </button>
              ))}
            </div>
          </div>
          <div className="skills-filters">
            <select
              aria-label="Filter certification category"
              value={category}
              onChange={e => {
                setCategory(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All categories</option>
              {categories.map(c => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <select
              aria-label="Filter certification approval status"
              value={status}
              onChange={e => {
                setStatus(e.target.value);
                if (e.target.value) setTab('all');
                setPage(1);
              }}
            >
              <option value="">All approval statuses</option>
              {Object.entries(certificationStatusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter credential validity"
              value={validity}
              onChange={e => {
                setValidity(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All validity states</option>
              {['Current', 'Expires soon', 'Expired', 'No expiry'].map(v => (
                <option key={v}>{v}</option>
              ))}
            </select>
            <button
              className="skills-clear"
              aria-label="Clear certification filters"
              onClick={reset}
            >
              <RotateCcw size={14} /> Clear
            </button>
          </div>
          {rows.length ? (
            <>
              <div
                className="skills-items-container"
                role="list"
                aria-label="Your certificates list"
              >
                {rows.map(record => {
                  const validity = credentialValidity(record.expiryDate, today);
                  const StatusIcon =
                    record.status === 'APPROVED'
                      ? ShieldCheck
                      : record.status === 'SUBMITTED'
                        ? Clock3
                        : record.status === 'DRAFT'
                          ? FilePenLine
                          : AlertCircle;
                  return (
                    <article
                      key={record.id}
                      className="skills-item-card"
                      role="listitem"
                      aria-label={record.certificationName}
                    >
                      <div className="skills-item-main">
                        <div className="skills-item-left">
                          <div className="skills-item-icon" aria-hidden="true">
                            <Award size={18} />
                          </div>
                          <div className="skills-item-info">
                            <div className="skills-item-title-row">
                              <button
                                type="button"
                                className="skills-name-button"
                                disabled={loading}
                                onClick={() => onView(record)}
                              >
                                <strong>{record.certificationName}</strong>
                              </button>
                              <span className="skills-category-pill">{record.category}</span>
                              <span className={'skills-status ' + record.status.toLowerCase()}>
                                <StatusIcon size={13} aria-hidden="true" />
                                {certificationStatusLabels[record.status]}
                              </span>
                            </div>
                            <div className="skills-item-meta-row">
                              <span>{record.provider}</span>
                              <span className="skills-meta-sep" aria-hidden="true">
                                ·
                              </span>
                              <span className="skills-date">Issued {record.certificationDate}</span>
                            </div>
                          </div>
                        </div>
                        <div className="skills-item-right">
                          <div className="skills-item-proficiency">
                            <strong
                              className={
                                validity === 'Expired' ? 'cert-expired' : 'skills-level-label'
                              }
                            >
                              {validity}
                            </strong>
                            {record.expiryDate && (
                              <span className="skills-item-meta-row">{record.expiryDate}</span>
                            )}
                          </div>
                          <div className="skills-row-actions">
                            <button
                              type="button"
                              aria-label={`View ${record.certificationName} credential`}
                              title="View credential"
                              disabled={loading}
                              onClick={() => onView(record)}
                            >
                              <Eye size={16} />
                            </button>
                            {record.canEdit && (
                              <button
                                type="button"
                                aria-label={`Edit ${record.certificationName} draft`}
                                title="Edit details"
                                disabled={loading}
                                onClick={() => onEdit(record)}
                              >
                                <Pencil size={15} />
                              </button>
                            )}
                            {canRenew &&
                              record.status === 'APPROVED' &&
                              (validity === 'Expired' || validity === 'Expires soon') && (
                                <button
                                  type="button"
                                  aria-label={`Record renewal for ${record.certificationName}`}
                                  title="Record renewal"
                                  disabled={loading}
                                  onClick={() => onRenew(record)}
                                >
                                  <RotateCcw size={15} />
                                </button>
                              )}
                            {record.canSubmit && (
                              <button
                                type="button"
                                aria-label={`${record.status === 'SUBMITTED' ? 'Reroute' : 'Submit'} ${record.certificationName} for approval`}
                                title={
                                  record.status === 'SUBMITTED'
                                    ? 'Reroute approval request'
                                    : 'Submit for approval'
                                }
                                disabled={loading}
                                onClick={() => onSubmit(record)}
                              >
                                <Send size={15} />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
              <div className="skills-pagination">
                <span>
                  Showing {(current - 1) * size + 1}–{Math.min(current * size, matching.length)} of{' '}
                  {matching.length} {matching.length === 1 ? 'certification' : 'certifications'}
                </span>
                <div>
                  <button
                    aria-label="Previous certifications page"
                    disabled={current === 1}
                    onClick={() => setPage(current - 1)}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="skills-current-page">{current}</span>
                  <button
                    aria-label="Next certifications page"
                    disabled={current * size >= matching.length}
                    onClick={() => setPage(current + 1)}
                  >
                    <ChevronRight size={16} />
                  </button>
                  <label>
                    Rows
                    <select
                      aria-label="Certifications per page"
                      value={size}
                      onChange={e => {
                        setSize(Number(e.target.value));
                        setPage(1);
                      }}
                    >
                      {[10, 25, 50].map(n => (
                        <option key={n}>{n}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            </>
          ) : (
            <div className="skills-empty">
              <span>
                <Award size={28} />
              </span>
              <h3>
                {records.length ? 'No matching certifications' : 'Start your credential portfolio'}
              </h3>
              <p>
                {records.length
                  ? 'Try another search or clear your filters.'
                  : 'Add the details on your certificate, then submit when you are ready.'}
              </p>
              {records.length ? (
                <button className="secondary-button" onClick={reset}>
                  Clear filters
                </button>
              ) : (
                canManage && (
                  <button className="primary-button" disabled={loading} onClick={onAdd}>
                    Add certificate
                  </button>
                )
              )}
            </div>
          )}
        </section>
        <aside className="skills-insights" aria-label="Certification profile overview">
          <section className="skills-insight-card">
            <h3>Profile overview</h3>
            <div className="skills-overview">
              <div
                className="skills-donut"
                role="img"
                aria-label={`${records.length} certifications: ${distribution.map(d => `${d.count} ${d.label}`).join(', ')}`}
                style={{
                  background: records.length ? `conic-gradient(${gradient})` : 'var(--line)',
                }}
              >
                <div>
                  <strong>{records.length}</strong>
                  <span>Certifications</span>
                </div>
              </div>
              <ul>
                {distribution.map(item => (
                  <li key={item.label}>
                    <span className="skills-legend-dot" style={{ background: item.color }} />
                    <span>{item.label}</span>
                    <strong>{item.count}</strong>
                  </li>
                ))}
              </ul>
            </div>
          </section>
          <section className="skills-insight-card">
            <h3>Renewal attention</h3>
            <p>Validity is separate from the approval decision.</p>
            <div className="skills-category-chart">
              {[
                { label: 'Expired', count: expired },
                { label: 'Expires soon', count: soon },
              ].map(item => (
                <button
                  key={item.label}
                  onClick={() => {
                    reset();
                    setStatus('APPROVED');
                    setValidity(item.label);
                  }}
                >
                  <span>{item.label}</span>
                  <strong>{item.count}</strong>
                </button>
              ))}
            </div>
            <p className="skills-insight-empty">
              Expires soon means within 90 days. Add a new credential for a renewal; reviewed
              records stay locked.
            </p>
          </section>
          <section className="skills-insight-card skills-next-card">
            <h3>Your next step</h3>
            <p>
              {attention
                ? 'Check your manager’s feedback and update returned records before resubmitting.'
                : drafts
                  ? 'Check your draft details, then submit to your current manager.'
                  : pending
                    ? 'Your submissions are pending approval.'
                    : expired || soon
                      ? 'Check renewal dates with your issuer and add the renewed credential when available.'
                      : 'Keep credential details and renewal dates up to date.'}
            </p>
            <p>
              Manager review does not validate the issuer automatically or change skill proficiency.
            </p>
          </section>
        </aside>
      </div>
    </section>
  );
}
