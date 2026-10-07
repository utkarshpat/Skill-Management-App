import { readApiResponse } from './api-response';
import {
  learningDraftReviewable,
  learningPlanSchedule,
  prefillLearningPlanDraft,
  type LearningPlanDraftInput,
} from './learning-plan-draft';

type Fetcher = (url: string, options?: RequestInit) => Promise<Response>;
interface Payload {
  action: 'CREATE';
  id: string;
  revision: 0;
  title: string;
  goal: string;
  timezone: string;
  dailyMinutes: number;
  targetDate: string;
  tasks: { id: string; title: string; estimatedMinutes: number; plannedDate: string }[];
}

// One confirmation keeps one identity even if the write succeeds but its response is lost.
export class LearningPlanCreateAttempt {
  private payload?: Payload;
  private signature?: string;
  private attempted = false;
  private running?: Promise<Payload>;
  save(input: LearningPlanDraftInput, timezone: string, fetcher: Fetcher): Promise<Payload> {
    const draft = prefillLearningPlanDraft(input, '');
    if (!learningDraftReviewable(draft) || !draft.startDate)
      return Promise.reject(Error('Review the plan name, goal, tasks and start date.'));
    const signature = JSON.stringify({ draft, timezone });
    if (this.signature && this.signature !== signature)
      return Promise.reject(
        Error(
          'Retry the original confirmation before editing this plan. Check Calendar if the save status is uncertain.',
        ),
      );
    if (this.running) return this.running;
    if (!this.payload) {
      const schedule = learningPlanSchedule(draft.startDate, draft.tasks);
      this.signature = signature;
      this.payload = {
        action: 'CREATE',
        id: crypto.randomUUID(),
        revision: 0,
        title: draft.title,
        goal: draft.goal,
        timezone,
        dailyMinutes: draft.dailyMinutes,
        targetDate: schedule.at(-1)!.date,
        tasks: schedule.map(item => ({
          id: crypto.randomUUID(),
          title: item.task,
          estimatedMinutes: draft.dailyMinutes,
          plannedDate: item.date,
        })),
      };
    }
    const payload = this.payload;
    const exists = async () => {
      const current = await readApiResponse<{ plans: { id: string }[] }>(
        await fetcher('/api/learning'),
        'Could not check the saved plan.',
      );
      return current.plans.some(plan => plan.id.toLowerCase() === payload.id.toLowerCase());
    };
    this.running = (async () => {
      if (this.attempted && (await exists())) return payload;
      this.attempted = true;
      try {
        await readApiResponse(
          await fetcher('/api/learning', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }),
          'Could not add the plan to Calendar.',
        );
        return payload;
      } catch (error) {
        const status = (error as { status?: number })?.status;
        if (status && status < 500 && status !== 409) throw error;
        try {
          if (await exists()) return payload;
        } catch {
          /* Keep the original failure; a retry must recheck before writing. */
        }
        throw Error(
          'Save could not be confirmed. Retry this confirmation to check the same plan, or check Calendar before starting another plan.',
        );
      }
    })().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
}
