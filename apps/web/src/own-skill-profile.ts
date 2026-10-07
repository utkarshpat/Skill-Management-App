import type { Claim } from './MySkills';
import { readApiResponse } from './api-response';

export interface OwnSkillProfile {
  claims: Claim[];
  total: number;
  page: number;
  pageSize: number;
  canClaim: boolean;
}
type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;

export function notifySkillSubmitted(id: string) {
  window.dispatchEvent(new CustomEvent('own-skill-submitted', { detail: { id } }));
  window.dispatchEvent(new Event('notifications-updated'));
}
export class LatestProfileRequest {
  private controller?: AbortController;
  start() {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    return controller;
  }
  current(controller: AbortController) {
    return this.controller === controller && !controller.signal.aborted;
  }
  abort() {
    this.controller?.abort();
  }
}
export async function fetchOwnSkillProfile(
  fetcher: Fetcher,
  signal: AbortSignal,
): Promise<OwnSkillProfile> {
  const read = async (page: number) => {
    const value = await readApiResponse<OwnSkillProfile>(
      await fetcher('/api/my-skills?page=' + page, { signal }),
      'Could not refresh your skill profile. Please retry.',
    );
    if (
      !Array.isArray(value.claims) ||
      typeof value.canClaim !== 'boolean' ||
      value.page !== page ||
      !Number.isSafeInteger(value.total) ||
      value.total < 0 ||
      !Number.isSafeInteger(value.pageSize) ||
      value.pageSize < 1 ||
      Math.ceil(value.total / value.pageSize) > 100000
    )
      throw new Error('Your skill profile returned invalid pagination. Please retry.');
    return value;
  };
  const value = await read(1),
    claims = [...value.claims];
  for (let next = 2; next <= Math.ceil(value.total / value.pageSize); next += 4) {
    signal.throwIfAborted();
    const pages = await Promise.all(
      Array.from(
        { length: Math.min(4, Math.ceil(value.total / value.pageSize) - next + 1) },
        (_, index) => read(next + index),
      ),
    );
    for (const page of pages) claims.push(...page.claims);
  }
  signal.throwIfAborted();
  return { ...value, claims: Array.from(new Map(claims.map(claim => [claim.id, claim])).values()) };
}
