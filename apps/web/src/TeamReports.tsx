import { useEffect, useId, useRef, useState } from 'react';
import { BarChart3, ChevronDown, Download, FileSpreadsheet, RefreshCw } from 'lucide-react';
import { authenticatedFetch } from './auth';
import {
  fetchTeamAnalytics,
  reportLabels,
  teamReportCsv,
  type TeamReportAnalytics,
  type TeamReportKind,
} from './team-reports';
import { teamReportHtml } from './team-report-document';

type Format = 'html' | TeamReportKind;
const csvKinds: TeamReportKind[] = ['gap', 'coverage', 'summary'];

function save(content: string, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function TeamReports({
  analytics,
  query,
  onAccessChanged,
}: {
  analytics?: TeamReportAnalytics;
  query: string;
  onAccessChanged: () => void;
}) {
  const [open, setOpen] = useState(false),
    [rank, setRank] = useState(3),
    [busy, setBusy] = useState<Format | undefined>(),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const request = useRef<AbortController | undefined>(undefined),
    root = useRef<HTMLDivElement>(null),
    menuId = useId();
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    request.current?.abort();
    setBusy(undefined);
    setError('');
    setMessage('');
  }, [query, analytics]);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === 'Escape'
          : !root.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  const unavailable = !analytics || analytics.members === 0;
  async function download(format: Format) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(format);
    setError('');
    setMessage('');
    try {
      const { analytics: fresh, at } = await fetchTeamAnalytics(
        authenticatedFetch,
        query,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const day = at.toISOString().slice(0, 10);
      if (format === 'html')
        save(
          teamReportHtml(fresh, query, at),
          'text/html;charset=utf-8',
          `team-capability-report-${day}.html`,
        );
      else
        save(
          teamReportCsv(fresh, format, rank, query, at),
          'text/csv;charset=utf-8',
          `direct-reports-${format}${format === 'summary' ? '' : '-L' + rank}-${day}.csv`,
        );
      setMessage(
        format === 'html'
          ? 'Interactive report downloaded. Open it in any browser.'
          : 'CSV downloaded.',
      );
      setOpen(false);
    } catch (reason) {
      if (!controller.signal.aborted) {
        if (
          reason instanceof Error &&
          'status' in reason &&
          [401, 403, 409].includes(Number(reason.status))
        )
          onAccessChanged();
        setError(
          reason instanceof Error ? reason.message : 'Report download failed. Refresh and retry.',
        );
      }
    } finally {
      if (!controller.signal.aborted) setBusy(undefined);
    }
  }
  return (
    <div className="team-report-menu" ref={root}>
      <button
        type="button"
        className="secondary-button team-report-trigger"
        aria-expanded={open}
        aria-controls={menuId}
        disabled={unavailable}
        title={unavailable ? 'Full-team data is unavailable for reports' : undefined}
        onClick={() => setOpen(v => !v)}
      >
        {busy ? <RefreshCw size={15} className="review-spin" /> : <Download size={15} />}
        {busy ? 'Preparing…' : 'Report'}
        <ChevronDown size={14} />
      </button>
      {open && analytics && (
        <div className="team-report-popover" id={menuId} role="group" aria-label="Team reports">
          <p className="team-report-popover-scope">
            {analytics.members} active direct reports · {query ? `“${query}”` : 'all'} · every page
            included
          </p>
          <button
            type="button"
            className="team-report-option featured"
            disabled={!!busy}
            onClick={() => download('html')}
          >
            <BarChart3 size={18} />
            <span>
              <strong>Interactive report</strong>
              <small>Charts, radar, level mix, sortable gap table · .html</small>
            </span>
          </button>
          <label className="team-report-level">
            CSV minimum level
            <select value={rank} disabled={!!busy} onChange={e => setRank(Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map(n => (
                <option key={n} value={n}>
                  L{n} and above
                </option>
              ))}
            </select>
          </label>
          {csvKinds.map(kind => (
            <button
              type="button"
              key={kind}
              className="team-report-option"
              disabled={!!busy}
              onClick={() => download(kind)}
            >
              <FileSpreadsheet size={16} />
              <span>
                <strong>{reportLabels[kind]}</strong>
                <small>
                  {kind === 'summary' ? 'Totals, categories, levels' : `Per skill at L${rank}+`} ·
                  .csv
                </small>
              </span>
            </button>
          ))}
          <p className="team-report-popover-note">
            Manager-reviewed data only. A gap is missing recorded coverage, not a proven deficiency.
            No names or employee IDs.
          </p>
        </div>
      )}
      {error && (
        <p className="team-report-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="team-report-success" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
