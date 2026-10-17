import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createSkillProfileIndex, filterSkillProfile } from './skill-profile-index';

import {
  Layers,
  ShieldCheck,
  Clock3,
  UserRound,
  Search,
  ArrowUpRight,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Eye,
  Send,
  RotateCcw,
  Code2,
  Database,
  Cloud,
  Brain,
  Briefcase,
  Monitor,
  Target,
  AlertCircle,
  Plus,
} from 'lucide-react';
import { SupportingCertificates } from './capabilities/SupportingCertificates';
import type { CertificationRecord } from './certifications/types';
import type { Claim } from './MySkills';

const statuses: Record<Claim['status'], string> = {
  DRAFT: 'Self-assessed',
  SUBMITTED: 'Pending review',
  CHANGES_REQUESTED: 'Changes requested',
  APPROVED: 'Manager reviewed',
  REJECTED: 'Not approved',
};
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
export function SkillsProfileView({
  claims,
  canClaim,
  loading,
  onView,
  onEdit,
  onSubmit,
  onAdd,
  certificates = [],
  onCertificate,
  extraInsights,
  initialStatus = '',
}: {
  claims: Claim[];
  certificates?: CertificationRecord[];
  onCertificate?: (id: string) => void;
  extraInsights?: ReactNode;
  canClaim: boolean;
  loading: boolean;
  onView: (claim: Claim) => void;
  onEdit: (claim: Claim) => void;
  onSubmit: (claim: Claim) => void;
  onAdd?: () => void;
  initialStatus?: string;
}) {
  const [query, setQuery] = useState(''),
    [category, setCategory] = useState(''),
    [status, setStatus] = useState(''),
    [rank, setRank] = useState(''),
    [page, setPage] = useState(1),
    [size, setSize] = useState(10),
    [tab, setTab] = useState('all');
  useEffect(() => {
    setStatus(Object.hasOwn(statuses, initialStatus) ? initialStatus : '');
    setTab('all');
    setPage(1);
  }, [initialStatus]);
  const index = useMemo(() => createSkillProfileIndex(claims), [claims]);
  const { approved, pending, drafts, attention, categories, levels, categoryCounts } = index;
  const filtered = useMemo(
    () => filterSkillProfile(index, { query, category, status, rank, tab }),
    [index, query, category, status, rank, tab],
  );
  const count = filtered.length,
    totalPages = Math.max(1, Math.ceil(count / size)),
    current = Math.min(page, totalPages),
    rows = filtered.slice((current - 1) * size, current * size);
  const change = () => setPage(1),
    reset = () => {
      setQuery('');
      setCategory('');
      setStatus('');
      setRank('');
      setTab('all');
      change();
    };
  const distribution = [
    { label: 'Manager reviewed', count: approved, color: 'var(--skill-reviewed)' },
    { label: 'Pending review', count: pending, color: 'var(--skill-pending)' },
    { label: 'Self-assessed', count: drafts, color: 'var(--skill-draft)' },
    { label: 'Needs attention', count: attention, color: 'var(--skill-attention)' },
  ];
  let stop = 0;
  const gradient = distribution
    .map(item => {
      const start = stop;
      stop += claims.length ? (item.count / claims.length) * 100 : 0;
      return `${item.color} ${start}% ${stop}%`;
    })
    .join(',');
  const metrics = [
    { label: 'Total skills', count: claims.length, Icon: Layers, tone: 'total', filter: '' },
    {
      label: 'Manager reviewed',
      count: approved,
      Icon: ShieldCheck,
      tone: 'reviewed',
      filter: 'APPROVED',
    },
    { label: 'Pending review', count: pending, Icon: Clock3, tone: 'pending', filter: 'SUBMITTED' },
    { label: 'Self-assessed', count: drafts, Icon: UserRound, tone: 'draft', filter: 'DRAFT' },
  ];
  return (
    <section className="skills-profile" aria-label="My skills profile" aria-busy={loading}>
      <div className="skills-metrics">
        {metrics.map(({ label, count, Icon, tone, filter }) => (
          <button
            key={tone}
            className={'skills-metric ' + tone}
            aria-label={`${label}: ${count}. Filter skills`}
            aria-pressed={tab === 'all' && status === filter}
            onClick={() => {
              setTab('all');
              setStatus(filter);
              setCategory('');
              setQuery('');
              setRank('');
              change();
            }}
          >
            <div>
              <strong>{count}</strong>
              <span>{label}</span>
            </div>
            <span className="skills-metric-icon">
              <Icon size={22} aria-hidden="true" />
            </span>
          </button>
        ))}
      </div>
      {!canClaim && (
        <p className="skills-readonly">
          <InfoNote />
          You can view your profile. Your current permissions do not include adding or editing
          claims.
        </p>
      )}
      <div className="skills-content-grid">
        <section className="skills-list-card" aria-label="Your skill claims">
          <div className="skills-card-header">
            <label className="skills-query">
              <Search size={17} aria-hidden="true" />
              <input
                type="search"
                name="profileSkillSearch"
                aria-label="Search your skills"
                value={query}
                maxLength={100}
                placeholder="Search your skills…"
                onChange={e => {
                  setQuery(e.target.value);
                  change();
                }}
              />
            </label>
            <div className="skills-list-tabs" role="group" aria-label="Skill views">
              {[
                { id: 'all', label: 'All skills' },
                { id: 'attention', label: 'To complete', count: drafts + attention },
                { id: 'reviewed', label: 'Reviewed', count: approved },
              ].map(item => (
                <button
                  key={item.id}
                  aria-pressed={tab === item.id}
                  onClick={() => {
                    setTab(item.id);
                    setStatus('');
                    change();
                  }}
                >
                  {item.label}
                  {item.count !== undefined && <span>{item.count}</span>}
                </button>
              ))}
              {loading && (
                <span role="status" className="skills-refreshing">
                  Updating…
                </span>
              )}
            </div>
          </div>
          <div className="skills-filters">
            <select
              aria-label="Filter skill category"
              value={category}
              onChange={e => {
                setCategory(e.target.value);
                change();
              }}
            >
              <option value="">All categories</option>
              {categories.map(name => (
                <option key={name}>{name}</option>
              ))}
            </select>
            <select
              aria-label="Filter skill status"
              value={status}
              onChange={e => {
                setStatus(e.target.value);
                change();
              }}
            >
              <option value="">All statuses</option>
              {Object.entries(statuses).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter proficiency level"
              value={rank}
              onChange={e => {
                setRank(e.target.value);
                change();
              }}
            >
              <option value="">All levels</option>
              {levels.map(value => (
                <option key={value} value={value}>
                  Level {value}
                </option>
              ))}
            </select>
            <button className="skills-clear" onClick={reset} aria-label="Clear skill filters">
              <RotateCcw size={14} />
              Clear
            </button>
          </div>
          {rows.length ? (
            <>
              <div className="skills-items-container" role="list" aria-label="Your skills list">
                {rows.map(claim => (
                  <article key={claim.id} className="skills-item-card" role="listitem">
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
                              {statuses[claim.status]}
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
                            <strong className="skills-level-label">Level {claim.rank}</strong>
                            <span className="skills-level-name">{claim.levelName}</span>
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
                            ['DRAFT', 'CHANGES_REQUESTED', 'REJECTED'].includes(claim.status) && (
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
                                  ? 'Reroute review'
                                  : 'Submit for review'
                              }
                              aria-label={`${claim.status === 'SUBMITTED' ? 'Reroute' : 'Submit'} ${claim.skillName} for review`}
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
                        skillId={claim.skillId}
                        disabled={loading}
                        onOpen={onCertificate}
                      />
                    )}
                  </article>
                ))}
              </div>
              <div className="skills-pagination">
                <span>
                  Showing {(current - 1) * size + 1}–{Math.min(current * size, count)} of {count}{' '}
                  {count === 1 ? 'skill' : 'skills'}
                </span>
                <div>
                  <button
                    aria-label="Previous skill page"
                    disabled={current === 1}
                    onClick={() => setPage(current - 1)}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="skills-current-page">{current}</span>
                  <button
                    aria-label="Next skill page"
                    disabled={current === totalPages}
                    onClick={() => setPage(current + 1)}
                  >
                    <ChevronRight size={16} />
                  </button>
                  <label>
                    Rows
                    <select
                      aria-label="Skills per page"
                      value={size}
                      onChange={e => {
                        setSize(Number(e.target.value));
                        change();
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
              <span>
                <BookOpen size={30} />
              </span>
              <h3>{claims.length ? 'No matching skills' : 'Start building your skill profile'}</h3>
              <p>
                {claims.length
                  ? 'Try another search or clear your filters.'
                  : 'Add a published skill, describe your experience and choose your current proficiency.'}
              </p>
              {claims.length > 0 && (
                <button className="secondary-button" onClick={reset}>
                  Clear filters
                </button>
              )}
              {canClaim && onAdd && !claims.length && (
                <button
                  type="button"
                  className="admin-primary skills-empty-add-btn"
                  onClick={onAdd}
                >
                  <Plus size={16} /> Add your first skill
                </button>
              )}
            </div>
          )}
        </section>
        <aside className="skills-insights" aria-label="Skill profile overview">
          {extraInsights}
          <section className="skills-insight-card">
            <h3>Profile overview</h3>
            <div className="skills-overview">
              <div
                className="skills-donut"
                role="img"
                aria-label={`${claims.length} total skills: ${distribution.map(d => d.count + ' ' + d.label).join(', ')}`}
                style={{
                  background: claims.length ? `conic-gradient(${gradient})` : 'var(--line)',
                }}
              >
                <div>
                  <strong>{claims.length}</strong>
                  <span>Total skills</span>
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
                    onClick={() => {
                      setCategory(item.name);
                      setTab('all');
                      setStatus('');
                      setQuery('');
                      setRank('');
                      change();
                    }}
                  >
                    <span>{item.name}</span>
                    <span className="skills-category-bar">
                      <i style={{ width: `${(item.count / claims.length) * 100}%` }} />
                    </span>
                    <strong>{item.count}</strong>
                  </button>
                ))}
              </div>
            ) : (
              <p className="skills-insight-empty">Your categories will appear as you add skills.</p>
            )}
            <button className="skills-text-link" onClick={reset}>
              View all skills
              <ArrowUpRight size={14} />
            </button>
          </section>
          <section className="skills-insight-card skills-next-card">
            <span className="skills-next-icon">
              <Target size={22} />
            </span>
            <h3>Your next step</h3>
            <p>
              {attention
                ? `${attention} claims need an update. Review your manager’s feedback before resubmitting.`
                : drafts
                  ? `${drafts} self-assessed ${drafts === 1 ? 'draft is' : 'drafts are'} ready for you to review and submit.`
                  : pending
                    ? `${pending} ${pending === 1 ? 'claim is' : 'claims are'} awaiting your reporting manager’s review.`
                    : 'Add a skill and describe your experience to keep your profile up to date.'}
            </p>
            {drafts + attention > 0 && (
              <button
                className="skills-text-link"
                onClick={() => {
                  reset();
                  setTab('attention');
                }}
              >
                Review my drafts
                <ArrowUpRight size={14} />
              </button>
            )}
            {canClaim && onAdd && (
              <button className="skills-text-link" disabled={loading} onClick={onAdd}>
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
function InfoNote() {
  return <ShieldCheck size={16} aria-hidden="true" />;
}
