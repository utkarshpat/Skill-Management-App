import type ExcelJS from 'exceljs';
import { unzipSync, zipSync } from 'fflate';
import { AccessError } from '../../shared/errors.js';

type Cell = string | number | boolean | null;

interface ExcelSheet {
  name: string;
  columns: readonly string[];
  legacyLeadingColumn?: string;
  legacyHeadings?: Readonly<Record<string, string>>;
}

export interface ExcelRow {
  row: number;
  values: Record<string, Cell>;
}

export const excelMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const excelUploadLimit = 2 * 1024 * 1024;
const maxRows = 10_000;

export async function writeExcel(
  sheets: readonly ExcelSheet[],
  rows: Record<string, Record<string, Cell>[]>,
): Promise<Buffer> {
  const { default: library } = await import('exceljs');
  const workbook = new library.Workbook();
  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name, {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    worksheet.addRow([...sheet.columns]).font = { bold: true };
    sheet.columns.forEach((column, index) => {
      worksheet.getColumn(index + 1).width = Math.max(18, column.length + 3);
      if (
        [
          'ID',
          'Employee Code',
          'Manager Employee Code',
          'Source ID',
          'Credential ID',
          'Issue Date',
          'Expiry Date',
        ].includes(column)
      )
        worksheet.getColumn(index + 1).numFmt = '@';
    });
    for (const record of rows[sheet.name] ?? []) {
      // ExcelJS writes primitive strings as text cells. Formulas require a separate value object.
      worksheet.addRow(
        sheet.columns.map(column => {
          const legacy = sheet.legacyHeadings?.[column];
          return record[column] ?? (legacy ? record[legacy] : undefined) ?? null;
        }),
      );
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function readExcel(file: Buffer, sheets: readonly ExcelSheet[]) {
  if (file.length > excelUploadLimit) throw new AccessError(413, 'Excel file exceeds 2 MB.');
  const { default: library } = await import('exceljs');
  const workbook = new library.Workbook();
  try {
    // Inspect the archive directory before the workbook reader inflates its entries.
    let entries = 0;
    let expanded = 0;
    const unpacked = unzipSync(file, {
      filter(entry) {
        expanded += entry.originalSize;
        if (++entries > 200 || expanded > 20 * 1024 * 1024) throw new Error('Archive too large');
        return true;
      },
    });
    if (
      !unpacked['[Content_Types].xml'] ||
      !unpacked['xl/workbook.xml'] ||
      Object.values(unpacked).reduce((bytes, entry) => bytes + entry.length, 0) > 20 * 1024 * 1024
    )
      throw new Error('Invalid workbook archive');
    const normalized = zipSync(unpacked, { level: 0 });
    await workbook.xlsx.load(normalized as unknown as ExcelJS.Buffer, {
      ignoreNodes: ['dataValidations', 'conditionalFormatting', 'drawing', 'extLst'],
    });
  } catch {
    throw new AccessError(
      400,
      'Upload a valid, unencrypted .xlsx workbook within the size limits.',
    );
  }
  const result: Record<string, ExcelRow[]> = {};
  for (const worksheet of workbook.worksheets) {
    const sheet = sheets.find(value => value.name === worksheet.name);
    if (!sheet) throw new AccessError(400, `Unexpected worksheet: ${worksheet.name}.`);
    const headers = worksheet.getRow(1);
    const offset =
      sheet.legacyLeadingColumn && headers.getCell(1).value === sheet.legacyLeadingColumn ? 1 : 0;
    if (worksheet.rowCount > maxRows + 1 || worksheet.columnCount > sheet.columns.length + offset)
      throw new AccessError(400, `${sheet.name} exceeds the expected rows or columns.`);
    if (
      sheet.columns.some((column, index) => {
        const heading = headers.getCell(index + 1 + offset).value;
        const legacy = sheet.legacyHeadings?.[column];
        return heading !== column && (!legacy || heading !== legacy);
      })
    )
      throw new AccessError(400, `Use the downloaded column headings on ${sheet.name}.`);
    const records: ExcelRow[] = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const values: Record<string, Cell> = {};
      sheet.columns.forEach((column, index) => {
        const cell = row.getCell(index + 1 + offset);
        const value = cell.value;
        if (value instanceof Date && Number.isFinite(value.getTime())) {
          values[column] = value.toISOString().slice(0, 10);
        } else if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
          values[column] = value as Cell;
        } else if (
          value &&
          typeof value === 'object' &&
          !('formula' in value) &&
          !('sharedFormula' in value) &&
          !('error' in value) &&
          'text' in value &&
          typeof value.text === 'string' &&
          'hyperlink' in value &&
          typeof value.hyperlink === 'string' &&
          // ExcelJS can present a formula's cached result as hyperlink display text.
          !('formula' in cell.model) &&
          !('sharedFormula' in cell.model)
        ) {
          values[column] = value.text;
        } else if (
          value &&
          typeof value === 'object' &&
          !('formula' in value) &&
          !('sharedFormula' in value) &&
          !('error' in value) &&
          'richText' in value &&
          Array.isArray(value.richText) &&
          value.richText.every(
            (part: unknown) =>
              part && typeof part === 'object' && 'text' in part && typeof part.text === 'string',
          )
        ) {
          values[column] = value.richText.map((part: { text: string }) => part.text).join('');
        } else {
          throw new AccessError(
            400,
            `${sheet.name}, row ${rowNumber}: use plain cell values for ${column}.`,
          );
        }
      });
      if (Object.values(values).some(value => value !== null && String(value).trim() !== ''))
        records.push({ row: rowNumber, values });
    });
    result[sheet.name] = records;
  }
  if (!Object.keys(result).length) throw new AccessError(400, 'The workbook has no worksheets.');
  return result;
}
