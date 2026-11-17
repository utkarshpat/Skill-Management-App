import { useEffect, useId, useRef, useState } from 'react';
import { Download, FileSpreadsheet, Upload } from 'lucide-react';
import { authenticatedFetch } from './auth';
import { readApiResponse } from './api-response';
import { FormDialog } from './FormDialog';
import './excel-bulk.css';

interface Preview {
  changed: number;
  duplicates: number;
  added?: number;
  updated?: number;
  unchanged?: number;
  preview?: string;
  examples?: { row: number; section: string; label: string }[];
}

export function ExcelBulkActions({
  kind,
  showImport = false,
  filter = '',
  onImported,
}: {
  kind: 'catalogue' | 'certifications';
  showImport?: boolean;
  filter?: string;
  onImported?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [canImport, setCanImport] = useState(false);
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<Preview>();
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const base = '/api/excel/' + kind;
  const importAvailable = showImport && canImport;
  useEffect(() => {
    if (!open || !showImport) return;
    const controller = new AbortController();
    void authenticatedFetch(base + '/access', { signal: controller.signal })
      .then(response =>
        readApiResponse<{ canImport: boolean }>(response, 'Excel access could not be checked.'),
      )
      .then(value => {
        if (!controller.signal.aborted) setCanImport(value.canImport);
      })
      .catch(reason => {
        if (!controller.signal.aborted) setError(reason.message);
      });
    return () => controller.abort();
  }, [base, open, showImport]);
  const reset = () => {
    setOpen(false);
    setCanImport(false);
    setFile(undefined);
    setPreview(undefined);
    setNotice('');
    setError('');
    setDragging(false);
  };
  function selectFiles(files: FileList | null) {
    if (busy || !files?.length) return;
    setFile(undefined);
    setPreview(undefined);
    setNotice('');
    const selected = files[0];
    const problem =
      files.length !== 1
        ? 'Select one Excel workbook at a time.'
        : !/\.xlsx$/i.test(selected.name)
          ? 'Choose an Excel workbook with the .xlsx extension.'
          : selected.size === 0 || selected.size > 2 * 1024 * 1024
            ? 'Choose a non-empty workbook up to 2 MB.'
            : '';
    setError(problem);
    if (!problem) setFile(selected);
    if (input.current) input.current.value = '';
  }
  async function run(action: 'template' | 'export' | 'preview' | 'import') {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (action === 'export' || action === 'template') {
        const response = await authenticatedFetch(
          base + '/' + action + (action === 'export' ? filter : ''),
        );
        if (!response.ok) await readApiResponse(response, 'Excel download failed.');
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement('a');
        link.href = url;
        link.download = `${kind}-${action}.xlsx`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        if (!file) return;
        if (action === 'preview') setPreview(undefined);
        const response = await authenticatedFetch(base + '/' + action, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            ...(action === 'import' && preview?.preview
              ? { 'X-Workbook-Preview': preview.preview }
              : {}),
          },
          body: file,
        });
        const result = await readApiResponse<Preview>(response, 'Workbook could not be processed.');
        if (action === 'preview') setPreview(result);
        else {
          setPreview(undefined);
          setFile(undefined);
          if (input.current) input.current.value = '';
          setNotice(`${result.changed} imported. ${result.duplicates} duplicates skipped.`);
          onImported?.();
        }
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Workbook could not be processed.');
      if (action === 'import') setPreview(undefined);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button type="button" className="secondary-button" onClick={() => setOpen(true)}>
        {showImport ? <Upload size={15} /> : <Download size={15} />}
        {showImport ? 'Bulk action' : 'Download Excel'}
      </button>
      {open && (
        <FormDialog
          title={kind === 'catalogue' ? 'Catalogue Excel' : 'Employee certifications Excel'}
          onClose={reset}
          busy={busy}
          className="excel-bulk-dialog"
        >
          <div className="excel-bulk-content">
            <div className="excel-bulk-downloads">
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => void run('export')}
              >
                <Download size={16} />
                Download current data (.xlsx)
              </button>
              {importAvailable && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void run('template')}
                >
                  <FileSpreadsheet size={16} />
                  Download blank template (.xlsx)
                </button>
              )}
            </div>
            {importAvailable && (
              <section className="excel-bulk-import" aria-label="Import Excel workbook">
                <h3>Import workbook</h3>
                <p>
                  {kind === 'catalogue'
                    ? 'Keep the ID when renaming an existing entry. Rows without an ID are matched by name and issuer where applicable.'
                    : 'Import approved history using the employee code and a unique record ID from the source system.'}
                </p>
                <div
                  className={`excel-bulk-drop${dragging ? ' is-dragging' : ''}`}
                  onDragOver={event => {
                    if (!event.dataTransfer.types.includes('Files')) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
                    if (!busy) setDragging(true);
                  }}
                  onDragLeave={event => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                      setDragging(false);
                  }}
                  onDrop={event => {
                    event.preventDefault();
                    setDragging(false);
                    selectFiles(event.dataTransfer.files);
                  }}
                >
                  <Upload size={22} aria-hidden="true" />
                  <strong>{file?.name ?? 'Drag and drop an Excel workbook'}</strong>
                  <span>.xlsx · Up to 2 MB and 1,000 import rows</span>
                  <label className="sr-only" htmlFor={inputId}>
                    Excel workbook
                  </label>
                  <input
                    ref={input}
                    id={inputId}
                    type="file"
                    hidden
                    accept=".xlsx"
                    disabled={busy}
                    onChange={event => selectFiles(event.target.files)}
                  />
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => input.current?.click()}
                  >
                    {file ? 'Replace workbook' : 'Browse files'}
                  </button>
                </div>
                {error && (
                  <p className="excel-bulk-error" role="alert">
                    {error}
                  </p>
                )}
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || !file}
                  onClick={() => void run('preview')}
                >
                  Preview import
                </button>
                {preview?.preview && (
                  <>
                    <p role="status">
                      {kind === 'catalogue'
                        ? `${preview.added ?? 0} to add · ${preview.updated ?? 0} to update · ${preview.unchanged ?? 0} unchanged`
                        : `${preview.changed} ${preview.changed === 1 ? 'row' : 'rows'} to import. ${preview.duplicates} duplicates will be skipped.`}
                    </p>
                    {Boolean(preview.examples?.length) && (
                      <details>
                        <summary>Preview rows (up to 20)</summary>
                        <ul>
                          {preview.examples?.map(row => (
                            <li key={row.section + ':' + row.row}>
                              {row.section}, row {row.row} — {row.label}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    <button
                      type="button"
                      className="admin-primary"
                      disabled={busy || !preview.changed}
                      onClick={() => void run('import')}
                    >
                      Confirm import
                    </button>
                  </>
                )}
              </section>
            )}
            {busy && <p role="status">Processing workbook…</p>}
            {notice && <p role="status">{notice}</p>}
            {!importAvailable && error && (
              <p className="excel-bulk-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </FormDialog>
      )}
    </>
  );
}
