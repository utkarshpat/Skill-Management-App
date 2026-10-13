import type { Plan } from './Learning';
export const completedLearningPlans = (plans: Plan[]) =>
  plans.filter(
    p =>
      p.status !== 'ARCHIVED' && p.tasks.length > 0 && p.tasks.every(t => Boolean(t.completedAt)),
  );
export function learningNextStepPrompt(id: string) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))
    throw Error('Choose a saved learning plan.');
  return `Use my_learning to verify that my own plan ${id} has all tasks completed. If it is not complete, explain that and stop. Then use catalogue_search and credential_catalogue_search to suggest up to three relevant published skills or catalogue certifications as next steps based on that plan and my_skills/my_certifications if permitted. Use exact returned catalogue names and issuers. Do not invent courses, exam URLs, deadlines or eligibility. Say what I could learn or earn next, and whether I could prepare a skill claim based on experience. Learning completion does not mean I earned a certificate or proved proficiency. Do not save, submit or approve anything.`;
}
