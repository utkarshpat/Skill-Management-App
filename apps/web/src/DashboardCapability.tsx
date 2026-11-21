import { displayProficiencyName } from './proficiency';
import { Link } from 'react-router';
import {
  ArrowUpRight,
  Layers,
  ShieldCheck,
  Clock3,
  FilePenLine,
  AlertCircle,
  Plus,
} from 'lucide-react';
import { SkillRadar, type TopReviewedSkill } from './SkillRadar';
export interface RecentCapabilityClaim {
  id: string;
  skillName: string;
  category: string;
  rank: number;
  levelName: string;
  status: 'APPROVED' | 'SUBMITTED' | 'DRAFT' | 'CHANGES_REQUESTED' | 'REJECTED';
  updatedAt: string;
  href: string;
  editHref?: string;
  feedback?: string;
}
interface RecentCertificate {
  id: string;
  name: string;
  issuer: string;
  status: RecentCapabilityClaim['status'];
  href: string;
  editHref?: string;
  feedback?: string;
  renewalHref?: string;
  expiryDate: string | null;
  submittedAt?: string;
  renewalDue?: boolean;
  expired?: boolean;
  activeRenewal?: boolean;
}
export interface DashboardCapabilityData {
  total: number;
  verified: number;
  pending: number;
  draft: number;
  changesRequested: number;
  rejected: number;
  canClaim: boolean;
  recentClaims: RecentCapabilityClaim[];
  submissionDrafts?: { id: string; name: string; href: string }[];
  recentCertificates?: RecentCertificate[];
  certificatePreviewUnavailable?: boolean;
  topSkills?: TopReviewedSkill[];
}
const labels = {
  APPROVED: 'Approved',
  SUBMITTED: 'Pending approval',
  DRAFT: 'Self-assessed draft',
  CHANGES_REQUESTED: 'Changes requested',
  REJECTED: 'Not approved',
};
function nextAction(status: RecentCapabilityClaim['status'], href: string, editHref?: string) {
  if (status === 'DRAFT' && editHref) return { label: 'Continue draft', href: editHref };
  if (status === 'CHANGES_REQUESTED' && editHref)
    return { label: 'Edit and resubmit', href: editHref };
  if (status === 'CHANGES_REQUESTED' || status === 'REJECTED')
    return { label: 'View feedback', href };
  return { label: status === 'DRAFT' ? 'View draft' : 'View details', href };
}

function dashboardDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(date)
    : undefined;
}
export function DashboardCapability({ data }: { data: DashboardCapabilityData }) {
  const states = [
    {
      value: data.verified,
      status: 'APPROVED',
      label: 'Approved',
      tone: 'teal',
      Icon: ShieldCheck,
    },
    {
      value: data.pending,
      status: 'SUBMITTED',
      label: 'Pending approval',
      tone: 'amber',
      Icon: Clock3,
    },
    {
      value: data.draft,
      status: 'DRAFT',
      label: 'Self-assessed drafts',
      tone: 'blue',
      Icon: FilePenLine,
    },
  ];
  return (
    <div className="dashboard-capability-body">
      <div className="dashboard-capability-total">
        <span>
          <Layers size={17} />
          <strong>{data.total}</strong> {data.total === 1 ? 'skill claim' : 'skill claims'}
        </span>
        {data.canClaim && (
          <Link to="/my-skills?action=add">
            <Plus size={15} />
            Add skill
          </Link>
        )}
      </div>
      <div className="dashboard-capability-metrics">
        {states.map(({ Icon, ...s }) => (
          <Link
            key={s.status}
            className={'dashboard-metric ' + s.tone}
            to={'/my-skills?status=' + s.status}
          >
            <Icon size={18} />
            <strong>{s.value}</strong>
            <span>{s.label}</span>
          </Link>
        ))}
      </div>
      {!!data.submissionDrafts?.length && (
        <section
          className="dashboard-capability-recent"
          aria-label="Skills and certificates drafts"
        >
          <h4>Unfinished submissions</h4>
          <ul>
            {data.submissionDrafts.map(draft => (
              <li key={draft.id}>
                <strong>{draft.name}</strong>
                <Link className="dashboard-claim-title" to={draft.href}>
                  Continue draft <ArrowUpRight size={14} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {(data.changesRequested > 0 || data.rejected > 0) && (
        <div className="dashboard-capability-followup">
          {data.changesRequested > 0 && (
            <Link to="/my-skills?status=CHANGES_REQUESTED">
              <AlertCircle size={16} />
              {data.changesRequested} {data.changesRequested === 1 ? 'claim needs' : 'claims need'}{' '}
              changes
              <ArrowUpRight size={15} />
            </Link>
          )}
          {data.rejected > 0 && (
            <Link to="/my-skills?status=REJECTED">
              {data.rejected} not approved · View feedback
              <ArrowUpRight size={15} />
            </Link>
          )}
        </div>
      )}
      {data.total === 0 ? (
        <div className="dashboard-empty">
          <ShieldCheck size={25} />
          <div>
            <strong>Build your capability profile</strong>
            <p>
              {data.canClaim
                ? 'Choose a published skill, describe your experience and prepare a claim for approval.'
                : 'Your skill claims and their approval status will appear here.'}
            </p>
            {data.canClaim && (
              <Link to="/my-skills?action=add">
                Add your first skill
                <ArrowUpRight size={15} />
              </Link>
            )}
          </div>
        </div>
      ) : (
        (data.recentClaims?.length ?? 0) > 0 && (
          <section
            className="dashboard-capability-recent"
            aria-label="Skill claim status and next actions"
          >
            <h4>Skill claims</h4>
            <ul>
              {(data.recentClaims ?? []).map(c => {
                const action = nextAction(c.status, c.href, c.editHref);
                const date = dashboardDate(c.updatedAt);
                return (
                  <li key={c.id}>
                    <div>
                      <Link to={c.href} className="dashboard-claim-title">
                        {c.skillName}
                        <ArrowUpRight size={14} />
                      </Link>
                      <p>
                        {c.category} · {displayProficiencyName(c.rank, c.levelName)}
                      </p>
                      {date && <time dateTime={c.updatedAt}>Updated {date}</time>}
                      {c.feedback && <p>Approval feedback · {c.feedback}</p>}
                    </div>
                    <div className="dashboard-claim-next">
                      <span className={'dashboard-claim-status ' + c.status.toLowerCase()}>
                        {labels[c.status]}
                      </span>
                      <Link
                        className="dashboard-claim-title"
                        to={action.href}
                        aria-label={`${action.label} for ${c.skillName}`}
                      >
                        {action.label} <ArrowUpRight size={14} />
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )
      )}
      {(data.certificatePreviewUnavailable || Boolean(data.recentCertificates?.length)) && (
        <section
          className="dashboard-capability-recent"
          aria-label="Certificate status and next actions"
        >
          <h4>Certificates</h4>
          {data.certificatePreviewUnavailable ? (
            <p>
              Certificate status is unavailable.{' '}
              <Link to="/certifications">Open Certifications</Link>
            </p>
          ) : (
            <ul>
              {data.recentCertificates?.map(c => {
                const action = c.renewalHref
                  ? {
                      label: c.activeRenewal ? 'Continue renewal' : 'Renew certificate',
                      href: c.renewalHref,
                    }
                  : nextAction(c.status, c.href, c.editHref);
                const expiry = c.expiryDate && dashboardDate(c.expiryDate);
                const submitted =
                  c.status === 'SUBMITTED' && c.submittedAt && dashboardDate(c.submittedAt);
                return (
                  <li key={c.id}>
                    <div>
                      <Link to={c.href} className="dashboard-claim-title">
                        {c.name} <ArrowUpRight size={14} />
                      </Link>
                      <p>
                        {c.issuer}
                        {expiry ? ` · ${c.expired ? 'Expired' : 'Valid till'} ${expiry}` : ''}
                      </p>
                      {submitted && <time dateTime={c.submittedAt}>Submitted {submitted}</time>}
                      {c.feedback && <p>Approval feedback · {c.feedback}</p>}
                    </div>
                    <div className="dashboard-claim-next">
                      <span className={'dashboard-claim-status ' + c.status.toLowerCase()}>
                        {labels[c.status]}
                      </span>
                      <Link
                        className="dashboard-claim-title"
                        to={action.href}
                        aria-label={`${action.label} for ${c.name}`}
                      >
                        {action.label} <ArrowUpRight size={14} />
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
      {data.topSkills ? (
        <SkillRadar skills={data.topSkills} reviewed={data.verified} />
      ) : (
        <p className="dashboard-footnote">
          Top-skill snapshot is unavailable. Your complete approved skills are available in My
          skills.
        </p>
      )}
      <p className="dashboard-footnote">
        Approved proficiency and self-assessed claims are kept separate. Learning completion does
        not verify a skill.
      </p>
    </div>
  );
}
