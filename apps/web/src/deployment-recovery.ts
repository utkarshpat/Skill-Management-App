const retryKey = 'skill-workspace-preload-recovery';
export function canRecoverDeployment(
  online: boolean,
  dialogOpen: boolean,
  previous: number,
  now: number,
) {
  return online && !dialogOpen && (!Number.isFinite(previous) || now - previous >= 300_000);
}

export function installDeploymentRecovery() {
  window.addEventListener('vite:preloadError', () => {
    try {
      const now = Date.now();
      const previous = Number(sessionStorage.getItem(retryKey) ?? NaN);
      if (
        !canRecoverDeployment(
          navigator.onLine,
          Boolean(document.querySelector('dialog[open]')),
          previous,
          now,
        )
      )
        return;
      sessionStorage.setItem(retryKey, String(now));
      window.location.reload();
    } catch {
      // If storage is unavailable, keep the existing explicit recovery button.
    }
  });
}
