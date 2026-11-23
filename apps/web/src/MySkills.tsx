import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CapabilityComposer } from './capabilities/DeferredCapabilityDialogs';
import { CapabilitySubmissions } from './capabilities/CapabilitySubmissions';
import { useOwnCertificates, CertificateRenewalSummary } from './capabilities/SkillCertificates';
import { Plus } from 'lucide-react';
import { authenticatedFetch } from './auth';
import { readApiResponse } from './api-response';
import { SkillClaimDialog } from './SkillClaimDialog';
import { ExcelBulkActions } from './ExcelBulkActions';
import { SkillsProfileView } from './SkillsProfileView';
import './skills-profile.css';
import {
  SkillClaimWizard,
  type SkillChoice,
  type SkillDraft,
  type SkillChoices,
} from './SkillClaimWizard';
import { Link, useLocation, useNavigate } from 'react-router';
import type { ClaimReviewDecision } from './ClaimReviewAccess';
import { skillDateError } from './skill-dates';
import { notificationUpdateMatches } from './notification-model';
import { toast } from './toast';
import {
  fetchOwnSkillProfile,
  LatestProfileRequest,
  notifySkillSubmitted,
  type OwnSkillProfile,
} from './own-skill-profile';

export interface Claim {
  activeSubmissionId?: string;
  personId?: string;
  reviewAccess?: ClaimReviewDecision;
  id: string;
  revision: number;
  skillId: string;
  skillName: string;
  category: string;
  definitionRevision: number;
  rank: number;
  levelName: string;
  experienceMonths: number;
  lastUsedOn?: string | null;
  description: string;
  status: 'DRAFT' | 'SUBMITTED' | 'CHANGES_REQUESTED' | 'APPROVED' | 'REJECTED';
  updatedAt: string;
  projects?: string;
  evidence?: string;
  feedback?: string;
  personName?: string;
  levelDescription?: string;
}
type Option = SkillChoice;
type State = OwnSkillProfile;
type Options = SkillChoices;
interface OptionResult {
  draftId: string;
  search: string;
  category: string;
  page: number;
  value: Options;
}
type Draft = SkillDraft;
async function body<T>(response: Response): Promise<T> {
  return readApiResponse<T>(
    response,
    response.status === 403
      ? 'Your account does not have access to this skill action.'
      : response.status === 401
        ? 'Sign in to view your skills.'
        : 'Could not load your skills. Please try again.',
  );
}
export function MySkills({
  actionsContainer,
  canImportCertificates = false,
  unified = false,
  initialType = 'all',
}: {
  actionsContainer?: HTMLElement | null;
  canImportCertificates?: boolean;
  unified?: boolean;
  initialType?: 'all' | 'skill' | 'cert';
}) {
  const certificateContext = useOwnCertificates();
  const location = useLocation(),
    navigate = useNavigate();
  const [state, setState] = useState<State>(),
    [loading, setLoading] = useState(true);
  const [inspecting, setInspecting] = useState<Claim>(),
    [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [combined, setCombined] = useState(false);
  const [combinedId, setCombinedId] = useState<string>();
  const [intakeEntry, setIntakeEntry] = useState<{
    skill?: { id?: string; name?: string };
    draft?: import('./capabilities/capability-model').SelectedSkill;
    file?: File;
    certificate?: boolean;
  }>();
  const [submissionFailure, setSubmissionFailure] = useState<{ id: string; message: string }>();
  const [draft, setDraft] = useState<Draft>(),
    [formPage, setFormPage] = useState(0),
    [busy, setBusy] = useState(false),
    [formError, setFormError] = useState('');
  const [optionResult, setOptionResult] = useState<OptionResult>(),
    [search, setSearch] = useState(''),
    [category, setCategory] = useState(''),
    [picked, setPicked] = useState<Option>(),
    [optionPage, setOptionPage] = useState(1),
    [optionsLoading, setOptionsLoading] = useState(false);
  const options =
    optionResult?.draftId === draft?.id &&
    optionResult?.search === search &&
    optionResult?.category === category &&
    optionResult?.page === optionPage
      ? optionResult.value
      : undefined;
  const profileRequests = useRef(new LatestProfileRequest());
  const recoveryRequest = useRef<string | undefined>(undefined);
  const [recoveryRetry, setRecoveryRetry] = useState(0);
  const recoveryId = new URLSearchParams(location.search).get('submitClaim');
  async function load(onLoaded?: (value: State) => void) {
    const controller = profileRequests.current.start(),
      { signal } = controller;
    setLoading(true);
    try {
      const value = await fetchOwnSkillProfile(authenticatedFetch, signal);
      if (profileRequests.current.current(controller)) {
        setState(value);
        setError('');
        onLoaded?.(value);
      }
    } catch (error) {
      if (profileRequests.current.current(controller)) {
        if (
          error &&
          typeof error === 'object' &&
          'status' in error &&
          [401, 403].includes(Number(error.status))
        )
          setState(undefined);
        setError(error instanceof Error ? error.message : 'Could not load your skills.');
      }
    } finally {
      if (profileRequests.current.current(controller)) setLoading(false);
    }
  }
  useEffect(() => {
    if (!recoveryId) void load();
    const refresh = () => {
      if (recoveryRequest.current) setRecoveryRetry(value => value + 1);
      else void load();
    };
    const refreshRemote = (event: Event) => {
      if (notificationUpdateMatches(event, ['Skills & approvals', 'Profile & access'])) refresh();
    };
    window.addEventListener('own-skills-updated', refresh);
    window.addEventListener('notifications-remote-updated', refreshRemote);
    return () => {
      profileRequests.current.abort();
      window.removeEventListener('own-skills-updated', refresh);
      window.removeEventListener('notifications-remote-updated', refreshRemote);
    };
  }, []);
  useEffect(() => {
    if (!draft) return;
    const controller = new AbortController();
    setOptionResult(undefined);
    setOptionsLoading(true);
    const timer = setTimeout(() => {
      authenticatedFetch(
        `/api/my-skills/catalogue?search=${encodeURIComponent(search)}&page=${optionPage}&category=${encodeURIComponent(category)}&pageSize=3`,
        { signal: controller.signal },
      )
        .then(body<Options>)
        .then(value => {
          if (!controller.signal.aborted)
            setOptionResult({ draftId: draft.id, search, category, page: optionPage, value });
        })
        .catch(error => {
          if (!controller.signal.aborted) {
            setOptionResult(undefined);
            setFormError(error.message);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setOptionsLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [draft?.id, search, optionPage, category]);
  const selected = options?.skills.find(item => item.id === draft?.skillId) ?? picked;
  useEffect(() => {
    const current = options?.skills.find(item => item.id === draft?.skillId);
    if (current) setPicked(current);
  }, [options, draft?.skillId]);
  function edit(claim: Claim) {
    if (claim.activeSubmissionId) {
      setCombinedId(claim.activeSubmissionId);
      setCombined(true);
      return;
    }
    setOptionResult(undefined);
    setPicked(undefined);
    setCategory('');
    setFormError('');
    setFormPage(0);
    setOptionPage(1);
    setSearch(claim.skillName);
    setDraft({
      id: claim.id,
      revision: claim.revision,
      skillId: claim.skillId,
      definitionRevision: claim.definitionRevision,
      rank: claim.rank,
      experienceMonths: claim.experienceMonths,
      lastUsedOn: claim.lastUsedOn ?? null,
      description: claim.description,
      projects: claim.projects ?? '',
      evidence: claim.evidence ?? '',
    });
  }
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (!state || params.get('action') !== 'add') return;
    const suggested = params.get('skill') ?? '';
    const skillName = params.get('skillName') ?? '';
    const certificate = params.get('entry') === 'certificate';
    params.delete('action');
    params.delete('skill');
    params.delete('skillName');
    params.delete('entry');
    navigate(location.pathname + (params.size ? '?' + params : ''), { replace: true });
    if (state.canClaim) {
      const isId = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(suggested);
      setIntakeEntry({
        certificate,
        skill: suggested
          ? isId
            ? { id: suggested, name: skillName }
            : { name: suggested }
          : undefined,
      });
      setCombinedId(undefined);
      setCombined(true);
    } else setError('Skill editing is not assigned.');
  }, [location.search, state?.canClaim]);
  useEffect(() => {
    const params = new URLSearchParams(location.search),
      editId = params.get('editClaim'),
      id = editId ?? params.get('claim');
    if (recoveryId || !id || !state || loading) return;
    params.delete('claim');
    params.delete('editClaim');
    params.delete('submitClaim');
    navigate(location.pathname + (params.size ? '?' + params : ''), { replace: true });
    const claim = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      ? state.claims.find(c => c.id.toLowerCase() === id.toLowerCase())
      : undefined;
    if (!claim) {
      setError('This claim is unavailable in your current skill profile.');
      return;
    }
    if (
      editId &&
      state.canClaim &&
      ['DRAFT', 'CHANGES_REQUESTED', 'REJECTED'].includes(claim.status)
    ) {
      edit(claim);
      return;
    }
    if (editId && !state.canClaim)
      setError('Your account does not have permission to edit or submit this claim.');
    setInspecting(claim);
    setSubmitting(false);
  }, [location.search, state, loading]);
  useEffect(() => {
    if (!recoveryId) {
      if (recoveryRequest.current) {
        setLoading(false);
        if (!state) void load();
      }
      recoveryRequest.current = undefined;
      return;
    }
    recoveryRequest.current = recoveryId;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(recoveryId)) {
      setLoading(false);
      setError('This claim is unavailable in your current skill profile.');
      return;
    }
    void load(value => {
      const params = new URLSearchParams(location.search);
      params.delete('submitClaim');
      navigate(location.pathname + (params.size ? '?' + params : ''), { replace: true });
      const claim = value.claims.find(c => c.id.toLowerCase() === recoveryId.toLowerCase());
      if (!claim) {
        setError('This claim is unavailable in your current skill profile.');
        return;
      }
      if (!value.canClaim) {
        setError('Your account does not have permission to submit this claim.');
        return;
      }
      setInspecting(claim);
      setSubmitting(['DRAFT', 'CHANGES_REQUESTED', 'REJECTED'].includes(claim.status));
    });
    return () => {
      profileRequests.current.abort();
    };
  }, [recoveryId, recoveryRetry]);
  async function save(submit = false) {
    if (!draft || busy) return;
    if (!selected || !selected.levels.some(level => level.rank === draft.rank)) {
      setFormPage(0);
      setFormError('Select a published skill and its proficiency level.');
      return;
    }
    if (
      !Number.isSafeInteger(draft.experienceMonths) ||
      draft.experienceMonths < 0 ||
      draft.experienceMonths > 600
    ) {
      setFormPage(0);
      setFormError('Experience must be between 0 and 600 months.');
      return;
    }
    const dateError = skillDateError(draft.lastUsedOn);
    if (dateError) {
      setFormPage(1);
      setFormError(dateError);
      return;
    }
    if ((draft.projects?.length ?? 0) > 2000 || (draft.evidence?.length ?? 0) > 2000) {
      setFormPage(1);
      setFormError('Use up to 2,000 characters for projects and evidence.');
      return;
    }
    if (draft.description.trim().length > 2000) {
      setFormPage(1);
      setFormError('Keep your experience description within 2,000 characters.');
      return;
    }
    setBusy(true);
    setFormError('');
    try {
      await body(
        await authenticatedFetch('/api/my-skills', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...draft,
            lastUsedOn: draft.lastUsedOn || null,
            definitionRevision: selected.definitionRevision,
          }),
        }),
      );
      let message =
          'Skill draft saved. It is self-assessed and has not been submitted for approval.',
        submissionFailed = false;
      if (submit) {
        // Saving always advances the claim revision by one; the server rechecks reviewer routing on submit.
        try {
          await body(
            await authenticatedFetch('/api/my-skills/submit', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                id: draft.id,
                revision: draft.revision + 1,
                action: 'SUBMIT',
                feedback: '',
              }),
            }),
          );
          message = 'Skill submitted to your assigned reporting manager for approval.';
          notifySkillSubmitted();
        } catch (error) {
          submissionFailed = true;
          message =
            'Skill draft saved, but it could not be submitted: ' +
            (error instanceof Error ? error.message : 'try again from My skills.');
        }
      }
      setDraft(undefined);
      if (submissionFailed) {
        setSubmissionFailure({ id: draft.id, message });
        toast.warning(message);
      } else {
        setSubmissionFailure(undefined);
        toast.success(message);
      }
      window.dispatchEvent(new Event('own-skills-updated'));
      if (!submit) {
        setInspecting({
          ...draft,
          revision: draft.revision + 1,
          skillName: selected.name,
          category: selected.category,
          levelName: selected.levels.find(level => level.rank === draft.rank)!.name,
          status: 'DRAFT',
          updatedAt: new Date().toISOString(),
        });
        setSubmitting(true);
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Your draft could not be saved.');
    } finally {
      setBusy(false);
    }
  }
  const showCertificateBulkAction = Boolean(canImportCertificates && certificateContext?.data);
  const canAddCertificate = Boolean(certificateContext?.data?.canManage);
  const actions = (state?.canClaim || canAddCertificate || showCertificateBulkAction) && (
    <>
      {showCertificateBulkAction && (
        <ExcelBulkActions kind="certifications" showImport onImported={certificateContext?.retry} />
      )}
      {canAddCertificate && (
        <button
          className="admin-primary"
          disabled={busy || loading}
          onClick={() => {
            setIntakeEntry({ certificate: true });
            setCombined(true);
          }}
        >
          <Plus size={17} />
          Add certificate
        </button>
      )}
      {state?.canClaim && (
        <button
          className="admin-primary"
          disabled={busy || loading}
          onClick={() => setCombined(true)}
        >
          <Plus size={17} />
          Add skill
        </button>
      )}
    </>
  );
  function closeDraft() {
    setDraft(undefined);
  }
  return (
    <>
      <CapabilitySubmissions onUpdated={() => void load()} />
      {combined && (
        <CapabilityComposer
          submissionId={combinedId}
          initialSkill={intakeEntry?.skill}
          initialSkillDraft={intakeEntry?.draft}
          initialEvidenceFile={intakeEntry?.file}
          entry={combinedId ? undefined : intakeEntry?.certificate ? 'certificate' : 'skill'}
          onClose={() => {
            setIntakeEntry(undefined);
            setCombined(false);
            setCombinedId(undefined);
          }}
          onSaved={() => {
            setIntakeEntry(undefined);
            setCombined(false);
            setCombinedId(undefined);
            void load();
          }}
        />
      )}
      <>
        {submissionFailure && (
          <div className="access-message" role="alert">
            <p>{submissionFailure.message}</p>
            <Link
              className="secondary-button"
              to={'/my-skills?submitClaim=' + encodeURIComponent(submissionFailure.id)}
            >
              Check saved draft and retry submission
            </Link>
            <button className="secondary-button" onClick={() => setSubmissionFailure(undefined)}>
              Dismiss
            </button>
          </div>
        )}
        {actionsContainer
          ? createPortal(actions, actionsContainer)
          : actions && <div className="my-skills-actions">{actions}</div>}
        {error && (
          <div className="access-message" role="alert">
            {error}
            <button
              className="secondary-button"
              disabled={loading}
              onClick={() => {
                if (recoveryId) setRecoveryRetry(value => value + 1);
                else void load();
              }}
            >
              Retry
            </button>
          </div>
        )}
        {loading && !state ? (
          <section className="profile-panel" role="status">
            Loading your skills…
          </section>
        ) : (
          state && (
            <SkillsProfileView
              initialStatus={new URLSearchParams(location.search).get('status') ?? ''}
              unified={Boolean(unified && certificateContext)}
              initialType={initialType}
              onAdd={() => setCombined(true)}
              onAddCertificate={
                canAddCertificate
                  ? () => {
                      setIntakeEntry({ certificate: true });
                      setCombined(true);
                    }
                  : undefined
              }
              claims={state.claims}
              certificates={certificateContext?.data?.records}
              certificatesToday={certificateContext?.today}
              canManageCertificates={canAddCertificate}
              canRenewCertificates={Boolean(
                certificateContext?.data?.canManage && certificateContext?.data?.canUploadImage,
              )}
              onCertificate={certificateContext?.open}
              onEditCertificate={certificateContext?.edit}
              onRenewCertificate={certificateContext?.renew}
              extraInsights={<CertificateRenewalSummary />}
              canClaim={state.canClaim}
              loading={loading || busy}
              onView={claim => {
                setInspecting(claim);
                setSubmitting(false);
              }}
              onEdit={edit}
              onSubmit={claim => {
                if (claim.activeSubmissionId) {
                  setCombinedId(claim.activeSubmissionId);
                  setCombined(true);
                  return;
                }
                setInspecting(claim);
                setSubmitting(true);
              }}
            />
          )
        )}
      </>
      {inspecting && (
        <SkillClaimDialog
          claim={inspecting}
          mode={submitting ? 'submit' : 'view'}
          onClose={() => setInspecting(undefined)}
          onSaved={action => {
            if (action === 'submitted') {
              notifySkillSubmitted();
              setSubmissionFailure(undefined);
            }
            setInspecting(undefined);
            toast.success(
              action === 'submitted'
                ? 'Claim submitted to your assigned reporting manager.'
                : 'Skill claim updated.',
            );
            window.dispatchEvent(new Event('own-skills-updated'));
          }}
        />
      )}
      {draft && (
        <SkillClaimWizard
          draft={draft}
          onDraft={setDraft}
          selected={selected}
          onUseAsCertificate={
            selected
              ? file => {
                  if (file.size > 5 * 1024 * 1024) {
                    setFormError(
                      'Certificates have a 5 MB limit. Choose a smaller file; your evidence stays unchanged.',
                    );
                    return;
                  }
                  setIntakeEntry({
                    certificate: true,
                    file,
                    draft: {
                      ...draft,
                      choice: selected,
                      reuse: false,
                      lastUsedOn: draft.lastUsedOn ?? '',
                      projects: draft.projects ?? '',
                      evidence: draft.evidence ?? '',
                    },
                  });
                  setDraft(undefined);
                  setCombinedId(undefined);
                  setCombined(true);
                }
              : undefined
          }
          onSelect={skill => {
            setPicked(skill);
            const switching = Boolean(draft.skillId) && skill.id !== draft.skillId;
            setDraft({
              ...draft,
              skillId: skill.id,
              definitionRevision: skill.definitionRevision,
              ...(switching
                ? {
                    rank: 0,
                    experienceMonths: 0,
                    lastUsedOn: null,
                    description: '',
                    projects: undefined,
                    evidence: undefined,
                  }
                : {}),
            });
          }}
          options={options}
          loading={optionsLoading}
          busy={busy}
          error={formError}
          page={formPage}
          onPage={setFormPage}
          search={search}
          onSearch={value => {
            setSearch(value);
            setOptionPage(1);
            setFormError('');
          }}
          category={category}
          onCategory={value => {
            setCategory(value);
            setOptionPage(1);
            setFormError('');
          }}
          onResultsPage={setOptionPage}
          onSave={submit => void save(submit)}
          onClose={closeDraft}
        />
      )}
    </>
  );
}
