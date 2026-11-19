const locks = new WeakMap<HTMLElement, { count: number; restore: () => void }>();

function acquire(element: HTMLElement, root = false) {
  let lock = locks.get(element);
  if (!lock) {
    const { overflow, scrollbarGutter } = element.style;
    element.style.overflow = 'hidden';
    if (root) element.style.scrollbarGutter = 'auto';
    lock = {
      count: 0,
      restore() {
        element.style.overflow = overflow;
        if (root) element.style.scrollbarGutter = scrollbarGutter;
      },
    };
    locks.set(element, lock);
  }
  lock.count++;
  const current = lock;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--current.count === 0) {
      current.restore();
      locks.delete(element);
    }
  };
}

export function lockPageScroll({ lockRoot = false } = {}) {
  const releaseBody = acquire(document.body);
  const releaseRoot = lockRoot ? acquire(document.documentElement, true) : undefined;
  return () => {
    releaseRoot?.();
    releaseBody();
  };
}
