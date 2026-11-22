import { useEffect, useRef, useState, type ReactNode, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { registerToastDialog } from './ToastHost';
import { keepDialogFocus } from './modal-focus';
import { notify } from './toast';
import { lockPageScroll } from './page-scroll-lock';

interface FormPage {
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
  compact = false,
}: {
  className?: string;
  subtitle?: ReactNode;
  stepNavigation?: boolean;
  compact?: boolean;
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
  const body = useRef<HTMLDivElement>(null);
  const previousPage = useRef(page);
  useEffect(() => {
    if (previousPage.current === page) return;
    previousPage.current = page;
    if (body.current) {
      body.current.scrollTop = 0;
      body.current.focus({ preventScroll: true });
    }
  }, [page]);
  const changePage = (next: number) => {
    setLocalPage(next);
    onPageChange?.(next);
  };
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previous = document.activeElement as HTMLElement | null;
    element.showModal();
    const unregisterToastDialog = registerToastDialog(element);
    const unlockScroll = lockPageScroll();
    const input = Array.from(element.querySelectorAll<HTMLElement>('input,select,textarea')).find(
      field => !field.closest('[hidden]') && !field.hasAttribute('disabled') && field.tabIndex >= 0,
    );
    if (
      (!className.includes('skill-wizard') && !className.includes('capability-composer')) ||
      window.matchMedia('(min-width:801px)').matches
    )
      input?.focus();
    return () => {
      element.close();
      unregisterToastDialog();
      unlockScroll();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
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
    notify(invalid.validationMessage || 'Check the highlighted field.', 'error');
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
      className={'form-dialog ' + className + (compact ? ' form-dialog-compact' : '')}
      data-readonly={readOnly || undefined}
      aria-label={title}
      onKeyDown={keepDialogFocus}
      onCancel={event => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onSubmitCapture={validate}
    >
      <header className="form-dialog-header">
        {!compact && (
          <div className="form-dialog-title-group">
            <h2>{title}</h2>
            {subtitle && <p className="form-dialog-subtitle">{subtitle}</p>}
          </div>
        )}
        {pages && pages.length > 1 && stepNavigation && (
          <nav className="form-page-tabs wizard-steps in-header" aria-label="Form sections">
            {pages.map((item, index) => (
              <button
                type="button"
                key={index}
                disabled={busy}
                aria-current={page === index ? 'step' : undefined}
                onClick={() => changePage(index)}
              >
                <span className="wizard-step-number" aria-hidden="true">
                  {index < page ? '✓' : index + 1}
                </span>
                {item.label}
              </button>
            ))}
          </nav>
        )}
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
      {pages && pages.length > 1 && !stepNavigation && (
        <nav className="form-page-tabs" aria-label="Form sections">
          {pages.map((item, index) => (
            <button
              type="button"
              key={index}
              disabled={busy}
              aria-current={page === index ? 'step' : undefined}
              onClick={() => changePage(index)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      )}
      <div
        ref={body}
        className="form-dialog-body"
        tabIndex={0}
        role="region"
        aria-label={`${title} content`}
      >
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
          <fieldset className="form-dialog-fields" disabled={busy}>
            {content}
          </fieldset>
        )}
      </div>
      {footer && <footer className="form-dialog-footer">{footer}</footer>}
    </dialog>,
    document.body,
  );
}
