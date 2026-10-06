import { useEffect, useRef, useState, type ReactNode, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';

export interface FormPage {
  label: string;
  content: ReactNode;
}
export function FormDialog({
  title,
  onClose,
  busy = false,
  pages,
  footer,
  children,
  page: controlledPage,
  onPageChange,
  formId,
  onSubmit,
  message,
  readOnly = false,
  className = '',
  subtitle,
  stepNavigation = false,
}: {
  className?: string;
  subtitle?: ReactNode;
  stepNavigation?: boolean;
  title: string;
  onClose: () => void;
  busy?: boolean;
  pages?: FormPage[];
  footer?: ReactNode;
  children?: ReactNode;
  page?: number;
  onPageChange?: (page: number) => void;
  formId?: string;
  onSubmit?: () => void;
  message?: ReactNode;
  readOnly?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [localPage, setLocalPage] = useState(0);
  const page = controlledPage ?? localPage;
  const changePage = (next: number) => {
    setLocalPage(next);
    onPageChange?.(next);
  };
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previous = document.activeElement as HTMLElement | null,
      overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element.showModal();
    const input = Array.from(element.querySelectorAll<HTMLElement>('input,select,textarea')).find(
      field => !field.closest('[hidden]') && !field.hasAttribute('disabled'),
    );
    if (!className.includes('skill-wizard') || window.matchMedia('(min-width:801px)').matches)
      input?.focus();
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  function trapFocus(event: React.KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab') return;
    const element = dialog.current;
    if (!element) return;
    const focusable = Array.from(
      element.querySelectorAll<HTMLElement>(
        'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])',
      ),
    ).filter(
      node =>
        !node.hasAttribute('disabled') &&
        !node.closest('[hidden]') &&
        node.getClientRects().length > 0,
    );
    if (!focusable.length) return;
    const first = focusable[0],
      last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  function validate(event: FormEvent<HTMLDialogElement>) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const invalid = Array.from(form.elements).find(
      element =>
        (element instanceof HTMLInputElement ||
          element instanceof HTMLSelectElement ||
          element instanceof HTMLTextAreaElement) &&
        element.willValidate &&
        !element.validity.valid,
    ) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | undefined;
    if (!invalid) return;
    event.preventDefault();
    event.stopPropagation();
    const target = invalid.closest<HTMLElement>('[data-form-page]');
    if (target) changePage(Number(target.dataset.formPage));
    requestAnimationFrame(() => {
      invalid.focus();
      invalid.reportValidity();
    });
  }
  const content = (
    <>
      {children}
      {pages?.map((item, index) => (
        <div data-form-page={index} key={index} hidden={page !== index}>
          {item.content}
        </div>
      ))}
    </>
  );
  return createPortal(
    <dialog
      ref={dialog}
      className={'form-dialog ' + className}
      data-readonly={readOnly || undefined}
      aria-label={title}
      onKeyDown={trapFocus}
      onCancel={event => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onSubmitCapture={validate}
    >
      <header className="form-dialog-header">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="form-dialog-subtitle">{subtitle}</p>}
        </div>
        <button
          type="button"
          className="catalogue-close"
          aria-label={`Close ${title}`}
          disabled={busy}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </header>
      {message && <div className="form-dialog-message">{message}</div>}
      {pages && pages.length > 1 && (
        <nav
          className={'form-page-tabs' + (stepNavigation ? ' wizard-steps' : '')}
          aria-label="Form sections"
        >
          {pages.map((item, index) => (
            <button
              type="button"
              key={index}
              disabled={busy}
              aria-current={page === index ? 'step' : undefined}
              onClick={() => changePage(index)}
            >
              {stepNavigation && (
                <span className="wizard-step-number" aria-hidden="true">
                  {index < page ? '✓' : index + 1}
                </span>
              )}
              {item.label}
            </button>
          ))}
        </nav>
      )}
      <div className="form-dialog-body">
        {formId ? (
          <form
            id={formId}
            noValidate
            className="access-form"
            onSubmit={event => {
              event.preventDefault();
              if (!busy) onSubmit?.();
            }}
          >
            <fieldset className="form-dialog-fields" disabled={busy}>
              {content}
            </fieldset>
          </form>
        ) : (
          content
        )}
      </div>
      {footer && <footer className="form-dialog-footer">{footer}</footer>}
    </dialog>,
    document.body,
  );
}
