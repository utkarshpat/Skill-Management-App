import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { authenticatedFetch } from './auth';
import { FormDialog } from './FormDialog';
import { AssistantRichText } from './AssistantRichText';
import { dateInZone } from './learning-calendar';
import type { Plan } from './Learning';
import './learning-recovery.css';
interface Preview {
  planId: string;
  revision: number;
  startDate: string;
  dailyMinutes: number;
  oldDailyMinutes: number;
  oldTargetDate: string;
  targetDate: string;
  today: string;
  timezone: string;
  overdue: number;
  totalMinutes: number;
  days: number;
  tasks: { id: string; title: string; oldDate: string; newDate: string; minutes: number }[];
  previewHash: string;
}
export function LearningRecovery({
  plan,
  onClose,
  onSaved,
  onReload,
}: {
  plan: Plan;
  onClose: () => void;
  onSaved: () => void;
  onReload: () => void;
}) {
  const today = dateInZone(new Date(), plan.timezone),
    [start, setStart] = useState(today),
    [minutes, setMinutes] = useState(plan.dailyMinutes),
    [page, setPage] = useState(0),
    [taskPage, setTaskPage] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [stale, setStale] = useState(false),
    [preview, setPreview] = useState<Preview>(),
    [advice, setAdvice] = useState(''),
    [advicePage, setAdvicePage] = useState(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const input = {
    planId: plan.id,
    revision: plan.revision,
    startDate: start,
    dailyMinutes: minutes,
  };
  function reset() {
    setPreview(undefined);
    setAdvice('');
    setError('');
    setStale(false);
  }
  async function request(action: 'preview' | 'apply' | 'advice') {
    if (busy) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError('');
    try {
      const response = await authenticatedFetch('/api/learning/recovery/' + action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abort.signal,
        body: JSON.stringify({
          ...input,
          ...(action === 'apply' ? { previewHash: preview?.previewHash } : {}),
        }),
      });
      const body = await response.json().catch(() => undefined);
      if (!response.ok) {
        if (response.status === 409) setStale(true);
        throw Error(body?.error?.message ?? 'Recovery could not be prepared.');
      }
      if (abort.signal.aborted || !body) return;
      if (action === 'preview') {
        setPreview(body);
        setTaskPage(0);
        setStale(false);
        setPage(1);
      } else if (action === 'apply') onSaved();
      else if (body.previewHash === preview?.previewHash) {
        setAdvice(body.reply);
        setAdvicePage(0);
      } else {
        setStale(true);
        throw Error('The plan changed. Review a fresh preview.');
      }
    } catch (e) {
      if (!abort.signal.aborted)
        setError(e instanceof Error ? e.message : 'Recovery is unavailable.');
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  // Short pages keep long model prose from overflowing the desktop dialog.
  const chunks = advice
    .split(/\n\s*\n/)
    .flatMap(paragraph => {
      if (paragraph.length <= 550) return [paragraph];
      const parts: string[] = [];
      let line = '';
      for (const word of paragraph.split(/\s+/)) {
        if (line.length + word.length + 1 > 550) {
          if (line) parts.push(line);
          line = '';
        }
        line += (line ? ' ' : '') + word;
      }
      if (line) parts.push(line);
      return parts;
    })
    .filter(Boolean)
    .reduce<string[]>((pages, part) => {
      const last = pages.length - 1;
      if (last >= 0 && pages[last].length + part.length + 2 <= 550) pages[last] += '\n\n' + part;
      else pages.push(part);
      return pages;
    }, []);
  return (
    <FormDialog
      title="Recover learning plan"
      subtitle={plan.title}
      className="learning-recovery-dialog"
      busy={busy}
      onClose={onClose}
      page={page}
      onPageChange={next => {
        if (next && !preview) return;
        setPage(next);
      }}
      message={
        error && (
          <p role="alert">
            {error}
            {stale && (
              <button className="admin-text-button" onClick={onReload}>
                Reload plan
              </button>
            )}
          </p>
        )
      }
      pages={[
        {
          label: 'Time budget',
          content: (
            <div className="access-form">
              <p>
                Rebuild all pending tasks from your chosen start date. Completed activities keep
                their original records.
              </p>
              <label>
                Start date
                <input
                  disabled={busy}
                  type="date"
                  min={today}
                  value={start}
                  onChange={e => {
                    setStart(e.target.value);
                    reset();
                  }}
                />
              </label>
              <label>
                Daily minutes for this plan
                <input
                  disabled={busy}
                  type="number"
                  min={5}
                  max={480}
                  value={minutes}
                  onChange={e => {
                    setMinutes(Number(e.target.value));
                    reset();
                  }}
                />
              </label>
              <p>
                Timezone: {plan.timezone}. Oldest pending tasks go first; weekends are included. The
                budget applies to this plan, not your other plans.
              </p>
            </div>
          ),
        },
        {
          label: 'Schedule preview',
          content: preview ? (
            <div>
              <div className="recovery-summary">
                <span>
                  Daily budget
                  <strong>
                    {preview.oldDailyMinutes} → {preview.dailyMinutes} min
                  </strong>
                </span>
                <span>
                  Target date
                  <strong>
                    {preview.oldTargetDate} → {preview.targetDate}
                  </strong>
                </span>
              </div>
              <p>
                {preview.overdue} overdue · {preview.tasks.length} pending · {preview.days} learning{' '}
                {preview.days === 1 ? 'day' : 'days'} · {preview.totalMinutes} planned minutes
              </p>
              <div className="recovery-table">
                <table>
                  <caption className="sr-only">Proposed task dates</caption>
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Old date</th>
                      <th>New date</th>
                      <th>Minutes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.tasks.slice(taskPage * 2, taskPage * 2 + 2).map(t => (
                      <tr key={t.id}>
                        <td data-label="Task">{t.title}</td>
                        <td data-label="Old date">{t.oldDate}</td>
                        <td data-label="New date">{t.newDate}</td>
                        <td data-label="Minutes">{t.minutes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.tasks.length > 2 && (
                <div className="learning-session-pagination">
                  <button
                    className="secondary-button"
                    disabled={busy || !taskPage}
                    onClick={() => setTaskPage(n => n - 1)}
                  >
                    Previous tasks
                  </button>
                  <span>
                    {taskPage + 1}/{Math.ceil(preview.tasks.length / 2)}
                  </span>
                  <button
                    className="secondary-button"
                    disabled={busy || (taskPage + 1) * 2 >= preview.tasks.length}
                    onClick={() => setTaskPage(n => n + 1)}
                  >
                    More tasks
                  </button>
                </div>
              )}
              <p>
                Daily pending work stays within {preview.dailyMinutes} minutes. Existing task
                durations, notes and practice history stay attached.
              </p>
            </div>
          ) : (
            <p>Create a preview first.</p>
          ),
        },
        {
          label: 'AI guidance',
          content: (
            <div>
              <p className="ld-ai-badge">
                <Sparkles size={15} />
                Optional AI guidance
              </p>
              <p>
                The schedule is calculated by the backend. AI can suggest how to approach your
                learning; it cannot change dates or apply this plan.
              </p>
              <button
                className="secondary-button"
                disabled={busy || !preview || stale}
                onClick={() => void request('advice')}
              >
                {busy ? 'Preparing…' : advice ? 'Refresh guidance' : 'Get guidance'}
              </button>
              {advice && (
                <>
                  <div className="recovery-advice">
                    <AssistantRichText>{chunks[advicePage]}</AssistantRichText>
                  </div>
                  {chunks.length > 1 && (
                    <div className="learning-session-pagination">
                      <button
                        className="secondary-button"
                        disabled={busy || !advicePage}
                        onClick={() => setAdvicePage(n => n - 1)}
                      >
                        Previous advice
                      </button>
                      <span>
                        {advicePage + 1}/{chunks.length}
                      </span>
                      <button
                        className="secondary-button"
                        disabled={busy || advicePage + 1 >= chunks.length}
                        onClick={() => setAdvicePage(n => n + 1)}
                      >
                        More advice
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ),
        },
      ]}
      footer={
        <>
          <button className="secondary-button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          {page === 0 ? (
            <button
              className="admin-primary"
              disabled={busy || stale}
              onClick={() => void request('preview')}
            >
              {busy ? 'Preparing…' : 'Preview recovery'}
            </button>
          ) : (
            <>
              <button className="secondary-button" disabled={busy} onClick={() => setPage(0)}>
                Edit budget
              </button>
              <button
                className="admin-primary"
                disabled={busy || !preview || stale}
                onClick={() => void request('apply')}
              >
                {busy ? 'Applying…' : 'Confirm recovery'}
              </button>
            </>
          )}
        </>
      }
    />
  );
}
