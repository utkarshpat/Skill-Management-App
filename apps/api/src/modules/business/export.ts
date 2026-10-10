import { strToU8, zipSync } from 'fflate';
import type { BusinessDashboard, BusinessQuery } from './business.js';
const safe = (value: unknown) => {
  const text = String(value ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  return /^[\s\uFEFF]*[=+\-@]/.test(text) ? "'" + text : text;
};
export function reportCells(data: BusinessDashboard, query: BusinessQuery) {
  const columns = [...new Set(data.rows.flatMap(row => Object.keys(row)))];
  const metadata = [
    ['Dataset', query.dataset],
    ['As of (UTC)', data.context.asOf],
    [
      'Scope',
      query.scopeId
        ? (data.context.scopes.find(s => s.id === query.scopeId)?.label ?? 'Selected scope')
        : 'All authorized scopes',
    ],
    ['Unique filtered records', String(data.total)],
    ['Current coverage', 'As-of snapshot; activity dates apply to activity events only'],
    [
      'Project membership',
      'Combined people and records are deduplicated; separate project totals may overlap',
    ],
    ...Object.entries(query)
      .filter(
        ([key, value]) =>
          !['dataset', 'page', 'scopeId'].includes(key) && value !== '' && value !== undefined,
      )
      .map(([key, value]) => [key, String(value)]),
  ].map(cells => cells.map(safe));
  return {
    columns,
    rows: data.rows.map(row => columns.map(key => safe(row[key]))),
    metadata,
  };
}
export function businessCsv(data: BusinessDashboard, query: BusinessQuery) {
  const { columns, rows, metadata } = reportCells(data, query);
  const line = (cells: string[]) => cells.map(c => '"' + c.replaceAll('"', '""') + '"').join(',');
  return '\uFEFF' + [...metadata, [], columns, ...rows].map(line).join('\r\n');
}
const xml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
export function businessXlsx(data: BusinessDashboard, query: BusinessQuery) {
  const { columns, rows, metadata } = reportCells(data, query);
  const column = (n: number) => {
    let s = '';
    for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  };
  const sheet = (cells: string[][]) =>
    '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
    cells
      .map(
        (row, i) =>
          `<row r="${i + 1}">${row.map((c, j) => `<c r="${column(j)}${i + 1}" t="inlineStr"><is><t xml:space="preserve">${xml(c)}</t></is></c>`).join('')}</row>`,
      )
      .join('') +
    '</sheetData></worksheet>';
  return zipSync(
    Object.fromEntries(
      Object.entries({
        '[Content_Types].xml':
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
        '_rels/.rels':
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        'xl/workbook.xml':
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Records" sheetId="1" r:id="rId1"/><sheet name="Context" sheetId="2" r:id="rId2"/></sheets></workbook>',
        'xl/_rels/workbook.xml.rels':
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>',
        'xl/worksheets/sheet1.xml': sheet([columns, ...rows]),
        'xl/worksheets/sheet2.xml': sheet(metadata),
      }).map(([name, content]) => [name, strToU8(content)]),
    ),
    { level: 6 },
  );
}
