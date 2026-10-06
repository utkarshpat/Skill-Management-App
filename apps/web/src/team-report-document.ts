import type { TeamReportAnalytics } from './team-reports';
import {
  LEVELS,
  membersWithoutReviewedSkills,
  skillProfiles,
  teamAverageLevel,
  type SkillProfile,
} from './team-insights';
import { indexCoverage } from './team-coverage';

const LEVEL_COLORS = ['#9cc9cf', '#5fb0ba', '#008595', '#0b5f6b', '#123c44'];
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

export function escapeHtml(value: string | number) {
  return String(value).replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

function donut(reviewed: number, pending: number) {
  const total = reviewed + pending,
    circumference = 2 * Math.PI * 52,
    share = total ? reviewed / total : 0;
  return `<svg viewBox="0 0 140 140" role="img" aria-label="${escapeHtml(`${reviewed} manager-reviewed claims and ${pending} assigned pending reviews`)}">
  <circle cx="70" cy="70" r="52" fill="none" stroke="#e7c58a" stroke-width="18"/>
  ${total ? `<circle cx="70" cy="70" r="52" fill="none" stroke="#008595" stroke-width="18" stroke-dasharray="${(share * circumference).toFixed(2)} ${circumference.toFixed(2)}" transform="rotate(-90 70 70)"/>` : ''}
  <text x="70" y="68" text-anchor="middle" class="donut-value">${total ? Math.round(share * 100) : 0}%</text>
  <text x="70" y="86" text-anchor="middle" class="donut-label">reviewed</text></svg>`;
}

function levelColumns(analytics: TeamReportAnalytics) {
  const counts = LEVELS.map(rank =>
    rank === 5
      ? analytics.levels.filter(l => l.rank >= 5).reduce((s, l) => s + l.count, 0)
      : (analytics.levels.find(l => l.rank === rank)?.count ?? 0),
  );
  const max = Math.max(1, ...counts);
  return `<svg viewBox="0 0 300 170" role="img" aria-label="${escapeHtml('Reviewed claims by level: ' + counts.map((c, i) => `L${i + 1}${i === 4 ? '+' : ''} ${c}`).join(', '))}">
  ${counts
    .map((count, i) => {
      const h = Math.round((count / max) * 120),
        x = 18 + i * 56;
      return `<g><rect x="${x}" y="${140 - h}" width="38" height="${h}" rx="4" fill="${LEVEL_COLORS[i]}"><title>L${i + 1}${i === 4 ? '+' : ''}: ${count} claims</title></rect><text x="${x + 19}" y="${134 - h}" text-anchor="middle" class="axis strong">${count}</text><text x="${x + 19}" y="160" text-anchor="middle" class="axis">L${i + 1}${i === 4 ? '+' : ''}</text></g>`;
    })
    .join('')}
  <line x1="10" y1="140" x2="290" y2="140" class="rule"/></svg>`;
}

function radar(profiles: SkillProfile[]) {
  const skills = profiles.slice(0, 6);
  if (skills.length < 3)
    return '<p class="empty">At least three reviewed skills are needed for the radar view.</p>';
  const point = (i: number, value: number, r = 90) => {
    const a = (i * 2 * Math.PI) / skills.length - Math.PI / 2;
    return [150 + (Math.cos(a) * r * value) / 5, 130 + (Math.sin(a) * r * value) / 5];
  };
  const ring = (v: number) =>
    skills
      .map((_, i) =>
        point(i, v)
          .map(n => n.toFixed(1))
          .join(','),
      )
      .join(' ');
  return `<svg viewBox="0 0 300 260" role="img" aria-label="${escapeHtml('Holder averages capped at L5 (historical ranks above 5 grouped as L5+): ' + skills.map(s => `${s.skill} ${s.average}`).join(', '))}">
  ${LEVELS.map(v => `<polygon points="${ring(v)}" class="ring"/>`).join('')}
  ${skills
    .map((s, i) => {
      const [x, y] = point(i, 5),
        [lx, ly] = point(i, 5, 112);
      return `<line x1="150" y1="130" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="ring"/><text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="middle" class="axis">${escapeHtml(s.skill.length > 14 ? s.skill.slice(0, 13) + '…' : s.skill)}</text>`;
    })
    .join('')}
  <polygon points="${skills
    .map((s, i) =>
      point(i, s.average)
        .map(n => n.toFixed(1))
        .join(','),
    )
    .join(' ')}" class="area"/>
  ${skills
    .map((s, i) => {
      const [x, y] = point(i, s.average);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" class="dot"><title>${escapeHtml(`${s.skill}: capped holder average ${s.average} across ${s.holders} holders (L5+)`)}</title></circle>`;
    })
    .join('')}</svg>`;
}

function levelMix(profiles: SkillProfile[]) {
  const skills = profiles.slice(0, 10);
  if (!skills.length) return '<p class="empty">No reviewed skills yet.</p>';
  return `<div class="mix">${skills.map(s => `<div class="mix-row"><span title="${escapeHtml(s.skill)}">${escapeHtml(s.skill)}</span><div class="mix-track" role="img" aria-label="${escapeHtml(`${s.skill}: ${s.atLevel.map((n, i) => `L${i + 1}${i === 4 ? '+' : ''} ${n}`).join(', ')}`)}">${s.atLevel.map((n, i) => (n ? `<i style="flex:${n};background:${LEVEL_COLORS[i]}" title="L${i + 1}${i === 4 ? '+' : ''}: ${n}"></i>` : '')).join('')}</div><b>${s.holders}</b></div>`).join('')}</div>
  <p class="legend">${LEVELS.map((l, i) => `<span><i style="background:${LEVEL_COLORS[i]}"></i>L${l}${l === 5 ? '+' : ''}</span>`).join('')}</p>`;
}

function categories(analytics: TeamReportAnalytics) {
  const rows = [...analytics.categories].sort((a, b) => b.count - a.count).slice(0, 8),
    total = rows.reduce((s, c) => s + c.count, 0);
  if (!total) return '<p class="empty">No reviewed categories yet.</p>';
  return `<div class="treemap">${rows.map((c, i) => `<div style="flex:${c.count};background:${CATEGORY_COLORS[i % CATEGORY_COLORS.length]}" title="${escapeHtml(`${c.category}: ${c.count} reviewed claims`)}"><strong>${escapeHtml(c.category)}</strong><span>${c.count} · ${Math.round((c.count / total) * 100)}%</span></div>`).join('')}</div>`;
}

export function teamReportHtml(analytics: TeamReportAnalytics, query: string, at: Date) {
  const index = indexCoverage(analytics),
    profiles = skillProfiles(analytics, index),
    without = membersWithoutReviewedSkills(analytics);
  const data = JSON.stringify({
    members: analytics.members,
    skills: [...index].map(([skill, ranks]) => ({
      skill,
      levels: LEVELS.map(rank => ranks.get(rank)?.people ?? 0),
    })),
  })
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const kpis: [string, string | number, string][] = [
    [
      'Active direct reports',
      analytics.members,
      query ? `Search: “${query}”` : 'All current direct reports',
    ],
    ['Manager-reviewed claims', analytics.reviewed, 'Verified proficiency records'],
    ['Assigned pending reviews', analytics.pending, 'Not yet counted as proficiency'],
    ['Reviewed skills', profiles.length, 'Distinct skills with a reviewed record'],
    [
      'Average reviewed level',
      teamAverageLevel(analytics) ? 'L' + teamAverageLevel(analytics) : '—',
      'Across all reviewed claims',
    ],
    ['Without reviewed skills', without, 'Members with no reviewed record'],
  ];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">
<title>Team capability report · ${escapeHtml(at.toISOString().slice(0, 10))}</title>
<style>
:root{--ink:#16242b;--muted:#566872;--line:#dbe3e6;--surface:#fff;--page:#f3f6f7;--teal:#008595;--amber:#b87b11;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--ink:#e6eef0;--muted:#a3b3b9;--line:#2c3c43;--surface:#16242b;--page:#0e181d;--teal:#3fb6c3}}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 "Segoe UI",system-ui,sans-serif;color:var(--ink);background:var(--page)}
main{max-width:1180px;margin:0 auto;padding:40px 24px 64px}
header.top{display:flex;justify-content:space-between;gap:24px;align-items:flex-end;flex-wrap:wrap;margin-bottom:28px}
h1{margin:0;font-size:clamp(1.8rem,3vw,2.6rem);letter-spacing:-.02em;line-height:1.1}h2{margin:0 0 4px;font-size:1.05rem}
.meta{color:var(--muted);margin:8px 0 0}.actions button{font:inherit;font-weight:600;border:1px solid var(--teal);background:var(--teal);color:#fff;border-radius:8px;padding:9px 16px;cursor:pointer}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:20px}
.kpi{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px}.kpi b{display:block;font-size:1.9rem;line-height:1.1;font-variant-numeric:tabular-nums}.kpi span{font-weight:600;font-size:.86rem}.kpi small{display:block;color:var(--muted);font-size:.78rem}
.grid{display:grid;grid-template-columns:repeat(12,1fr);gap:16px}.panel{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:20px;min-width:0}
.span-4{grid-column:span 4}.span-5{grid-column:span 5}.span-7{grid-column:span 7}.span-8{grid-column:span 8}.span-12{grid-column:span 12}
@media (max-width:860px){.span-4,.span-5,.span-7,.span-8{grid-column:span 12}}
.panel p.sub{margin:0 0 14px;color:var(--muted);font-size:.85rem}svg{width:100%;height:auto;display:block}
.axis{font-size:11px;fill:var(--muted)}.axis.strong{fill:var(--ink);font-weight:600}.rule,.ring{stroke:var(--line);fill:none}.area{fill:rgba(0,133,149,.22);stroke:var(--teal);stroke-width:2}.dot{fill:var(--teal)}
.donut-value{font-size:24px;font-weight:700;fill:var(--ink)}.donut-label{font-size:11px;fill:var(--muted)}.donut-wrap{display:flex;gap:18px;align-items:center}.donut-wrap svg{max-width:150px}
.legend{display:flex;flex-wrap:wrap;gap:12px;margin:10px 0 0;font-size:.8rem;color:var(--muted)}.legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
.mix{display:grid;gap:8px}.mix-row{display:grid;grid-template-columns:minmax(80px,150px) 1fr 32px;gap:10px;align-items:center;font-size:.85rem}.mix-row span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mix-row b{text-align:right;font-variant-numeric:tabular-nums}
.mix-track{display:flex;height:14px;border-radius:7px;overflow:hidden;background:var(--line)}.mix-track i{display:block}
.treemap{display:flex;flex-wrap:wrap;gap:4px;min-height:180px}.treemap div{min-width:90px;flex-grow:1;border-radius:8px;padding:10px;color:#fff;display:flex;flex-direction:column;justify-content:flex-end}.treemap span{font-size:.78rem;opacity:.9}
.controls{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:14px}.controls label{font-size:.85rem;font-weight:600;display:flex;gap:6px;align-items:center}
select,input{font:inherit;color:var(--ink);background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:6px 10px}
.bars{display:grid;gap:7px;margin-bottom:16px}.bar{display:grid;grid-template-columns:minmax(80px,170px) 1fr 54px;gap:10px;align-items:center;font-size:.85rem}.bar span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bar .track{height:12px;border-radius:6px;background:rgba(184,123,17,.22);overflow:hidden}.bar .fill{height:100%;background:var(--teal)}.bar b{text-align:right;font-variant-numeric:tabular-nums}
table{width:100%;border-collapse:collapse;font-size:.88rem}th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line)}th button{all:unset;cursor:pointer;font-weight:700}th button:focus-visible,button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid var(--teal);outline-offset:2px}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}.gap-high{color:#b44a2f;font-weight:700}.empty{color:var(--muted)}
footer{margin-top:24px;color:var(--muted);font-size:.8rem;max-width:75ch}
@media print{body{background:#fff}.actions,.controls input{display:none}.panel,.kpi{break-inside:avoid;border-color:#ccc}main{padding:0}}
</style></head><body><main>
<header class="top"><div><h1>Team capability report</h1><p class="meta">Current active direct reports · ${escapeHtml(query ? `Search “${query}”` : 'All direct reports')} · Generated ${escapeHtml(at.toLocaleString())}</p></div>
<div class="actions"><button type="button" id="print">Print or save as PDF</button></div></header>
<section class="kpis">${kpis.map(([label, value, note]) => `<div class="kpi"><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}</span><small>${escapeHtml(note)}</small></div>`).join('')}</section>
<div class="grid">
<section class="panel span-12"><h2>Coverage and recorded gaps</h2><p class="sub">Members with a manager-reviewed claim at or above the chosen level. Amber is missing recorded coverage, not a proven deficiency.</p>
<div class="controls"><label>Minimum level <select id="level">${LEVELS.map(l => `<option value="${l}"${l === 3 ? ' selected' : ''}>L${l} and above</option>`).join('')}</select></label><label>Find skill <input id="search" type="search" placeholder="e.g. Azure"></label><label>Show <select id="show"><option value="all">All skills</option><option value="gaps">Only gaps</option></select></label></div>
<div class="bars" id="bars"></div>
<table><thead><tr><th><button data-sort="skill">Skill</button></th><th class="num"><button data-sort="holders">Reviewed holders</button></th><th class="num"><button data-sort="missing">Without coverage</button></th><th class="num"><button data-sort="percent">Coverage</button></th></tr></thead><tbody id="rows"></tbody></table>
<p class="empty" id="none" hidden>No skills match these filters.</p></section>
<section class="panel span-4"><h2>Claim status</h2><p class="sub">Reviewed claims against your assigned pending reviews.</p><div class="donut-wrap">${donut(analytics.reviewed, analytics.pending)}<p class="legend"><span><i style="background:#008595"></i>Reviewed ${analytics.reviewed}</span><span><i style="background:#e7c58a"></i>Pending ${analytics.pending}</span></p></div></section>
<section class="panel span-4"><h2>Level distribution</h2><p class="sub">All reviewed claims by proficiency level.</p>${levelColumns(analytics)}</section>
<section class="panel span-4"><h2>Skill radar</h2><p class="sub">Holder averages capped at L5, top skills. Historical ranks above 5 are grouped as L5+, not exact L5; the overall claim average above remains uncapped.</p>${radar(profiles)}</section>
<section class="panel span-7"><h2>Level mix by skill</h2><p class="sub">How reviewed holders spread across levels. L5+ includes historical ranks above 5.</p>${levelMix(profiles)}</section>
<section class="panel span-5"><h2>Category share</h2><p class="sub">Reviewed claims by skill category.</p>${categories(analytics)}</section>
</div>
<footer>Based on manager-reviewed claims for current active direct reports. Assigned pending reviews are shown separately and never counted as proficiency; private drafts are excluded. Missing recorded coverage is not proof of a skill deficiency, and no role-based targets are configured. This report contains aggregate counts only, without names or employee IDs.</footer>
</main>
<script type="application/json" id="data">${data}</script>
<script>(function(){var d=JSON.parse(document.getElementById('data').textContent),level=document.getElementById('level'),search=document.getElementById('search'),show=document.getElementById('show'),bars=document.getElementById('bars'),rows=document.getElementById('rows'),none=document.getElementById('none'),sort='missing',dir=-1;
function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e}
function render(){var r=+level.value,q=search.value.trim().toLowerCase(),list=d.skills.map(function(s){var h=s.levels[r-1];return{skill:s.skill,holders:h,missing:d.members-h,percent:d.members?Math.round(h/d.members*100):0}}).filter(function(x){return(!q||x.skill.toLowerCase().indexOf(q)>=0)&&(show.value==='all'||x.missing>0)});
list.sort(function(a,b){var v=sort==='skill'?a.skill.localeCompare(b.skill):a[sort]-b[sort];return v*dir||a.skill.localeCompare(b.skill)});bars.replaceChildren();rows.replaceChildren();none.hidden=list.length>0;
list.slice(0,12).forEach(function(x){var row=el('div','bar'),t=el('div','track'),f=el('div','fill');f.style.width=x.percent+'%';t.appendChild(f);t.title=x.holders+' of '+d.members+' at L'+r+'+';var n=el('span',null,x.skill);n.title=x.skill;row.append(n,t,el('b',null,x.percent+'%'));bars.appendChild(row)});
list.forEach(function(x){var tr=el('tr');tr.append(el('td',null,x.skill),el('td','num',x.holders+' / '+d.members),el('td','num'+(x.percent<34?' gap-high':''),String(x.missing)),el('td','num',x.percent+'%'));rows.appendChild(tr)})}
document.querySelectorAll('th button').forEach(function(b){b.addEventListener('click',function(){var k=b.getAttribute('data-sort');dir=sort===k?-dir:(k==='skill'?1:-1);sort=k;render()})});
[level,search,show].forEach(function(c){c.addEventListener('input',render)});document.getElementById('print').addEventListener('click',function(){window.print()});render()})();</script>
</body></html>`;
}
