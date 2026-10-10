export function learningPracticeUrl(planId: string, taskId: string, attemptId?: string) {
  const query = new URLSearchParams({ planId, taskId });
  if (attemptId !== undefined) query.set('id', attemptId);
  return '/api/learning/practice' + (attemptId === undefined ? '' : '/review') + '?' + query;
}
