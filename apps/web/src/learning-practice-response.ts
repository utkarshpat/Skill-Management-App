export interface PracticeResource {
  label: string;
  url: string;
}
export interface PracticeQuestion {
  prompt: string;
  options: string[];
}
export interface PracticeQuiz {
  id: string;
  title: string;
  provider: string;
  createdAt: string;
  questions: PracticeQuestion[];
}
export interface PracticeReview extends PracticeQuestion {
  answer: number;
  correctIndex: number;
  explanation: string;
}
export interface PracticeAttempt {
  id: string;
  quizId: string;
  answers: number[];
  score: number;
  total: number;
  submittedAt: string;
  review: PracticeReview[];
}
export interface PracticeState {
  session: { revision: number; notes: string; minutes: number; resources: PracticeResource[] };
  quizzes: PracticeQuiz[];
  attempts: Omit<PracticeAttempt, 'review'>[];
}
const object = (value: unknown): value is Record<string, any> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));
const text = (value: unknown, max: number, required = true): value is string =>
  typeof value === 'string' && value.length <= max && (!required || Boolean(value.trim()));
const integer = (value: unknown, min: number, max: number) =>
  Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
const id = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const timestamp = (value: unknown) =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
function question(value: unknown): boolean {
  return (
    object(value) &&
    text(value.prompt, 240) &&
    Array.isArray(value.options) &&
    value.options.length === 4 &&
    value.options.every(option => text(option, 80)) &&
    new Set(value.options).size === 4
  );
}
function attempt(value: unknown): boolean {
  return (
    object(value) &&
    id(value.id) &&
    id(value.quizId) &&
    integer(value.total, 1, 20) &&
    integer(value.score, 0, value.total) &&
    timestamp(value.submittedAt) &&
    Array.isArray(value.answers) &&
    value.answers.length === value.total &&
    value.answers.every(answer => integer(answer, 0, 3))
  );
}
function resource(value: unknown): value is PracticeResource {
  if (!object(value) || !text(value.label, 120) || !text(value.url, 1000)) return false;
  try {
    const url = new URL(value.url);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}
export function readPracticeState(value: unknown): PracticeState {
  if (
    !object(value) ||
    !object(value.session) ||
    !integer(value.session.revision, 0, Number.MAX_SAFE_INTEGER) ||
    !text(value.session.notes, 2000, false) ||
    !integer(value.session.minutes, 0, 480) ||
    !Array.isArray(value.session.resources) ||
    value.session.resources.length > 5 ||
    !value.session.resources.every(resource) ||
    !Array.isArray(value.quizzes) ||
    !Array.isArray(value.attempts) ||
    value.quizzes.some(
      quiz =>
        !object(quiz) ||
        !id(quiz.id) ||
        !text(quiz.title, 120) ||
        !text(quiz.provider, 80) ||
        !timestamp(quiz.createdAt) ||
        !Array.isArray(quiz.questions) ||
        quiz.questions.length < 1 ||
        quiz.questions.length > 20 ||
        !quiz.questions.every(question),
    ) ||
    !value.attempts.every(attempt)
  )
    throw Error('Learning session response is incomplete. Retry loading the task.');
  return value as PracticeState;
}
export function readPracticeReview(
  value: unknown,
  expectedId: string,
  expectedQuizId: string,
): PracticeAttempt {
  if (
    !object(value) ||
    !attempt(value) ||
    value.id.toLowerCase() !== expectedId.toLowerCase() ||
    value.quizId.toLowerCase() !== expectedQuizId.toLowerCase() ||
    !Array.isArray(value.review) ||
    value.review.length !== value.total ||
    value.review.some(
      (item: unknown, index: number) =>
        !question(item) ||
        !object(item) ||
        !integer(item.correctIndex, 0, 3) ||
        item.answer !== value.answers[index] ||
        !text(item.explanation, 240),
    )
  )
    throw Error('Saved practice review is incomplete or mismatched. Reload before retrying.');
  return value as PracticeAttempt;
}
