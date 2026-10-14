import type { BusinessDashboard } from './business-model';
import { businessCoverageRows } from './business-model';

export function escapeHtml(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

export function escapeJsonForScript(json: string): string {
  return json
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

const LEVEL_NAMES = ['Foundation', 'Autonomous', 'Experienced', 'Expert'];
const LEVEL_COLORS = ['#61bdb5', '#098b8c', '#357ac2', '#123c44'];
const CATEGORY_COLORS = [
  '#008595',
  '#357ac2',
  '#b87b11',
  '#7b5ea7',
  '#3f8a4f',
  '#c4573a',
  '#5d6b78',
  '#a0466b',
];

export function businessReportHtml(
  data: BusinessDashboard,
  scopeLabel: string,
  generatedAt: Date = new Date(),
): string {
  const atIso = generatedAt.toISOString();
  const atDisplay = generatedAt.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  });
  const totalEmployees = data.summary.employees || 0;
  const certified = data.summary.certified || 0;
  const skilled = data.summary.skilled || 0;
  const pending = data.summary.pending || 0;
  const expired = data.summary.expired || 0;
  const expiring = data.summary.expiring || 0;

  const certifiedPct = totalEmployees ? Math.round((certified * 100) / totalEmployees) : 0;
  const skilledPct = totalEmployees ? Math.round((skilled * 100) / totalEmployees) : 0;

  // Level Distribution
  const distCounts = [1, 2, 3, 4].map(rank => {
    const item = data.distribution?.find(
      d =>
        d.label === `L${rank}` ||
        d.label === `Level ${rank}` ||
        d.label.toLowerCase() === LEVEL_NAMES[rank - 1]?.toLowerCase(),
    );
    return item ? item.value : 0;
  });
  const maxDist = Math.max(1, ...distCounts);

  // Expiry Timeline
  const expiryItems = data.expiry || [];
  const maxExpiry = Math.max(1, ...expiryItems.map(i => i.value));

  // Activity 6-month
  const activityMonths = (data.activity || []).slice(-6);
  const maxActivity = Math.max(
    1,
    ...activityMonths.flatMap(m => [m.submissions || 0, m.decisions || 0]),
  );

  // Categories
  const categories = data.categories || [];
  const totalCatRecords = categories.reduce((s, c) => s + c.value, 0);

  // Comparisons (Departments/Delivery Units)
  const comparisons = data.comparisons || [];

  // Skill Coverage Rows Computation
  const rawCoverage = businessCoverageRows(data.coverage);
  const skillList = rawCoverage.map(({ id, label, cells }) => {
    const l1 = cells.get(1)?.holders ?? 0;
    const l2 = cells.get(2)?.holders ?? 0;
    const l3 = cells.get(3)?.holders ?? 0;
    const l4 = cells.get(4)?.holders ?? 0;
    const totalHolders = l1 + l2 + l3 + l4;
    const weightedSum = l1 * 1 + l2 * 2 + l3 * 3 + l4 * 4;
    const average = totalHolders > 0 ? Number((weightedSum / totalHolders).toFixed(1)) : 0;
    const maxRank = l4 > 0 ? 4 : l3 > 0 ? 3 : l2 > 0 ? 2 : l1 > 0 ? 1 : 0;
    const covPct =
      totalEmployees > 0 ? Math.min(100, Math.round((totalHolders / totalEmployees) * 100)) : 0;
    return {
      id,
      name: label,
      l1,
      l2,
      l3,
      l4,
      totalHolders,
      average,
      maxRank,
      covPct,
    };
  });

  // Top skills for the initial radar view (top 6-8 by total holders)
  const radarSkills = [...skillList]
    .filter(s => s.totalHolders > 0)
    .sort((a, b) => b.totalHolders - a.totalHolders)
    .slice(0, 8);

  // Embedded JSON payload for client-side complex filtering, sorting, CSV export, and dynamic charts
  const clientPayload = escapeJsonForScript(
    JSON.stringify({
      totalEmployees,
      skills: skillList,
      categories: categories.map(c => ({ name: c.label, count: c.value })),
      comparisons,
    }),
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:;">
<title>Workforce Capability &amp; Executive Intelligence Report · ${escapeHtml(scopeLabel)}</title>
<style>
  :root {
    --bg: #f8fafc;
    --surface: #ffffff;
    --surface-elevated: #ffffff;
    --ink: #0f172a;
    --muted: #64748b;
    --line: #e2e8f0;
    --line-subtle: #f1f5f9;
    --primary: #008595;
    --primary-dark: #006674;
    --primary-light: #e6f6f8;
    --teal: #098b8c;
    --blue: #2563eb;
    --amber: #d97706;
    --amber-bg: #fffbeb;
    --rose: #e11d48;
    --rose-bg: #fff1f2;
    --green: #16a34a;
    --green-bg: #f0fdf4;
    --shadow-sm: 0 1px 3px rgba(15,23,42,0.06);
    --shadow-md: 0 4px 12px rgba(15,23,42,0.08);
    --radius-sm: 8px;
    --radius-md: 12px;
    --radius-lg: 16px;
    --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }

  [data-theme="dark"] {
    --bg: #0b1120;
    --surface: #131c2e;
    --surface-elevated: #1e293b;
    --ink: #f1f5f9;
    --muted: #94a3b8;
    --line: #223147;
    --line-subtle: #192438;
    --primary: #22d3ee;
    --primary-dark: #06b6d4;
    --primary-light: rgba(34,211,238,0.12);
    --amber-bg: rgba(217,119,6,0.12);
    --rose-bg: rgba(225,29,72,0.12);
    --green-bg: rgba(22,163,74,0.12);
    --shadow-sm: 0 1px 3px rgba(0,0,0,0.3);
    --shadow-md: 0 4px 14px rgba(0,0,0,0.4);
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--font);
    background: var(--bg);
    color: var(--ink);
    line-height: 1.5;
    padding: 32px 24px 64px;
    transition: background 0.2s ease, color 0.2s ease;
  }
  .container { max-width: 1280px; margin: 0 auto; }

  /* Header */
  .report-header {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    padding: 28px 32px;
    margin-bottom: 24px;
    box-shadow: var(--shadow-sm);
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 20px;
  }
  .report-branding { display: flex; align-items: center; gap: 14px; margin-bottom: 8px; }
  .report-badge {
    display: inline-flex;
    align-items: center;
    background: var(--primary-light);
    color: var(--primary-dark);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    padding: 4px 10px;
    border-radius: 9999px;
  }
  .report-title { font-size: 26px; font-weight: 800; color: var(--ink); letter-spacing: -0.5px; margin-bottom: 6px; }
  .report-scope { font-size: 15px; color: var(--muted); font-weight: 500; }
  .report-meta-tags { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
  .meta-chip {
    font-size: 12px;
    color: var(--muted);
    background: var(--line-subtle);
    padding: 4px 10px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--line);
  }

  .header-actions { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: var(--surface);
    border: 1px solid var(--line);
    color: var(--ink);
    padding: 9px 16px;
    border-radius: var(--radius-sm);
    font-size: 13.5px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: var(--shadow-sm);
    transition: all 0.15s ease;
  }
  .btn:hover { background: var(--line-subtle); border-color: var(--muted); }
  .btn-primary { background: var(--primary); color: #ffffff; border-color: var(--primary); }
  .btn-primary:hover { background: var(--primary-dark); }

  /* KPI Grid */
  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 16px;
    margin-bottom: 24px;
  }
  .kpi-card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    padding: 20px;
    box-shadow: var(--shadow-sm);
    position: relative;
    overflow: hidden;
  }
  .kpi-card::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 4px;
    background: var(--card-accent, var(--primary));
  }
  .kpi-card.blue { --card-accent: #2563eb; }
  .kpi-card.teal { --card-accent: #098b8c; }
  .kpi-card.green { --card-accent: #16a34a; }
  .kpi-card.amber { --card-accent: #d97706; }
  .kpi-card.rose { --card-accent: #e11d48; }

  .kpi-label { font-size: 13px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
  .kpi-value { font-size: 32px; font-weight: 800; color: var(--ink); line-height: 1.1; margin-bottom: 6px; }
  .kpi-subtext { font-size: 12.5px; color: var(--muted); font-weight: 500; }

  /* Visual Analytics Section */
  .charts-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 20px;
    margin-bottom: 24px;
  }
  @media (max-width: 960px) { .charts-grid { grid-template-columns: 1fr; } }

  .chart-card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    padding: 24px;
    box-shadow: var(--shadow-sm);
    display: flex;
    flex-direction: column;
  }
  .chart-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 18px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--line-subtle);
    flex-wrap: wrap;
    gap: 8px;
  }
  .chart-header h3 { font-size: 16px; font-weight: 700; color: var(--ink); }
  .chart-header span { font-size: 12px; color: var(--muted); }

  /* Radar / Spider Chart */
  .radar-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    position: relative;
    padding: 10px 0;
  }
  .radar-svg {
    max-width: 360px;
    width: 100%;
    height: auto;
    overflow: visible;
  }
  .radar-ring {
    stroke: var(--line);
    stroke-width: 1;
    fill: none;
  }
  .radar-axis-line {
    stroke: var(--line);
    stroke-dasharray: 2, 2;
    stroke-width: 1;
  }
  .radar-area {
    fill: rgba(0, 133, 149, 0.22);
    stroke: var(--primary);
    stroke-width: 2.5;
    transition: all 0.3s ease;
  }
  .radar-point {
    fill: var(--primary);
    stroke: var(--surface);
    stroke-width: 2;
    cursor: pointer;
    transition: r 0.2s ease, fill 0.2s ease;
  }
  .radar-point:hover {
    r: 6;
    fill: var(--amber);
  }
  .radar-label {
    font-size: 11px;
    font-weight: 600;
    fill: var(--ink);
    dominant-baseline: middle;
  }
  .radar-tick {
    font-size: 10px;
    font-weight: 700;
    fill: var(--muted);
  }

  /* Bar Charts */
  .bar-chart-wrap { display: flex; flex-direction: column; gap: 12px; flex: 1; justify-content: center; }
  .bar-row { display: flex; align-items: center; gap: 12px; font-size: 13px; }
  .bar-label { width: 120px; font-weight: 600; color: var(--ink); flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar-track {
    flex: 1;
    height: 24px;
    background: var(--line-subtle);
    border-radius: 6px;
    overflow: hidden;
    position: relative;
    display: flex;
  }
  .bar-fill {
    height: 100%;
    border-radius: 6px;
    transition: width 0.6s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .bar-value { width: 70px; text-align: right; font-weight: 700; color: var(--ink); }

  /* Activity Stack */
  .activity-grid {
    display: flex;
    align-items: flex-end;
    gap: 16px;
    height: 180px;
    padding-top: 20px;
    border-bottom: 2px solid var(--line);
  }
  .activity-col { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end; }
  .activity-bars { display: flex; gap: 4px; align-items: flex-end; width: 100%; max-width: 44px; height: 140px; }
  .act-bar { flex: 1; border-radius: 4px 4px 0 0; min-height: 4px; }
  .act-sub { background: #357ac2; }
  .act-dec { background: #008595; }
  .act-label { font-size: 11.5px; font-weight: 600; color: var(--muted); margin-top: 8px; }

  /* Legend */
  .chart-legend { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 14px; font-size: 12px; color: var(--muted); }
  .chart-legend span { display: inline-flex; align-items: center; gap: 6px; font-weight: 500; }
  .legend-dot { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }

  /* Complex Filters Section */
  .filter-hub {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    padding: 24px;
    margin-bottom: 24px;
    box-shadow: var(--shadow-sm);
  }
  .filter-hub-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
    flex-wrap: wrap;
    gap: 12px;
  }
  .filter-hub-title { font-size: 17px; font-weight: 800; color: var(--ink); }
  .filter-hub-desc { font-size: 13px; color: var(--muted); }

  .filter-inputs-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 14px;
    margin-bottom: 16px;
  }
  .filter-field { display: flex; flex-direction: column; gap: 6px; }
  .filter-field label { font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }
  .filter-input, .filter-select {
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink);
    padding: 9px 12px;
    border-radius: var(--radius-sm);
    font-size: 13.5px;
    outline: none;
    transition: border-color 0.15s ease;
  }
  .filter-input:focus, .filter-select:focus { border-color: var(--primary); }

  /* Quick Presets */
  .preset-bar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    padding-top: 12px;
    border-top: 1px solid var(--line-subtle);
  }
  .preset-label { font-size: 12px; font-weight: 700; color: var(--muted); margin-right: 6px; }
  .preset-btn {
    background: var(--line-subtle);
    border: 1px solid var(--line);
    color: var(--ink);
    padding: 5px 12px;
    border-radius: 9999px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .preset-btn:hover { background: var(--primary-light); color: var(--primary-dark); border-color: var(--primary); }
  .preset-btn.active { background: var(--primary); color: #fff; border-color: var(--primary); }

  /* Active Filter Badges */
  .active-filter-tags {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
  }
  .filter-tag {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--primary-light);
    color: var(--primary-dark);
    font-size: 12px;
    font-weight: 600;
    padding: 3px 10px;
    border-radius: 6px;
  }
  .filter-tag-close {
    cursor: pointer;
    font-weight: 800;
    font-size: 13px;
    margin-left: 2px;
  }
  .filter-tag-close:hover { color: var(--rose); }

  /* Table Section */
  .table-section {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    padding: 24px;
    box-shadow: var(--shadow-sm);
  }
  .table-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 14px;
    margin-bottom: 20px;
  }
  .table-title-group h3 { font-size: 18px; font-weight: 800; color: var(--ink); }
  .table-title-group p { font-size: 13px; color: var(--muted); }
  .table-stats-badge {
    background: var(--line-subtle);
    border: 1px solid var(--line);
    padding: 6px 14px;
    border-radius: var(--radius-sm);
    font-size: 13px;
    font-weight: 600;
    color: var(--ink);
  }

  .data-table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: var(--radius-sm); }
  .data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13.5px;
    text-align: left;
  }
  .data-table th {
    background: var(--line-subtle);
    padding: 12px 16px;
    font-weight: 700;
    color: var(--muted);
    border-bottom: 1px solid var(--line);
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
  }
  .data-table th:hover { color: var(--ink); }
  .data-table td {
    padding: 12px 16px;
    border-bottom: 1px solid var(--line);
    color: var(--ink);
  }
  .data-table tr:last-child td { border-bottom: 0; }
  .data-table tr:hover td { background: var(--line-subtle); }

  /* Level Mix Segmented Track */
  .mix-track {
    display: flex;
    height: 12px;
    border-radius: 6px;
    overflow: hidden;
    background: var(--line-subtle);
    min-width: 110px;
    max-width: 160px;
    border: 1px solid var(--line);
  }
  .mix-track i { display: block; height: 100%; }

  .rank-badge {
    display: inline-block;
    padding: 3px 8px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 700;
  }
  .rank-1 { background: #e0f2fe; color: #0369a1; }
  .rank-2 { background: #e0f7fa; color: #00695c; }
  .rank-3 { background: #fef3c7; color: #b45309; }
  .rank-4 { background: #ede9fe; color: #6d28d9; }

  /* Footer */
  .report-footer {
    margin-top: 36px;
    text-align: center;
    font-size: 12.5px;
    color: var(--muted);
    border-top: 1px solid var(--line);
    padding-top: 20px;
  }

  @media print {
    body { background: #ffffff; color: #000000; padding: 0; }
    .header-actions, .filter-hub, .report-footer button, .table-toolbar button { display: none !important; }
    .report-header, .kpi-card, .chart-card, .table-section {
      border: 1px solid #d1d5db !important;
      box-shadow: none !important;
      break-inside: avoid;
    }
    .data-table th, .data-table td { padding: 8px 10px !important; font-size: 11px !important; }
    .kpi-value { font-size: 24px !important; }
    .charts-grid { grid-template-columns: 1fr 1fr !important; page-break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="container">

  <!-- Header -->
  <header class="report-header">
    <div>
      <div class="report-branding">
        <span class="report-badge">Executive Analytics</span>
        <span class="report-scope">${escapeHtml(scopeLabel)}</span>
      </div>
      <h1 class="report-title">Workforce Capability &amp; Intelligence Report</h1>
      <p class="report-scope">Enterprise-wide capability baseline, certification governance, and workforce skill distribution</p>
      <div class="report-meta-tags">
        <span class="meta-chip">📅 Generated: ${escapeHtml(atDisplay)} UTC</span>
        <span class="meta-chip">🔒 As-Of Snapshot: ${escapeHtml(data.context.asOf || atIso.slice(0, 10))}</span>
        <span class="meta-chip">🏷️ Revision: ${escapeHtml(data.context.revision || 1)}</span>
        <span class="meta-chip">👥 Scope: ${escapeHtml(scopeLabel)}</span>
      </div>
    </div>
    <div class="header-actions">
      <button class="btn" onclick="toggleTheme()" id="themeBtn">🌓 Theme</button>
      <button class="btn btn-primary" onclick="window.print()">🖨️ Print / Save PDF</button>
    </div>
  </header>

  <!-- KPI Strip -->
  <section class="kpi-grid">
    <div class="kpi-card blue">
      <div class="kpi-label">Total Population</div>
      <div class="kpi-value">${totalEmployees.toLocaleString()}</div>
      <div class="kpi-subtext">Active authorized personnel</div>
    </div>
    <div class="kpi-card teal">
      <div class="kpi-label">Certified Personnel</div>
      <div class="kpi-value">${certified.toLocaleString()}</div>
      <div class="kpi-subtext">${certifiedPct}% of total workforce certified</div>
    </div>
    <div class="kpi-card green">
      <div class="kpi-label">Verified Skilled</div>
      <div class="kpi-value">${skilled.toLocaleString()}</div>
      <div class="kpi-subtext">${skilledPct}% with manager-reviewed skills</div>
    </div>
    <div class="kpi-card amber">
      <div class="kpi-label">Pending Reviews</div>
      <div class="kpi-value">${pending.toLocaleString()}</div>
      <div class="kpi-subtext">Awaiting manager verification</div>
    </div>
    <div class="kpi-card rose">
      <div class="kpi-label">Expired Credentials</div>
      <div class="kpi-value">${expired.toLocaleString()}</div>
      <div class="kpi-subtext">Requires renewal submission</div>
    </div>
    <div class="kpi-card amber">
      <div class="kpi-label">Expiring (30 Days)</div>
      <div class="kpi-value">${expiring.toLocaleString()}</div>
      <div class="kpi-subtext">Immediate renewal window</div>
    </div>
  </section>

  <!-- Charts Grid -->
  <section class="charts-grid">

    <!-- 1. Enterprise Skill Spider / Radar Chart -->
    <div class="chart-card">
      <div class="chart-header">
        <h3>Capability Spider / Radar Web</h3>
        <div style="display:flex;align-items:center;gap:6px;">
          <select id="radarMetricSelect" class="filter-select" style="padding:4px 8px;font-size:12px;" onchange="updateRadarView()">
            <option value="topSkills">Top Skills Proficiency (Avg L1–L4)</option>
            <option value="domains">Domain Specialization Benchmarks</option>
          </select>
        </div>
      </div>
      <div class="radar-container" id="radarMount">
        ${renderRadarSvg(radarSkills, categories, totalEmployees)}
      </div>
      <div class="chart-legend" id="radarLegend">
        <span><i class="legend-dot" style="background:var(--primary)"></i> Average Level / 4-Level Framework</span>
        <span><i class="legend-dot" style="background:#61bdb5"></i> L1: Foundation</span>
        <span><i class="legend-dot" style="background:#098b8c"></i> L2: Autonomous</span>
        <span><i class="legend-dot" style="background:#357ac2"></i> L3: Experienced</span>
        <span><i class="legend-dot" style="background:#123c44"></i> L4: Expert</span>
      </div>
    </div>

    <!-- 2. Proficiency Level Distribution -->
    <div class="chart-card">
      <div class="chart-header">
        <h3>Proficiency Level Distribution</h3>
        <span>4-Level Framework Total Counts</span>
      </div>
      <div class="bar-chart-wrap">
        ${[1, 2, 3, 4]
          .map((rank, i) => {
            const count = distCounts[i] || 0;
            const pct = maxDist ? Math.round((count * 100) / maxDist) : 0;
            return `
          <div class="bar-row">
            <span class="bar-label">L${rank} ${escapeHtml(LEVEL_NAMES[i])}</span>
            <div class="bar-track">
              <div class="bar-fill" style="width: ${pct}%; background: ${LEVEL_COLORS[i]};"></div>
            </div>
            <span class="bar-value">${count.toLocaleString()}</span>
          </div>`;
          })
          .join('')}
      </div>
      <div class="chart-legend">
        ${[1, 2, 3, 4]
          .map(
            (r, i) =>
              `<span><i class="legend-dot" style="background:${LEVEL_COLORS[i]}"></i> L${r}: ${escapeHtml(LEVEL_NAMES[i])}</span>`,
          )
          .join('')}
      </div>
    </div>

    <!-- 3. Certification Expiry Risk Timeline -->
    <div class="chart-card">
      <div class="chart-header">
        <h3>Credential Renewal &amp; Expiry Risk</h3>
        <span>Upcoming Horizons</span>
      </div>
      <div class="bar-chart-wrap">
        ${
          expiryItems.length
            ? expiryItems
                .map((item, i) => {
                  const pct = maxExpiry ? Math.round((item.value * 100) / maxExpiry) : 0;
                  const color =
                    i === 0 ? '#e11d48' : i === 1 ? '#d97706' : i === 2 ? '#357ac2' : '#008595';
                  return `
            <div class="bar-row">
              <span class="bar-label">${escapeHtml(item.label)}</span>
              <div class="bar-track">
                <div class="bar-fill" style="width: ${pct}%; background: ${color};"></div>
              </div>
              <span class="bar-value">${item.value.toLocaleString()}</span>
            </div>`;
                })
                .join('')
            : '<p class="report-scope">No credential expiry risk records found in current scope.</p>'
        }
      </div>
      <div class="chart-legend">
        <span><i class="legend-dot" style="background:#e11d48"></i> 15d Critical</span>
        <span><i class="legend-dot" style="background:#d97706"></i> 30d Warning</span>
        <span><i class="legend-dot" style="background:#357ac2"></i> 60d Notice</span>
        <span><i class="legend-dot" style="background:#008595"></i> 90d Horizon</span>
      </div>
    </div>

    <!-- 4. 6-Month Review & Submission Activity -->
    <div class="chart-card">
      <div class="chart-header">
        <h3>6-Month Governance Activity</h3>
        <span>Submissions vs Verified Decisions</span>
      </div>
      <div class="activity-grid">
        ${
          activityMonths.length
            ? activityMonths
                .map(m => {
                  const subH = maxActivity
                    ? Math.round(((m.submissions || 0) * 100) / maxActivity)
                    : 0;
                  const decH = maxActivity
                    ? Math.round(((m.decisions || 0) * 100) / maxActivity)
                    : 0;
                  return `
            <div class="activity-col">
              <div class="activity-bars">
                <div class="act-bar act-sub" style="height:${Math.max(4, subH)}%;" title="Submissions: ${m.submissions}"></div>
                <div class="act-bar act-dec" style="height:${Math.max(4, decH)}%;" title="Decisions: ${m.decisions}"></div>
              </div>
              <span class="act-label">${escapeHtml(m.label)}</span>
            </div>`;
                })
                .join('')
            : '<p class="report-scope">No historical activity recorded in this window.</p>'
        }
      </div>
      <div class="chart-legend">
        <span><i class="legend-dot" style="background:#357ac2"></i> Submissions</span>
        <span><i class="legend-dot" style="background:#008595"></i> Verified Decisions</span>
      </div>
    </div>

  </section>

  <!-- COMPLEX FILTERS HUB -->
  <section class="filter-hub">
    <div class="filter-hub-header">
      <div>
        <h2 class="filter-hub-title">Multi-Dimensional Capability Filters</h2>
        <p class="filter-hub-desc">Filter by proficiency threshold, domain specialization, coverage health, or search keywords</p>
      </div>
      <div style="display:flex;gap:10px;">
        <button class="btn" onclick="resetAllFilters()">↺ Reset Filters</button>
        <button class="btn btn-primary" onclick="exportFilteredCsv()">📥 Download Filtered CSV</button>
      </div>
    </div>

    <div class="filter-inputs-grid">
      <div class="filter-field">
        <label for="hubSearch">Keyword Search</label>
        <input
          type="search"
          id="hubSearch"
          class="filter-input"
          placeholder="Search by skill name…"
          oninput="applyComplexFilters()"
        />
      </div>

      <div class="filter-field">
        <label for="hubCategory">Domain / Category</label>
        <select id="hubCategory" class="filter-select" onchange="applyComplexFilters()">
          <option value="all">All Domains &amp; Categories</option>
          ${categories.map(c => `<option value="${escapeHtml(c.label)}">${escapeHtml(c.label)} (${c.value})</option>`).join('')}
        </select>
      </div>

      <div class="filter-field">
        <label for="hubLevel">Minimum Proficiency</label>
        <select id="hubLevel" class="filter-select" onchange="applyComplexFilters()">
          <option value="all">All Levels (L1–L4)</option>
          <option value="1">L1 Foundation &amp; above</option>
          <option value="2">L2 Autonomous &amp; above</option>
          <option value="3">L3 Experienced &amp; above</option>
          <option value="4">L4 Expert only</option>
        </select>
      </div>

      <div class="filter-field">
        <label for="hubCoverage">Coverage Health</label>
        <select id="hubCoverage" class="filter-select" onchange="applyComplexFilters()">
          <option value="all">All Coverage Ranges</option>
          <option value="high">High Coverage (&gt; 40%)</option>
          <option value="medium">Medium Coverage (15% – 40%)</option>
          <option value="low">Low Coverage (5% – 15%)</option>
          <option value="gap">Critical Gaps (&lt; 5%)</option>
        </select>
      </div>

      <div class="filter-field">
        <label for="hubSort">Sort Records By</label>
        <select id="hubSort" class="filter-select" onchange="applyComplexFilters()">
          <option value="holders_desc">Verified Holders (Highest first)</option>
          <option value="holders_asc">Verified Holders (Lowest first)</option>
          <option value="name_asc">Skill Name (A to Z)</option>
          <option value="name_desc">Skill Name (Z to A)</option>
          <option value="level_desc">Proficiency Level (L4 to L1)</option>
          <option value="coverage_desc">Coverage % (Highest first)</option>
        </select>
      </div>
    </div>

    <!-- Quick Presets -->
    <div class="preset-bar">
      <span class="preset-label">Quick Presets:</span>
      <button class="preset-btn active" id="preset-all" onclick="setPreset('all')">All Skills</button>
      <button class="preset-btn" id="preset-gaps" onclick="setPreset('gaps')">🚨 Critical Gaps (&lt;5%)</button>
      <button class="preset-btn" id="preset-experts" onclick="setPreset('experts')">⭐ Expert Leadership (L4)</button>
      <button class="preset-btn" id="preset-high" onclick="setPreset('high')">🏆 High Adoption (&gt;30%)</button>
      <button class="preset-btn" id="preset-autonomous" onclick="setPreset('autonomous')">🎯 Autonomous Standard (L2+)</button>
    </div>

    <!-- Active Filter Tags -->
    <div class="active-filter-tags" id="activeFilterTags"></div>
  </section>

  <!-- Interactive Skill Coverage Table -->
  <section class="table-section">
    <div class="table-toolbar">
      <div class="table-title-group">
        <h3>Verified Skill Inventory &amp; 4-Level Distribution Matrix</h3>
        <p>Canonical catalogue definitions, holder counts by rank, and workforce coverage metrics</p>
      </div>
      <div class="table-stats-badge" id="tableStats">
        Showing ${skillList.length} of ${skillList.length} skills
      </div>
    </div>

    <div class="data-table-wrap">
      <table class="data-table" id="skillsTable">
        <thead>
          <tr>
            <th onclick="toggleSort('name')">Skill Name ⬍</th>
            <th onclick="toggleSort('level')">Highest Verified Level ⬍</th>
            <th>4-Level Mix Breakdown (L1 | L2 | L3 | L4)</th>
            <th onclick="toggleSort('average')">Average Level ⬍</th>
            <th onclick="toggleSort('holders')">Total Holders ⬍</th>
            <th onclick="toggleSort('coverage')">Workforce Coverage % ⬍</th>
          </tr>
        </thead>
        <tbody id="skillsTableBody">
          ${renderTableRows(skillList, totalEmployees)}
        </tbody>
      </table>
    </div>
  </section>

  <!-- Footer -->
  <footer class="report-footer">
    <p>Cognitive Intelligence Lab · Workforce Capability &amp; Access Governance Platform</p>
    <p style="margin-top:4px;">Confidential · Self-Contained Offline Export · Generated strictly from execution-time authorized database aggregates</p>
  </footer>

</div>

<!-- DATA STORE & CLIENT SCRIPTS -->
<script>
  const REPORT_DATA = ${clientPayload};
  let currentPreset = 'all';

  function toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
    document.getElementById('themeBtn').innerText = isDark ? '🌓 Dark' : '☀️ Light';
  }

  function setPreset(kind) {
    currentPreset = kind;
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById('preset-' + kind);
    if (btn) btn.classList.add('active');

    if (kind === 'all') {
      document.getElementById('hubSearch').value = '';
      document.getElementById('hubCategory').value = 'all';
      document.getElementById('hubLevel').value = 'all';
      document.getElementById('hubCoverage').value = 'all';
    } else if (kind === 'gaps') {
      document.getElementById('hubCoverage').value = 'gap';
      document.getElementById('hubLevel').value = 'all';
    } else if (kind === 'experts') {
      document.getElementById('hubLevel').value = '4';
      document.getElementById('hubCoverage').value = 'all';
    } else if (kind === 'high') {
      document.getElementById('hubCoverage').value = 'high';
      document.getElementById('hubLevel').value = 'all';
    } else if (kind === 'autonomous') {
      document.getElementById('hubLevel').value = '2';
      document.getElementById('hubCoverage').value = 'all';
    }
    applyComplexFilters();
  }

  function resetAllFilters() {
    document.getElementById('hubSearch').value = '';
    document.getElementById('hubCategory').value = 'all';
    document.getElementById('hubLevel').value = 'all';
    document.getElementById('hubCoverage').value = 'all';
    document.getElementById('hubSort').value = 'holders_desc';
    setPreset('all');
  }

  function toggleSort(field) {
    const sortSelect = document.getElementById('hubSort');
    if (field === 'name') {
      sortSelect.value = sortSelect.value === 'name_asc' ? 'name_desc' : 'name_asc';
    } else if (field === 'holders') {
      sortSelect.value = sortSelect.value === 'holders_desc' ? 'holders_asc' : 'holders_desc';
    } else if (field === 'level') {
      sortSelect.value = 'level_desc';
    } else if (field === 'average') {
      sortSelect.value = 'level_desc';
    } else if (field === 'coverage') {
      sortSelect.value = 'coverage_desc';
    }
    applyComplexFilters();
  }

  function applyComplexFilters() {
    const query = (document.getElementById('hubSearch').value || '').trim().toLowerCase();
    const cat = document.getElementById('hubCategory').value;
    const minLevel = document.getElementById('hubLevel').value;
    const cov = document.getElementById('hubCoverage').value;
    const sortMode = document.getElementById('hubSort').value;

    let filtered = REPORT_DATA.skills.filter(s => {
      // 1. Text Search
      if (query && !s.name.toLowerCase().includes(query)) return false;

      // 2. Minimum Proficiency Level
      if (minLevel !== 'all') {
        const lvl = parseInt(minLevel, 10);
        if (s.maxRank < lvl) return false;
      }

      // 3. Coverage Range
      if (cov !== 'all') {
        if (cov === 'gap' && s.covPct >= 5) return false;
        if (cov === 'low' && (s.covPct < 5 || s.covPct >= 15)) return false;
        if (cov === 'medium' && (s.covPct < 15 || s.covPct >= 40)) return false;
        if (cov === 'high' && s.covPct < 40) return false;
      }

      return true;
    });

    // Sort
    filtered.sort((a, b) => {
      if (sortMode === 'holders_desc') return b.totalHolders - a.totalHolders;
      if (sortMode === 'holders_asc') return a.totalHolders - b.totalHolders;
      if (sortMode === 'name_asc') return a.name.localeCompare(b.name);
      if (sortMode === 'name_desc') return b.name.localeCompare(a.name);
      if (sortMode === 'level_desc') return b.maxRank - a.maxRank || b.average - a.average;
      if (sortMode === 'coverage_desc') return b.covPct - a.covPct;
      return 0;
    });

    // Render Table
    renderTable(filtered);

    // Update Stats Badge
    const totalSkills = REPORT_DATA.skills.length;
    document.getElementById('tableStats').innerText =
      \`Showing \${filtered.length} of \${totalSkills} skills\`;

    // Update Active Filter Badges
    renderFilterBadges(query, cat, minLevel, cov);
  }

  function renderFilterBadges(query, cat, minLevel, cov) {
    const container = document.getElementById('activeFilterTags');
    const tags = [];
    if (query) {
      tags.push(\`<span class="filter-tag">Search: "\${escapeText(query)}" <span class="filter-tag-close" onclick="clearFilter('query')">✕</span></span>\`);
    }
    if (cat !== 'all') {
      tags.push(\`<span class="filter-tag">Category: \${escapeText(cat)} <span class="filter-tag-close" onclick="clearFilter('cat')">✕</span></span>\`);
    }
    if (minLevel !== 'all') {
      tags.push(\`<span class="filter-tag">Min Level: L\${minLevel}+ <span class="filter-tag-close" onclick="clearFilter('level')">✕</span></span>\`);
    }
    if (cov !== 'all') {
      tags.push(\`<span class="filter-tag">Coverage: \${escapeText(cov.toUpperCase())} <span class="filter-tag-close" onclick="clearFilter('cov')">✕</span></span>\`);
    }
    container.innerHTML = tags.join('');
  }

  function clearFilter(key) {
    if (key === 'query') document.getElementById('hubSearch').value = '';
    if (key === 'cat') document.getElementById('hubCategory').value = 'all';
    if (key === 'level') document.getElementById('hubLevel').value = 'all';
    if (key === 'cov') document.getElementById('hubCoverage').value = 'all';
    applyComplexFilters();
  }

  function renderTable(skills) {
    const tbody = document.getElementById('skillsTableBody');
    if (!skills.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--muted)">No skills match the selected filter combination. Click "Reset Filters" to restore all records.</td></tr>';
      return;
    }

    const LEVEL_NAMES = ['Foundation', 'Autonomous', 'Experienced', 'Expert'];
    tbody.innerHTML = skills.map(s => {
      const sum = s.totalHolders || 1;
      const p1 = Math.round((s.l1 * 100) / sum);
      const p2 = Math.round((s.l2 * 100) / sum);
      const p3 = Math.round((s.l3 * 100) / sum);
      const p4 = Math.round((s.l4 * 100) / sum);
      return \`
        <tr>
          <td><strong>\${escapeText(s.name)}</strong></td>
          <td>
            <span class="rank-badge rank-\${s.maxRank || 1}">
              L\${s.maxRank} · \${escapeText(LEVEL_NAMES[(s.maxRank || 1) - 1])}
            </span>
          </td>
          <td>
            <div style="display:flex;align-items:center;gap:10px;">
              <div class="mix-track" title="L1: \${s.l1} | L2: \${s.l2} | L3: \${s.l3} | L4: \${s.l4}">
                <i style="flex:\${s.l1};background:#61bdb5"></i>
                <i style="flex:\${s.l2};background:#098b8c"></i>
                <i style="flex:\${s.l3};background:#357ac2"></i>
                <i style="flex:\${s.l4};background:#123c44"></i>
              </div>
              <small style="font-size:11px;color:var(--muted);white-space:nowrap;">
                L1:\${s.l1} L2:\${s.l2} L3:\${s.l3} L4:\${s.l4}
              </small>
            </div>
          </td>
          <td><strong>L\${s.average}</strong></td>
          <td><strong>\${s.totalHolders.toLocaleString()}</strong></td>
          <td>
            <div style="display:flex;align-items:center;gap:8px;">
              <div style="flex:1;max-width:100px;height:8px;background:var(--line);border-radius:4px;overflow:hidden;">
                <div style="width:\${Math.min(100, s.covPct)}%;height:100%;background:var(--primary);border-radius:4px;"></div>
              </div>
              <span>\${s.covPct}%</span>
            </div>
          </td>
        </tr>
      \`;
    }).join('');
  }

  function exportFilteredCsv() {
    const query = (document.getElementById('hubSearch').value || '').trim().toLowerCase();
    const minLevel = document.getElementById('hubLevel').value;
    const cov = document.getElementById('hubCoverage').value;

    const filtered = REPORT_DATA.skills.filter(s => {
      if (query && !s.name.toLowerCase().includes(query)) return false;
      if (minLevel !== 'all' && s.maxRank < parseInt(minLevel, 10)) return false;
      if (cov !== 'all') {
        if (cov === 'gap' && s.covPct >= 5) return false;
        if (cov === 'low' && (s.covPct < 5 || s.covPct >= 15)) return false;
        if (cov === 'medium' && (s.covPct < 15 || s.covPct >= 40)) return false;
        if (cov === 'high' && s.covPct < 40) return false;
      }
      return true;
    });

    const headers = ['Skill Name', 'Max Level Rank', 'L1 Holders', 'L2 Holders', 'L3 Holders', 'L4 Holders', 'Total Holders', 'Average Level', 'Coverage Pct'];
    const rows = filtered.map(s => [
      csvEscape(s.name),
      s.maxRank,
      s.l1,
      s.l2,
      s.l3,
      s.l4,
      s.totalHolders,
      s.average,
      s.covPct + '%'
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\\r\\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = \`filtered-capability-matrix-\${new Date().toISOString().slice(0, 10)}.csv\`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function csvEscape(val) {
    let s = String(val ?? '');
    if (/^[=+\\-@]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function escapeText(val) {
    return String(val ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function updateRadarView() {
    const metric = document.getElementById('radarMetricSelect').value;
    const mount = document.getElementById('radarMount');
    if (metric === 'domains') {
      const cats = REPORT_DATA.categories.slice(0, 8);
      mount.innerHTML = renderCategoryRadarSvg(cats, REPORT_DATA.totalEmployees);
    } else {
      const topSkills = [...REPORT_DATA.skills]
        .filter(s => s.totalHolders > 0)
        .sort((a, b) => b.totalHolders - a.totalHolders)
        .slice(0, 8);
      mount.innerHTML = renderSkillRadarSvg(topSkills);
    }
  }

  function renderSkillRadarSvg(skills) {
    if (skills.length < 3) {
      return '<p class="report-scope" style="padding:40px;text-align:center;">At least 3 reviewed skills are required to render the spider-web radar chart.</p>';
    }
    const count = skills.length;
    const maximum = 4;
    const radius = 95, cx = 175, cy = 150;

    const point = (i, val) => {
      const angle = (i * 2 * Math.PI) / count - Math.PI / 2;
      return [
        cx + (Math.cos(angle) * radius * val) / maximum,
        cy + (Math.sin(angle) * radius * val) / maximum
      ];
    };

    const ring = (v) => skills.map((_, i) => point(i, v).map(n => n.toFixed(1)).join(',')).join(' ');

    let svg = \`<svg viewBox="0 0 350 300" class="radar-svg" role="img" aria-label="Skill Proficiency Spider Chart">\`;
    
    // Rings
    [1, 2, 3, 4].forEach(v => {
      svg += \`<polygon points="\${ring(v)}" class="radar-ring"/>\`;
      svg += \`<text x="\${cx + 4}" y="\${cy - (radius * v) / maximum + 4}" class="radar-tick">L\${v}</text>\`;
    });

    // Axes & Labels
    skills.forEach((s, i) => {
      const [x, y] = point(i, 4);
      const angle = (i * 2 * Math.PI) / count - Math.PI / 2;
      const lx = cx + Math.cos(angle) * (radius + 24);
      const ly = cy + Math.sin(angle) * (radius + 24);
      const textAnchor = Math.abs(Math.cos(angle)) < 0.2 ? 'middle' : Math.cos(angle) > 0 ? 'start' : 'end';
      const label = s.name.length > 14 ? s.name.slice(0, 13) + '…' : s.name;
      svg += \`<line x1="\${cx}" y1="\${cy}" x2="\${x.toFixed(1)}" y2="\${y.toFixed(1)}" class="radar-axis-line"/>\`;
      svg += \`<text x="\${lx.toFixed(1)}" y="\${ly.toFixed(1)}" text-anchor="\${textAnchor}" class="radar-label">\${escapeText(label)}</text>\`;
    });

    // Data Area
    const polyPoints = skills.map((s, i) => point(i, Math.max(0.5, s.average)).map(n => n.toFixed(1)).join(',')).join(' ');
    svg += \`<polygon points="\${polyPoints}" class="radar-area"/>\`;

    // Points
    skills.forEach((s, i) => {
      const [px, py] = point(i, Math.max(0.5, s.average));
      svg += \`<circle cx="\${px.toFixed(1)}" cy="\${py.toFixed(1)}" r="4.5" class="radar-point"><title>\${escapeText(s.name)}: Holder Avg L\${s.average} (\${s.totalHolders} holders)</title></circle>\`;
    });

    svg += \`</svg>\`;
    return svg;
  }

  function renderCategoryRadarSvg(cats, totalEmp) {
    if (cats.length < 3) {
      return '<p class="report-scope" style="padding:40px;text-align:center;">At least 3 domain categories are required for category radar view.</p>';
    }
    const count = cats.length;
    const maxVal = Math.max(1, ...cats.map(c => c.count));
    const radius = 95, cx = 175, cy = 150;

    const point = (i, val) => {
      const angle = (i * 2 * Math.PI) / count - Math.PI / 2;
      return [
        cx + (Math.cos(angle) * radius * val) / maxVal,
        cy + (Math.sin(angle) * radius * val) / maxVal
      ];
    };

    const ring = (fraction) => cats.map((_, i) => point(i, maxVal * fraction).map(n => n.toFixed(1)).join(',')).join(' ');

    let svg = \`<svg viewBox="0 0 350 300" class="radar-svg" role="img" aria-label="Category Distribution Spider Chart">\`;
    
    // Rings
    [0.25, 0.5, 0.75, 1.0].forEach((f, idx) => {
      svg += \`<polygon points="\${ring(f)}" class="radar-ring"/>\`;
      svg += \`<text x="\${cx + 4}" y="\${cy - radius * f + 4}" class="radar-tick">\${Math.round(f * 100)}%</text>\`;
    });

    // Axes & Labels
    cats.forEach((c, i) => {
      const [x, y] = point(i, maxVal);
      const angle = (i * 2 * Math.PI) / count - Math.PI / 2;
      const lx = cx + Math.cos(angle) * (radius + 24);
      const ly = cy + Math.sin(angle) * (radius + 24);
      const textAnchor = Math.abs(Math.cos(angle)) < 0.2 ? 'middle' : Math.cos(angle) > 0 ? 'start' : 'end';
      const label = c.name.length > 14 ? c.name.slice(0, 13) + '…' : c.name;
      svg += \`<line x1="\${cx}" y1="\${cy}" x2="\${x.toFixed(1)}" y2="\${y.toFixed(1)}" class="radar-axis-line"/>\`;
      svg += \`<text x="\${lx.toFixed(1)}" y="\${ly.toFixed(1)}" text-anchor="\${textAnchor}" class="radar-label">\${escapeText(label)}</text>\`;
    });

    // Data Area
    const polyPoints = cats.map((c, i) => point(i, Math.max(1, c.count)).map(n => n.toFixed(1)).join(',')).join(' ');
    svg += \`<polygon points="\${polyPoints}" class="radar-area" style="fill:rgba(53, 122, 194, 0.25);stroke:#357ac2;"/>\`;

    // Points
    cats.forEach((c, i) => {
      const [px, py] = point(i, Math.max(1, c.count));
      svg += \`<circle cx="\${px.toFixed(1)}" cy="\${py.toFixed(1)}" r="4.5" class="radar-point" style="fill:#357ac2"><title>\${escapeText(c.name)}: \${c.count} records</title></circle>\`;
    });

    svg += \`</svg>\`;
    return svg;
  }
</script>
</body>
</html>`;
}

function renderRadarSvg(
  skills: { name: string; average: number; totalHolders: number }[],
  categories: { label: string; value: number }[],
  totalEmployees: number,
): string {
  if (skills.length < 3) {
    return '<p class="report-scope" style="padding:40px;text-align:center;">At least 3 reviewed skills are needed for the capability radar view.</p>';
  }
  const count = skills.length;
  const maximum = 4;
  const radius = 95;
  const cx = 175;
  const cy = 150;

  const point = (i: number, val: number) => {
    const angle = (i * 2 * Math.PI) / count - Math.PI / 2;
    return [
      cx + (Math.cos(angle) * radius * val) / maximum,
      cy + (Math.sin(angle) * radius * val) / maximum,
    ];
  };

  const ring = (v: number) =>
    skills
      .map((_, i) =>
        point(i, v)
          .map(n => n.toFixed(1))
          .join(','),
      )
      .join(' ');

  let svg = `<svg viewBox="0 0 350 300" class="radar-svg" role="img" aria-label="Skill Proficiency Spider Chart">`;

  // Concentric Rings
  [1, 2, 3, 4].forEach(v => {
    svg += `<polygon points="${ring(v)}" class="radar-ring"/>`;
    svg += `<text x="${cx + 4}" y="${cy - (radius * v) / maximum + 4}" class="radar-tick">L${v}</text>`;
  });

  // Radial Axes and Labels
  skills.forEach((s, i) => {
    const [x, y] = point(i, 4);
    const angle = (i * 2 * Math.PI) / count - Math.PI / 2;
    const lx = cx + Math.cos(angle) * (radius + 24);
    const ly = cy + Math.sin(angle) * (radius + 24);
    const textAnchor =
      Math.abs(Math.cos(angle)) < 0.2 ? 'middle' : Math.cos(angle) > 0 ? 'start' : 'end';
    const label = s.name.length > 14 ? s.name.slice(0, 13) + '…' : s.name;
    svg += `<line x1="${cx}" y1="${cy}" x2="${x!.toFixed(1)}" y2="${y!.toFixed(1)}" class="radar-axis-line"/>`;
    svg += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${textAnchor}" class="radar-label">${escapeHtml(label)}</text>`;
  });

  // Data Polygon
  const polyPoints = skills
    .map((s, i) =>
      point(i, Math.max(0.5, s.average))
        .map(n => n.toFixed(1))
        .join(','),
    )
    .join(' ');
  svg += `<polygon points="${polyPoints}" class="radar-area"/>`;

  // Data Points
  skills.forEach((s, i) => {
    const [px, py] = point(i, Math.max(0.5, s.average));
    svg += `<circle cx="${px!.toFixed(1)}" cy="${py!.toFixed(1)}" r="4.5" class="radar-point"><title>${escapeHtml(s.name)}: Holder Avg L${s.average} (${s.totalHolders} holders)</title></circle>`;
  });

  svg += `</svg>`;
  return svg;
}

function renderTableRows(
  skills: {
    id: string;
    name: string;
    l1: number;
    l2: number;
    l3: number;
    l4: number;
    totalHolders: number;
    average: number;
    maxRank: number;
    covPct: number;
  }[],
  totalEmployees: number,
): string {
  if (!skills.length) {
    return '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--muted)">No reviewed skill coverage records established in this scope.</td></tr>';
  }

  return skills
    .map(s => {
      const sum = s.totalHolders || 1;
      return `
      <tr>
        <td><strong>${escapeHtml(s.name)}</strong></td>
        <td>
          <span class="rank-badge rank-${s.maxRank || 1}">
            L${s.maxRank} · ${escapeHtml(LEVEL_NAMES[(s.maxRank || 1) - 1])}
          </span>
        </td>
        <td>
          <div style="display:flex;align-items:center;gap:10px;">
            <div class="mix-track" title="L1: ${s.l1} | L2: ${s.l2} | L3: ${s.l3} | L4: ${s.l4}">
              <i style="flex:${s.l1};background:#61bdb5"></i>
              <i style="flex:${s.l2};background:#098b8c"></i>
              <i style="flex:${s.l3};background:#357ac2"></i>
              <i style="flex:${s.l4};background:#123c44"></i>
            </div>
            <small style="font-size:11px;color:var(--muted);white-space:nowrap;">
              L1:${s.l1} L2:${s.l2} L3:${s.l3} L4:${s.l4}
            </small>
          </div>
        </td>
        <td><strong>L${s.average}</strong></td>
        <td><strong>${s.totalHolders.toLocaleString()}</strong></td>
        <td>
          <div style="display:flex;align-items:center;gap:8px;">
            <div style="flex:1;max-width:100px;height:8px;background:var(--line);border-radius:4px;overflow:hidden;">
              <div style="width:${Math.min(100, s.covPct)}%;height:100%;background:var(--primary);border-radius:4px;"></div>
            </div>
            <span>${s.covPct}%</span>
          </div>
        </td>
      </tr>`;
    })
    .join('');
}
