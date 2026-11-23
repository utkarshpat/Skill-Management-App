import { displayProficiencyName } from './proficiency';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  ArrowUpRight,
  Award,
  BookOpen,
  Brain,
  Briefcase,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Cloud,
  Code2,
  Database,
  Eye,
  FilePenLine,
  Layers,
  Monitor,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  ShieldCheck,
  Target,
  UserRound,
} from 'lucide-react';
import { PortfolioSearch } from './PortfolioSearch';
import {
  SupportingCertificates,
  indexCertificatesBySkill,
} from './capabilities/SupportingCertificates';
import {
  certificationStatusLabels,
  credentialValidity,
} from './certifications/certification-model';
import type { CertificationRecord } from './certifications/types';
import type { Claim } from './MySkills';

const skillStatuses: Record<Claim['status'], string> = {
  DRAFT: 'Self-assessed',
  SUBMITTED: 'Pending approval',
  CHANGES_REQUESTED: 'Changes requested',
  APPROVED: 'Approved',
  REJECTED: 'Not approved',
};

type PortfolioType = 'all' | 'skill' | 'cert';
type StatusChip = '' | 'action' | 'attention' | 'approved';

type PortfolioItem =
  | { kind: 'skill'; sortKey: string; claim: Claim }
  | { kind: 'cert'; sortKey: string; record: CertificationRecord };

function SkillIcon({ category }: { category: string }) {
  const Icon = category.includes('Programming')
    ? Code2
    : category.includes('Database')
      ? Database
      : category.includes('Cloud')
        ? Cloud
        : category.includes('AI')
          ? Brain
          : category.includes('Project')
            ? Briefcase
            : category.includes('Frontend')
              ? Monitor
              : BookOpen;
  return <Icon size={19} aria-hidden="true" />;
}

