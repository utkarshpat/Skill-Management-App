import type { BusinessDashboard } from './business-model';

export function escapeHtml(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
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

  // Skill Coverage Table Rows
  const coverageRows = data.coverage || [];

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Workforce Capability & Executive Intelligence Report · ${escapeHtml(scopeLabel)}</title>
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
  .container { max-width: 1240px; margin: 0 auto; }

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
  @media (max-width: 900px) { .charts-grid { grid-template-columns: 1fr; } }

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
    align-items: baseline;
    margin-bottom: 18px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--line-subtle);
  }
  .chart-header h3 { font-size: 16px; font-weight: 700; color: var(--ink); }
  .chart-header span { font-size: 12px; color: var(--muted); }

  /* Bar Charts */
  .bar-chart-wrap { display: flex; flex-direction: column; gap: 12px; flex: 1; justify-content: center; }
  .bar-row { display: flex; align-items: center; gap: 12px; font-size: 13px; }
  .bar-label { width: 110px; font-weight: 600; color: var(--ink); flex-shrink: 0; }
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
  .bar-value { width: 60px; text-align: right; font-weight: 700; color: var(--ink); }

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
  .table-filters { display: flex; gap: 10px; align-items: center; }
  .search-input {
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink);
    padding: 8px 14px;
    border-radius: var(--radius-sm);
    font-size: 13.5px;
    min-width: 240px;
    outline: none;
  }
  .search-input:focus { border-color: var(--primary); }
  .select-filter {
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink);
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    font-size: 13.5px;
    outline: none;
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
  }
  .data-table th:hover { color: var(--ink); }
  .data-table td {
    padding: 12px 16px;
    border-bottom: 1px solid var(--line);
    color: var(--ink);
  }
  .data-table tr:last-child td { border-bottom: 0; }
  .data-table tr:hover td { background: var(--line-subtle); }

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
    .header-actions, .table-filters, .report-footer button { display: none !important; }
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
      <p class="report-scope">Enterprise-wide capability baseline, certification governance and workforce skill distribution</p>
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

    <!-- 1. Proficiency Level Distribution -->
    <div class="chart-card">
      <div class="chart-header">
        <h3>Proficiency Level Distribution</h3>
        <span>4-Level Framework</span>
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

    <!-- 2. Certification Expiry Risk Timeline -->
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

    <!-- 3. Category Capability Distribution -->
    <div class="chart-card">
      <div class="chart-header">
        <h3>Domain &amp; Category Capability</h3>
        <span>Workforce Specializations</span>
      </div>
      <div class="bar-chart-wrap">
        ${
          categories.length
            ? categories
                .slice(0, 6)
                .map((cat, i) => {
                  const pct = totalCatRecords ? Math.round((cat.value * 100) / totalCatRecords) : 0;
                  const color = CATEGORY_COLORS[i % CATEGORY_COLORS.length];
                  return `
            <div class="bar-row">
              <span class="bar-label" title="${escapeHtml(cat.label)}">${escapeHtml(cat.label)}</span>
              <div class="bar-track">
                <div class="bar-fill" style="width: ${pct}%; background: ${color};"></div>
              </div>
              <span class="bar-value">${cat.value.toLocaleString()} <small style="font-size:10px;color:var(--muted)">(${pct}%)</small></span>
            </div>`;
                })
                .join('')
            : '<p class="report-scope">Category distribution not recorded for this scope.</p>'
        }
      </div>
      <div class="chart-legend">
        ${categories
          .slice(0, 4)
          .map(
            (c, i) =>
              `<span><i class="legend-dot" style="background:${CATEGORY_COLORS[i % CATEGORY_COLORS.length]}"></i> ${escapeHtml(c.label)}</span>`,
          )
          .join('')}
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

  <!-- Interactive Skill Coverage Table -->
  <section class="table-section">
    <div class="table-toolbar">
      <div class="table-title-group">
        <h3>Verified Skill Inventory &amp; Coverage</h3>
        <p>Canonical catalogue definitions, verified level ranks, and verified holder counts</p>
      </div>
      <div class="table-filters">
        <input
          type="search"
          id="tableSearch"
          class="search-input"
          placeholder="Filter skills…"
          oninput="filterTable()"
        />
        <select id="levelFilter" class="select-filter" onchange="filterTable()">
          <option value="all">All Proficiency Levels</option>
          <option value="1">L1 Foundation &amp; above</option>
          <option value="2">L2 Autonomous &amp; above</option>
          <option value="3">L3 Experienced &amp; above</option>
          <option value="4">L4 Expert only</option>
        </select>
      </div>
    </div>

    <div class="data-table-wrap">
      <table class="data-table" id="skillsTable">
        <thead>
          <tr>
            <th onclick="sortTable(0)">Skill Name ⬍</th>
            <th onclick="sortTable(1)">Verified Minimum Level ⬍</th>
            <th onclick="sortTable(2)">Verified Holders ⬍</th>
            <th onclick="sortTable(3)">Workforce Coverage % ⬍</th>
          </tr>
        </thead>
        <tbody>
          ${
            coverageRows.length
              ? coverageRows
                  .map(row => {
                    const covPct = totalEmployees
                      ? Math.round((row.holders * 100) / totalEmployees)
                      : 0;
                    return `
              <tr data-skill="${escapeHtml(row.label).toLowerCase()}" data-rank="${row.rank}">
                <td><strong>${escapeHtml(row.label)}</strong></td>
                <td>
                  <span class="rank-badge rank-${row.rank}">
                    L${row.rank} · ${escapeHtml(LEVEL_NAMES[row.rank - 1] || `Rank ${row.rank}`)}
                  </span>
                </td>
                <td><strong>${row.holders.toLocaleString()}</strong> employees</td>
                <td>
                  <div style="display:flex;align-items:center;gap:8px;">
                    <div style="flex:1;max-width:100px;height:8px;background:var(--line);border-radius:4px;overflow:hidden;">
                      <div style="width:${Math.min(100, covPct)}%;height:100%;background:var(--primary);border-radius:4px;"></div>
                    </div>
                    <span>${covPct}%</span>
                  </div>
                </td>
              </tr>`;
                  })
                  .join('')
              : '<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--muted)">No reviewed skill coverage records established in this scope.</td></tr>'
          }
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

