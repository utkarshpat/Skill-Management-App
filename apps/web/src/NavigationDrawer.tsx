import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export function NavigationDrawer({
  onClose,
  children,
}: {
  onClose: () => void;
  children: (close: () => void) => ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [closing, setClosing] = useState(false);
  function close() {
    if (timer.current) return;
    setClosing(true);
    timer.current = setTimeout(
      onClose,
      matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180,
    );
  }
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previous = document.activeElement as HTMLElement | null,
      overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element.showModal();
    const media = matchMedia('(max-width:650px)'),
      resized = () => {
        if (!media.matches) onClose();
      };
    media.addEventListener('change', resized);
    return () => {
      clearTimeout(timer.current);
      media.removeEventListener('change', resized);
      element.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return createPortal(
    <dialog
      id="workspace-navigation"
      ref={dialog}
      className={'navigation-drawer' + (closing ? ' closing' : '')}
      aria-label="Workspace navigation"
      onCancel={event => {
        event.preventDefault();
        close();
      }}
      onClick={event => {
        if (event.target === dialog.current) close();
      }}
    >
      <div className="navigation-drawer-panel">
        <button className="drawer-close" aria-label="Close navigation" onClick={close}>
          <X size={20} />
        </button>
        {children(close)}
      </div>
    </dialog>,
    document.body,
  );
}
