// Keep phase-two routes and UI available for local feature development only when enabled.
export const phaseTwoVisible =
  typeof import.meta.env === 'object'
    ? import.meta.env.VITE_PHASE_TWO_ENABLED === 'true'
    : typeof process !== 'undefined' &&
      Boolean(process.env.NODE_TEST_CONTEXT) &&
      process.env.SKILL_GENIE_TEST_PHASE_TWO === 'true';

export function isPhaseTwoPage(pathname: string) {
  return pathname === '/learning' || pathname === '/requests';
}