export function UnifiedPortfolioView({
  claims,
  certificates = [],
  certificatesToday,
  canClaim,
  canManageCertificates = false,
  canRenewCertificates = false,
  loading,
  initialStatus = '',
  initialType = 'all',
  extraInsights,
  onView,
  onEdit,
  onSubmit,
  onAdd,
  onAddCertificate,
  onCertificate,
  onEditCertificate,
  onRenewCertificate,
}: {
  claims: Claim[];
  certificates?: CertificationRecord[];
  certificatesToday?: string;
  canClaim: boolean;
  canManageCertificates?: boolean;
  canRenewCertificates?: boolean;
  loading: boolean;
  initialStatus?: string;
  initialType?: PortfolioType;
  extraInsights?: ReactNode;
  onView: (claim: Claim) => void;
  onEdit: (claim: Claim) => void;
  onSubmit: (claim: Claim) => void;
  onAdd?: () => void;
  onAddCertificate?: () => void;
  onCertificate?: (id: string) => void;
  onEditCertificate?: (record: CertificationRecord) => void;
  onRenewCertificate?: (record: CertificationRecord) => void;
}) {
  const today = certificatesToday ?? new Date().toISOString().slice(0, 10);
  const [typeFilter, setTypeFilter] = useState<PortfolioType>(initialType);
  const [statusChip, setStatusChip] = useState<StatusChip>('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [rank, setRank] = useState('');
  const [validity, setValidity] = useState('');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);

  useEffect(() => {
    setTypeFilter(initialType);
    setPage(1);
  }, [initialType]);

  useEffect(() => {
    setStatus(Object.hasOwn(skillStatuses, initialStatus) ? initialStatus : '');
    setStatusChip('');
    setPage(1);
  }, [initialStatus]);

  const activeCertificates = useMemo(
    () => certificates.filter(record => !record.supersededById),
    [certificates],
  );
  const certificateIndex = useMemo(() => indexCertificatesBySkill(certificates), [certificates]);

  const isSkillAttention = (claim: Claim) =>
    claim.status === 'DRAFT' || claim.status === 'CHANGES_REQUESTED' || claim.status === 'REJECTED';
  const isCertAttention = (record: CertificationRecord) => {
    if (record.status === 'SUBMITTED') return false;
    if (
      record.status === 'DRAFT' ||
      record.status === 'CHANGES_REQUESTED' ||
      record.status === 'REJECTED'
    )
      return true;
    const v = credentialValidity(record.expiryDate, today);
    return v === 'Expired' || v === 'Expires soon';
  };
  const isSkillAction = (claim: Claim) => claim.status === 'SUBMITTED' || isSkillAttention(claim);
  const isCertAction = (record: CertificationRecord) =>
    record.status === 'SUBMITTED' || isCertAttention(record);

  const scopedSkills = typeFilter === 'cert' ? [] : claims;
  const scopedCerts = typeFilter === 'skill' ? [] : activeCertificates;

  const pendingCount =
    scopedSkills.filter(c => c.status === 'SUBMITTED').length +
    scopedCerts.filter(r => r.status === 'SUBMITTED').length;
  const attentionCount =
    scopedSkills.filter(isSkillAttention).length + scopedCerts.filter(isCertAttention).length;
  const actionCount =
    scopedSkills.filter(isSkillAction).length + scopedCerts.filter(isCertAction).length;
  const approvedCount =
    scopedSkills.filter(c => c.status === 'APPROVED').length +
    scopedCerts.filter(r => r.status === 'APPROVED').length;
  const scopedTotal = scopedSkills.length + scopedCerts.length;

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const claim of scopedSkills) set.add(claim.category);
    for (const record of scopedCerts) set.add(record.category);
    return [...set].sort();
  }, [scopedSkills, scopedCerts]);

  const levels = useMemo(
    () => [...new Set(claims.map(claim => claim.rank))].sort((a, b) => a - b),
    [claims],
  );

  const categoryCounts = useMemo(() => {
    const totals = new Map<string, number>();
    for (const claim of scopedSkills)
      totals.set(claim.category, (totals.get(claim.category) ?? 0) + 1);
    for (const record of scopedCerts)
      totals.set(record.category, (totals.get(record.category) ?? 0) + 1);
    return [...totals]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [scopedSkills, scopedCerts]);

  const filtered = useMemo<PortfolioItem[]>(() => {
    const needle = query.trim().toLocaleLowerCase();
    const rankNum = rank ? Number(rank) : undefined;
    const items: PortfolioItem[] = [];

    for (const claim of scopedSkills) {
      if (
        needle &&
        ![claim.skillName, claim.category, displayProficiencyName(claim.rank, claim.levelName)]
          .join(' ')
          .toLocaleLowerCase()
          .includes(needle)
      )
        continue;
      if (category && claim.category !== category) continue;
      if (status && claim.status !== status) continue;
      if (typeFilter === 'skill' && rankNum !== undefined && claim.rank !== rankNum) continue;
      if (statusChip === 'action' && !isSkillAction(claim)) continue;
      if (statusChip === 'attention' && !isSkillAttention(claim)) continue;
      if (statusChip === 'approved' && claim.status !== 'APPROVED') continue;
      items.push({ kind: 'skill', sortKey: claim.updatedAt ?? '', claim });
    }

    for (const record of scopedCerts) {
      if (
        needle &&
        `${record.certificationName} ${record.provider} ${record.category} ${record.credentialId}`
          .toLocaleLowerCase()
          .includes(needle)
      )
        continue;
      if (category && record.category !== category) continue;
      if (status && record.status !== status) continue;
      if (
        typeFilter === 'cert' &&
        validity &&
        credentialValidity(record.expiryDate, today) !== validity
      )
        continue;
      if (statusChip === 'action' && !isCertAction(record)) continue;
      if (statusChip === 'attention' && !isCertAttention(record)) continue;
      if (statusChip === 'approved' && record.status !== 'APPROVED') continue;
      items.push({ kind: 'cert', sortKey: record.certificationDate ?? '', record });
    }

    if (typeFilter === 'all') {
      items.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
    }
    return items;
  }, [
    scopedSkills,
    scopedCerts,
    query,
    category,
    status,
    rank,
    validity,
    statusChip,
    typeFilter,
    today,
  ]);

  const count = filtered.length;
  const totalPages = Math.max(1, Math.ceil(count / size));
  const current = Math.min(page, totalPages);
  const rows = filtered.slice((current - 1) * size, current * size);
  const totalAll = claims.length + activeCertificates.length;

  const clearSubFilters = () => {
    setQuery('');
    setCategory('');
    setRank('');
    setValidity('');
    setPage(1);
  };

  const reset = () => {
    clearSubFilters();
    setStatus('');
    setStatusChip('');
  };

  const selectType = (next: PortfolioType) => {
    setTypeFilter(next);
    setCategory('');
    setStatus('');
    setRank('');
    setValidity('');
    setPage(1);
  };

  const toggleChip = (next: 'action' | 'approved') => {
    setStatus('');
    setStatusChip(prev => (prev === next ? '' : next));
    setPage(1);
  };

  const distribution = [
    {
      label: 'Approved and current',
      count: scopedTotal - actionCount,
      color: 'var(--skill-reviewed)',
    },
    { label: 'Pending', count: pendingCount, color: 'var(--skill-pending)' },
    {
      label: 'Other items needing attention',
      count: actionCount - pendingCount,
      color: 'var(--skill-attention)',
    },
  ];
  const distSum = distribution.reduce((sum, item) => sum + item.count, 0);
  let stop = 0;
  const gradient = distribution
    .map(item => {
      const start = stop;
      stop += distSum ? (item.count / distSum) * 100 : 0;
      return `${item.color} ${start}% ${stop}%`;
    })
    .join(',');

  return (
    <section
      className="skills-profile"
      aria-label="My skills and certifications portfolio"
      aria-busy={loading}
    >
      <div className="skills-metrics">
        <button
          type="button"
          className="skills-metric total"
          aria-label={`Skills: ${claims.length}. Show skills`}
          aria-pressed={typeFilter === 'skill' && !status && !statusChip}
          onClick={() => {
            reset();
            setTypeFilter(prev => (prev === 'skill' && !status && !statusChip ? 'all' : 'skill'));
          }}
        >
          <div>
            <strong>{claims.length}</strong>
            <span>Skills</span>
            <small className="skills-metric-sub">In your portfolio</small>
          </div>
          <span className="skills-metric-icon">
            <Layers size={22} aria-hidden="true" />
          </span>
        </button>

        <button
          type="button"
          className="skills-metric reviewed"
          aria-label={`Certifications: ${activeCertificates.length}. Show certifications`}
          aria-pressed={typeFilter === 'cert' && !status && !statusChip}
          onClick={() => {
            reset();
            setTypeFilter(prev => (prev === 'cert' && !status && !statusChip ? 'all' : 'cert'));
          }}
        >
          <div>
            <strong>{activeCertificates.length}</strong>
            <span>Certifications</span>
            <small className="skills-metric-sub">Held or in progress</small>
          </div>
          <span className="skills-metric-icon">
            <Award size={22} aria-hidden="true" />
          </span>
        </button>

        <button
          type="button"
          className="skills-metric pending"
          aria-label={`Pending: ${pendingCount}. Filter pending items`}
          aria-pressed={status === 'SUBMITTED' && !statusChip}
          onClick={() => {
            clearSubFilters();
            setStatusChip('');
            setStatus(prev => (prev === 'SUBMITTED' ? '' : 'SUBMITTED'));
          }}
        >
          <div>
            <strong>{pendingCount}</strong>
            <span>Pending</span>
            <small className="skills-metric-sub">Awaiting manager review</small>
          </div>
          <span className="skills-metric-icon">
            <Clock3 size={22} aria-hidden="true" />
          </span>
        </button>

        <button
          type="button"
          className="skills-metric attention"
          aria-label={`Needs attention: ${attentionCount}. Filter items needing attention`}
          aria-pressed={statusChip === 'attention'}
          onClick={() => {
            clearSubFilters();
            setStatus('');
            setStatusChip(prev => (prev === 'attention' ? '' : 'attention'));
          }}
        >
          <div>
            <strong>{attentionCount}</strong>
            <span>Needs attention</span>
            <small className="skills-metric-sub">Drafts, changes or expiring</small>
          </div>
          <span className="skills-metric-icon">
            <AlertCircle size={22} aria-hidden="true" />
          </span>
        </button>
      </div>

      {!canClaim && !canManageCertificates && (
        <p className="skills-readonly">
          <ShieldCheck size={16} aria-hidden="true" />
          You can view your portfolio. Your current permissions do not include adding or editing
          records.
        </p>
      )}

      <div className="skills-content-grid">
        <section className="skills-list-card" aria-label="Your skills and certifications">
          <div className="portfolio-toolbar-top">
            <div className="portfolio-type-tabs" role="group" aria-label="Portfolio type">
              {[
                { id: 'all' as const, label: 'All', count: totalAll },
                { id: 'skill' as const, label: 'Skills', count: claims.length },
                {
                  id: 'cert' as const,
                  label: 'Certifications',
                  count: activeCertificates.length,
                },
              ].map(item => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={typeFilter === item.id}
                  onClick={() => selectType(item.id)}
                >
                  {item.label}
                  <span>{item.count}</span>
                </button>
              ))}
            </div>

            <div className="portfolio-status-chips" role="group" aria-label="Status quick filters">
              <button
                type="button"
                className="portfolio-status-chip"
                aria-pressed={statusChip === 'action'}
                onClick={() => toggleChip('action')}
              >
                Needs action
                <span>{actionCount}</span>
              </button>
              <button
                type="button"
                className="portfolio-status-chip"
                aria-pressed={statusChip === 'approved'}
                onClick={() => toggleChip('approved')}
              >
                Approved
                <span>{approvedCount}</span>
              </button>
              {loading && (
                <span role="status" className="skills-refreshing">
                  Updating…
                </span>
              )}
            </div>
          </div>

          <div className="skills-filters portfolio-filters">
            <PortfolioSearch
              label="Search skills and certifications"
              query={query}
              onChange={value => {
                setQuery(value);
                setPage(1);
              }}
            />
            <select
              aria-label="Filter portfolio category"
              value={category}
              onChange={e => {
                setCategory(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All categories</option>
              {categories.map(name => (
                <option key={name}>{name}</option>
              ))}
            </select>
            {typeFilter === 'cert' ? (
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
            ) : typeFilter === 'skill' ? (
              <select
                aria-label="Filter proficiency level"
                value={rank}
                onChange={e => {
                  setRank(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All levels</option>
                {levels.map(value => (
                  <option key={value} value={value}>
                    {displayProficiencyName(value)}
                  </option>
                ))}
              </select>
            ) : (
              <select
                aria-label="Filter approval status"
                value={status}
                onChange={e => {
                  setStatus(e.target.value);
                  if (e.target.value) setStatusChip('');
                  setPage(1);
                }}
              >
                <option value="">All statuses</option>
                {Object.entries(skillStatuses).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              className="skills-clear"
              onClick={reset}
              aria-label="Clear portfolio filters"
            >
              <RotateCcw size={14} />
              Clear
            </button>
          </div>

          {rows.length ? (
            <>
              <div
                className="skills-items-container"
                role="list"
                aria-label="Your skills and certifications list"
              >
                {rows.map(item => {
                  if (item.kind === 'skill') {
                    const { claim } = item;
                    return (
                      <article
                        key={'skill-' + claim.id}
                        className="skills-item-card"
                        role="listitem"
                      >
                        <div className="skills-item-main">
                          <div className="skills-item-left">
                            <div className="skills-item-icon" aria-hidden="true">
                              <SkillIcon category={claim.category} />
                            </div>
                            <div className="skills-item-info">
                              <div className="skills-item-title-row">
                                <button
                                  type="button"
                                  className="skills-name-button"
                                  onClick={() => onView(claim)}
                                >
                                  <strong>{claim.skillName}</strong>
                                </button>
                                {typeFilter === 'all' && (
                                  <span className="portfolio-type-badge skill">Skill</span>
                                )}
                                <span className="skills-category-pill">{claim.category}</span>
                                <span className={'skills-status ' + claim.status.toLowerCase()}>
                                  {claim.status === 'APPROVED' ? (
                                    <ShieldCheck size={13} aria-hidden="true" />
                                  ) : claim.status === 'SUBMITTED' ? (
                                    <Clock3 size={13} aria-hidden="true" />
                                  ) : claim.status === 'DRAFT' ? (
                                    <UserRound size={13} aria-hidden="true" />
                                  ) : (
                                    <AlertCircle size={13} aria-hidden="true" />
                                  )}{' '}
                                  {skillStatuses[claim.status]}
                                </span>
                              </div>
                              <div className="skills-item-meta-row">
                                <span className="skills-experience">
                                  {claim.experienceMonths < 12
                                    ? `${claim.experienceMonths} ${claim.experienceMonths === 1 ? 'month' : 'months'}`
                                    : `${Number((claim.experienceMonths / 12).toFixed(1))} ${claim.experienceMonths === 12 ? 'year' : 'years'}`}{' '}
                                  experience
                                </span>
                                <span className="skills-meta-sep">·</span>
                                <span className="skills-date">
                                  Updated{' '}
                                  {new Date(claim.updatedAt).toLocaleDateString('en-GB', {
                                    day: '2-digit',
                                    month: 'short',
                                    year: 'numeric',
                                  })}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="skills-item-right">
                            <div className="skills-item-proficiency">
                              <div className="skills-level-header">
                                <strong className="skills-level-label">
                                  {displayProficiencyName(claim.rank, claim.levelName)}
                                </strong>
                              </div>
                              <span className="skills-rank-bars" aria-hidden="true">
                                {Array.from({ length: 4 }, (_, i) => (
                                  <i key={i} className={i < claim.rank ? 'filled' : 'empty'} />
                                ))}
                              </span>
                            </div>

                            <div className="skills-row-actions">
                              <button
                                type="button"
                                title="View claim"
                                aria-label={`View ${claim.skillName} claim`}
                                onClick={() => onView(claim)}
                              >
                                <Eye size={16} />
                              </button>
                              {canClaim &&
                                ['DRAFT', 'CHANGES_REQUESTED', 'REJECTED'].includes(
                                  claim.status,
                                ) && (
                                  <button
                                    type="button"
                                    title="Edit draft"
                                    aria-label={`Edit ${claim.skillName} draft`}
                                    disabled={loading}
                                    onClick={() => onEdit(claim)}
                                  >
                                    <Pencil size={15} />
                                  </button>
                                )}
                              {canClaim && claim.status !== 'APPROVED' && (
                                <button
                                  type="button"
                                  title={
                                    claim.status === 'SUBMITTED'
                                      ? 'Reroute approval request'
                                      : 'Submit for approval'
                                  }
                                  aria-label={`${claim.status === 'SUBMITTED' ? 'Reroute' : 'Submit'} ${claim.skillName} for approval`}
                                  disabled={loading}
                                  onClick={() => onSubmit(claim)}
                                >
                                  <Send size={15} />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>

                        {onCertificate && (
                          <SupportingCertificates
                            records={certificates}
                            index={certificateIndex}
                            skillId={claim.skillId}
                            disabled={loading}
                            onOpen={onCertificate}
                          />
                        )}
                      </article>
                    );
                  }

                  const { record } = item;
                  const recordValidity = credentialValidity(record.expiryDate, today);
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
                      key={'cert-' + record.id}
                      className="skills-item-card"
                      role="listitem"
                      aria-label={record.certificationName}
                    >
                      <div className="skills-item-main">
                        <div className="skills-item-left">
                          <div className="skills-item-icon cert" aria-hidden="true">
                            <Award size={18} />
                          </div>
                          <div className="skills-item-info">
                            <div className="skills-item-title-row">
                              <button
                                type="button"
                                className="skills-name-button"
                                disabled={loading}
                                onClick={() => onCertificate?.(record.id)}
                              >
                                <strong>{record.certificationName}</strong>
                              </button>
                              {typeFilter === 'all' && (
                                <span className="portfolio-type-badge cert">Certification</span>
                              )}
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
                                recordValidity === 'Expired' ? 'cert-expired' : 'skills-level-label'
                              }
                            >
                              {recordValidity}
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
                              onClick={() => onCertificate?.(record.id)}
                            >
                              <Eye size={16} />
                            </button>
                            {canManageCertificates && record.canEdit && onEditCertificate && (
                              <button
                                type="button"
                                aria-label={`Edit ${record.certificationName} draft`}
                                title="Edit details"
                                disabled={loading}
                                onClick={() => onEditCertificate(record)}
                              >
                                <Pencil size={15} />
                              </button>
                            )}
                            {canRenewCertificates &&
                              record.status === 'APPROVED' &&
                              (recordValidity === 'Expired' || recordValidity === 'Expires soon') &&
                              onRenewCertificate && (
                                <button
                                  type="button"
                                  aria-label={`Record renewal for ${record.certificationName}`}
                                  title="Record renewal"
                                  disabled={loading}
                                  onClick={() => onRenewCertificate(record)}
                                >
                                  <RotateCcw size={15} />
                                </button>
                              )}
                            {canManageCertificates && record.canSubmit && onEditCertificate && (
                              <button
                                type="button"
                                aria-label={`${record.status === 'SUBMITTED' ? 'Reroute' : 'Submit'} ${record.certificationName} for approval`}
                                title={
                                  record.status === 'SUBMITTED'
                                    ? 'Reroute approval request'
                                    : 'Submit for approval'
                                }
                                disabled={loading}
                                onClick={() => onEditCertificate(record)}
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
                  Showing {(current - 1) * size + 1}–{Math.min(current * size, count)} of {count}{' '}
                  {typeFilter === 'skill'
                    ? count === 1
                      ? 'skill'
                      : 'skills'
                    : typeFilter === 'cert'
                      ? count === 1
                        ? 'certification'
                        : 'certifications'
                      : count === 1
                        ? 'item'
                        : 'items'}
                </span>
                <div>
                  <button
                    type="button"
                    aria-label="Previous portfolio page"
                    disabled={current === 1}
                    onClick={() => setPage(current - 1)}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="skills-current-page">{current}</span>
                  <button
                    type="button"
                    aria-label="Next portfolio page"
                    disabled={current === totalPages}
                    onClick={() => setPage(current + 1)}
                  >
                    <ChevronRight size={16} />
                  </button>
                  <label>
                    Rows
                    <select
                      aria-label="Items per page"
                      value={size}
                      onChange={e => {
                        setSize(Number(e.target.value));
                        setPage(1);
                      }}
                    >
                      {[5, 10, 25].map(value => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            </>
          ) : (
            <div className="skills-empty">
              <span>{typeFilter === 'cert' ? <Award size={30} /> : <BookOpen size={30} />}</span>
              <h3>
                {scopedTotal
                  ? 'No matching skills or certifications'
                  : typeFilter === 'cert'
                    ? 'Start your credential portfolio'
                    : 'Start building your portfolio'}
              </h3>
              <p>
                {scopedTotal
                  ? 'Try another search or clear your filters.'
                  : 'Add a published skill or certification to track your progress and approvals in one place.'}
              </p>
              {scopedTotal > 0 ? (
                <button type="button" className="secondary-button" onClick={reset}>
                  Clear filters
                </button>
              ) : (
                <div className="portfolio-empty-actions">
                  {canManageCertificates && onAddCertificate && (
                    <button
                      type="button"
                      className="admin-primary skills-empty-add-btn"
                      onClick={onAddCertificate}
                    >
                      <Plus size={16} /> Add certificate
                    </button>
                  )}
                  {canClaim && onAdd && (
                    <button
                      type="button"
                      className="admin-primary skills-empty-add-btn"
                      onClick={onAdd}
                    >
                      <Plus size={16} /> Add skill
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        <aside className="skills-insights" aria-label="Portfolio overview">
          {extraInsights}
          <section className="skills-insight-card">
            <h3>Profile overview</h3>
            <div className="skills-overview">
              <div
                className="skills-donut"
                role="img"
                aria-label={`${scopedTotal} total items: ${distribution.map(d => d.count + ' ' + d.label).join(', ')}`}
                style={{
                  background: distSum ? `conic-gradient(${gradient})` : 'var(--line)',
                }}
              >
                <div>
                  <strong>{scopedTotal}</strong>
                  <span>
                    {typeFilter === 'skill'
                      ? 'Skills'
                      : typeFilter === 'cert'
                        ? 'Certifications'
                        : 'Total items'}
                  </span>
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
            <h3>Top categories</h3>
            {categoryCounts.length ? (
              <div className="skills-category-chart">
                {categoryCounts.slice(0, 5).map(item => (
                  <button
                    key={item.name}
                    type="button"
                    onClick={() => {
                      setCategory(item.name);
                      setStatusChip('');
                      setStatus('');
                      setQuery('');
                      setRank('');
                      setValidity('');
                      setPage(1);
                    }}
                  >
                    <span>{item.name}</span>
                    <span className="skills-category-bar">
                      <i
                        style={{
                          width: `${scopedTotal ? (item.count / scopedTotal) * 100 : 0}%`,
                        }}
                      />
                    </span>
                    <strong>{item.count}</strong>
                  </button>
                ))}
              </div>
            ) : (
              <p className="skills-insight-empty">
                Your categories will appear as you add skills or certifications.
              </p>
            )}
            <button
              type="button"
              className="skills-text-link"
              onClick={() => {
                reset();
                setTypeFilter('all');
              }}
            >
              View full portfolio
              <ArrowUpRight size={14} />
            </button>
          </section>

          <section className="skills-insight-card skills-next-card">
            <span className="skills-next-icon">
              <Target size={22} />
            </span>
            <h3>Your next step</h3>
            <p>
              {attentionCount
                ? `${attentionCount} ${attentionCount === 1 ? 'item needs' : 'items need'} your attention. Review drafts, feedback or expiring certificates.`
                : pendingCount
                  ? `${pendingCount} ${pendingCount === 1 ? 'item is' : 'items are'} pending approval from your reporting manager.`
                  : 'Add a skill or certification to keep your portfolio up to date.'}
            </p>
            {actionCount > 0 && (
              <button
                type="button"
                className="skills-text-link"
                onClick={() => {
                  reset();
                  setStatusChip('action');
                }}
              >
                Open items needing action
                <ArrowUpRight size={14} />
              </button>
            )}
            {canClaim && onAdd && (
              <button type="button" className="skills-text-link" disabled={loading} onClick={onAdd}>
                Add a skill
                <ArrowUpRight size={14} />
              </button>
            )}
          </section>
        </aside>
      </div>
    </section>
  );
}
