import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { CheckCircle2, Sparkles, ArrowRight } from 'lucide-react';
import type { Plan } from './Learning';
import { authenticatedFetch } from './auth';
import { readApiResponse } from './api-response';
import { AssistantRichText } from './AssistantRichText';

import {
  completedLearningPlans,
  learningNextStepPrompt,
  canUseLearningClaimActions,
} from './learning-next-step';

export function LearningCompletionNextSteps({ plans }: { plans: Plan[] }) {
  const completed = completedLearningPlans(plans);
  const [selected, setSelected] = useState(''),
    [reply, setReply] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [canClaim, setCanClaim] = useState(false);
  const request = useRef<AbortController | undefined>(undefined),
    lock = useRef(false);
  const revisionKey = completed.map(p => `${p.id}:${p.revision}`).join(',');
  useEffect(() => {
    request.current?.abort();
    lock.current = false;
    setBusy(false);
    setReply('');
    setError('');
    setSelected('');
    setCanClaim(false);
    return () => request.current?.abort();
  }, [revisionKey]);
  async function suggest(plan: Plan) {
    if (lock.current) return;
    const abort = new AbortController();
    request.current = abort;
    lock.current = true;
    setBusy(true);
    setSelected(plan.id);
    setReply('');
    setError('');
    setCanClaim(false);
    try {
      const value = await readApiResponse<{ reply: string }>(
        await authenticatedFetch('/api/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: learningNextStepPrompt(plan.id) }),
          signal: abort.signal,
        }),
        'Next-step suggestions are unavailable. Try again.',
      );
      if (!abort.signal.aborted) {
        setReply(value.reply);
        // Canonical server discovery, never learning completion or role labels, grants actions.
        try {
          const navigation = await readApiResponse<{
            canReviewOwnSkill?: boolean;
            pages?: { url: string }[];
          }>(
            await authenticatedFetch('/api/assistant/navigation', { signal: abort.signal }),
            'Skill actions could not be verified.',
          );
          if (!abort.signal.aborted) setCanClaim(canUseLearningClaimActions(navigation));
        } catch {
          /* A verified answer remains useful; unavailable actions stay hidden. */
        }
      }
    } catch (e) {
      if (!abort.signal.aborted) setError((e as Error).message);
    } finally {
      if (request.current === abort) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  if (!completed.length) return null;
  const plan = completed.find(p => p.id === selected);
  return (
    <section className="ld-card learning-completion-next">
      <div className="ld-card-title">
        <h2>
          <CheckCircle2 size={19} /> Learning completed
        </h2>
      </div>
      <p>
        Turn your learning into a next step. Add a skill based on your experience, or explore a
        certification to earn.
      </p>
      {completed.slice(0, 5).map(p => (
        <article key={p.id}>
          <strong>{p.title}</strong>
          <button className="secondary-button" disabled={busy} onClick={() => void suggest(p)}>
            <Sparkles size={15} />
            {busy && selected === p.id ? 'Finding next steps…' : 'Suggest next steps'}
          </button>
        </article>
      ))}
      {error && <p role="alert">{error}</p>}
      {reply && (
        <div aria-live="polite">
          <AssistantRichText>{reply}</AssistantRichText>
          {canClaim && (
            <div className="learning-completion-actions">
              <Link
                className="secondary-button"
                to={
                  '/my-skills?action=add' +
                  (plan?.skillId ? '&skill=' + encodeURIComponent(plan.skillId) : '')
                }
              >
                Add skill <ArrowRight size={14} />
              </Link>
              <Link className="secondary-button" to="/my-skills?action=add">
                Upload earned certificate <ArrowRight size={14} />
              </Link>
            </div>
          )}
        </div>
      )}
      <small>Learning completion does not verify proficiency or award a certification.</small>
    </section>
  );
}
