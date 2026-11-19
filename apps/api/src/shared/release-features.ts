// Server bootstrap sets the release default. Isolated app factories can still exercise phase two.
export function phaseTwoAvailable() {
  return process.env.PHASE_TWO_ENABLED !== 'false';
}