<script>
  function toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
    document.getElementById('themeBtn').innerText = isDark ? '🌓 Dark' : '☀️ Light';
  }

  function filterTable() {
    const query = (document.getElementById('tableSearch').value || '').trim().toLowerCase();
    const rankVal = document.getElementById('levelFilter').value;
    const rows = document.querySelectorAll('#skillsTable tbody tr');
    let visible = 0;

    rows.forEach(row => {
      const skill = row.getAttribute('data-skill') || '';
      const rank = parseInt(row.getAttribute('data-rank') || '0', 10);
      const matchesText = !query || skill.includes(query);
      const matchesRank = rankVal === 'all' || rank >= parseInt(rankVal, 10);

      if (matchesText && matchesRank) {
        row.style.display = '';
        visible++;
      } else {
        row.style.display = 'none';
      }
    });
  }

  let sortDirections = [true, true, true, true];
  function sortTable(colIndex) {
    const table = document.getElementById('skillsTable');
    const tbody = table.querySelector('tbody');
    const rows = Array.from(tbody.querySelectorAll('tr'));
    const isAsc = sortDirections[colIndex];
    sortDirections[colIndex] = !isAsc;

    rows.sort((a, b) => {
      let aVal = a.children[colIndex].innerText.trim();
      let bVal = b.children[colIndex].innerText.trim();
      const aNum = parseFloat(aVal.replace(/[^0-9.-]+/g, ''));
      const bNum = parseFloat(bVal.replace(/[^0-9.-]+/g, ''));

      if (!isNaN(aNum) && !isNaN(bNum)) {
        return isAsc ? aNum - bNum : bNum - aNum;
      }
      return isAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    });

    rows.forEach(r => tbody.appendChild(r));
  }
</script>
</body>
</html>`;
}
