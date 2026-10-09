import { useState } from 'react';
import {
  Award,
  Layers,
  ShieldCheck,
  Clock3,
  FilePenLine,
  Search,
  Eye,
  Pencil,
  Send,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
} from 'lucide-react';
import type { CertificationRecord } from './types';
import { certificationStatusLabels, credentialValidity } from './certification-model';
export function CertificationProfileView({
  records,
  loading = false,
  today,
  canManage,
  onAdd,
  onView,
  onEdit,
  canRenew = false,
  onRenew = () => {},
  onSubmit,
  onReview,
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
  onReview: (record: CertificationRecord) => void;
}) {
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
    { label: 'Manager reviewed', count: approved, color: 'var(--skill-reviewed)' },
    { label: 'Pending review', count: pending, color: 'var(--skill-pending)' },
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
  const expired = records.filter(r => credentialValidity(r.expiryDate, today) === 'Expired').length;
  const soon = records.filter(
    r => credentialValidity(r.expiryDate, today) === 'Expires soon',
  ).length;
  return (
    <section
      className="skills-profile certification-profile"
      aria-label="My certification profile"
      aria-busy={loading}
    >
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
            label: 'Manager reviewed',
            count: approved,
            Icon: ShieldCheck,
            tone: 'reviewed',
            filter: 'APPROVED',
          },
          {
            label: 'Pending review',
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
            <label className="skills-query">
              <Search size={17} />
              <input
                type="search"
                aria-label="Search your certifications"
                placeholder="Search your certifications…"
                maxLength={100}
                value={query}
                onChange={e => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
              />
            </label>
            <div className="skills-list-tabs" role="group" aria-label="Certification views">
              {[
                { id: 'all', label: 'All certifications' },
                { id: 'attention', label: 'To complete', count: drafts + attention },
                { id: 'reviewed', label: 'Reviewed', count: approved },
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
              aria-label="Filter certification review status"
              value={status}
              onChange={e => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All review statuses</option>
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
                className="skills-table-scroll"
                tabIndex={0}
                aria-label="Certification table; scroll horizontally on smaller screens"
              >
                <table className="skills-profile-table">
                  <thead>
                    <tr>
                      {[
                        'Certification',
                        'Category',
                        'Issuer',
                        'Review status',
                        'Validity',
                        'Issued',
                        'Actions',
                      ].map(label => (
                        <th key={label} scope="col">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(record => (
                      <tr key={record.id}>
                        <td>
                          <button
                            className="skills-name-button"
                            disabled={loading}
                            onClick={() => onView(record)}
                          >
                            <span className="skills-row-icon">
                              <Award size={18} />
                            </span>
                            <span>
                              <strong>{record.certificationName}</strong>
                              <small>View credential & feedback</small>
                            </span>
                          </button>
                        </td>
                        <td>
                          <span className="skills-category-pill">{record.category}</span>
                        </td>
                        <td>{record.provider}</td>
                        <td>
                          <span className={'skills-status ' + record.status.toLowerCase()}>
                            {certificationStatusLabels[record.status]}
                          </span>
                          {record.status === 'APPROVED' &&
                            credentialValidity(record.expiryDate, today) === 'Expired' && (
                              <span className="cert-review-validity cert-expired">Expired</span>
                            )}
                        </td>
                        <td>
                          <span
                            className={
                              credentialValidity(record.expiryDate, today) === 'Expired'
                                ? 'cert-expired'
                                : ''
                            }
                          >
                            {credentialValidity(record.expiryDate, today)}
                          </span>
                          {record.expiryDate && (
                            <small className="cert-expiry-date">{record.expiryDate}</small>
                          )}
                        </td>
                        <td className="skills-date">{record.certificationDate}</td>
                        <td>
                          <div className="skills-row-actions">
                            <button
                              aria-label={`View ${record.certificationName} credential`}
                              title="View credential"
                              disabled={loading}
                              onClick={() => onView(record)}
                            >
                              <Eye size={16} />
                            </button>
                            {record.canEdit && (
                              <button
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
                              record.expiryDate &&
                              (Date.parse(record.expiryDate + 'T12:00:00Z') -
                                Date.parse(today + 'T12:00:00Z')) /
                                86400000 <=
                                90 && (
                                <button
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
                                aria-label={`${record.status === 'SUBMITTED' ? 'Reroute' : 'Submit'} ${record.certificationName} for review`}
                                title={
                                  record.status === 'SUBMITTED'
                                    ? 'Reroute review'
                                    : 'Submit for review'
                                }
                                disabled={loading}
                                onClick={() => onSubmit(record)}
                              >
                                <Send size={15} />
                              </button>
                            )}
                            {record.canReview && (
                              <button
                                aria-label={`Review ${record.certificationName}`}
                                title="Review credential"
                                disabled={loading}
                                onClick={() => onReview(record)}
                              >
                                <ShieldCheck size={15} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="skills-pagination">
                <span>
                  Showing {(current - 1) * size + 1}–{Math.min(current * size, matching.length)} of{' '}
                  {matching.length} certifications
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
                    Per page
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
                    Add certification
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
            <p>Validity is separate from manager review.</p>
            <div className="skills-category-chart">
              {[
                { label: 'Expired', count: expired },
                { label: 'Expires soon', count: soon },
              ].map(item => (
                <button
                  key={item.label}
                  onClick={() => {
                    reset();
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
                ? 'Review your manager’s feedback and update returned records before resubmitting.'
                : drafts
                  ? 'Check your draft details, then submit to your current manager.'
                  : pending
                    ? 'Your submissions are awaiting manager review.'
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
