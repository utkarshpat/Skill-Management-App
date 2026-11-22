import type { KeyboardEvent } from 'react';

export function keepDialogFocus(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== 'Tab') return;
  const focusable = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])',
    ),
  ).filter(
    node => node.tabIndex >= 0 && !node.matches(':disabled') && node.getClientRects().length > 0,
  );
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && first && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && last && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
