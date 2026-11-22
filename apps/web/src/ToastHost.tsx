import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import type { ToastKind } from './toast';
import './toast.css';
interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
  expiresAt: number;
}
const dialogs: HTMLDialogElement[] = [];
const listeners = new Set<() => void>();
export function registerToastDialog(dialog: HTMLDialogElement) {
  dialogs.push(dialog);
  listeners.forEach(update => update());
  return () => {
    const index = dialogs.lastIndexOf(dialog);
    if (index >= 0) dialogs.splice(index, 1);
    listeners.forEach(update => update());
  };
}
function subscribe(update: () => void) {
  listeners.add(update);
  return () => listeners.delete(update);
}
const activeDialog = () => dialogs.at(-1);
export function ToastHost() {
  const dialog = useSyncExternalStore(subscribe, activeDialog, () => undefined);
  const [items, setItems] = useState<Toast[]>([]),
    counter = useRef(0),
    recent = useRef(new Map<string, number>());
  useEffect(() => {
    function receive(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (
        !detail ||
        typeof detail.message !== 'string' ||
        !['success', 'error', 'info', 'warning'].includes(detail.kind)
      )
        return;
      const key = detail.kind + detail.message,
        now = Date.now();
      if (now - (recent.current.get(key) ?? 0) < 4000) return;
      recent.current.set(key, now);
      if (recent.current.size > 40) recent.current.delete(recent.current.keys().next().value!);
      setItems(old => [
        ...old.slice(-2),
        {
          id: ++counter.current,
          message: detail.message,
          kind: detail.kind,
          expiresAt: now + (detail.kind === 'error' ? 10000 : 5000),
        },
      ]);
    }
    window.addEventListener('app-toast', receive);
    return () => window.removeEventListener('app-toast', receive);
  }, []);
  useEffect(() => {
    if (!items.length) return;
    const timer = setTimeout(
      () => setItems(old => old.filter(item => item.expiresAt > Date.now())),
      Math.max(0, Math.min(...items.map(item => item.expiresAt)) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [items]);
  const stack = (
    <div className="app-toast-stack" aria-label="Application notifications">
      {items.map(item => {
        const Icon =
          item.kind === 'success'
            ? CheckCircle2
            : item.kind === 'error'
              ? AlertCircle
              : item.kind === 'warning'
                ? AlertTriangle
                : Info;
        return (
          <div
            className={'app-toast ' + item.kind}
            key={item.id}
            role={item.kind === 'error' ? 'alert' : 'status'}
          >
            <Icon size={21} />
            <span>{item.message}</span>
            <button
              aria-label="Dismiss notification"
              onClick={() => setItems(old => old.filter(i => i.id !== item.id))}
            >
              <X size={17} />
            </button>
          </div>
        );
      })}
    </div>
  );
  return dialog ? createPortal(stack, dialog) : stack;
}
