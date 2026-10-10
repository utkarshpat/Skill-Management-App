import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { PDFDocument } from 'pdf-lib';
import { unzipSync } from 'fflate';
import { XMLValidator, XMLParser } from 'fast-xml-parser';

// Parse untrusted documents off the request thread with a time and heap budget.
export function validateCertificateDocument(data: Buffer, mimeType: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { data, mimeType },
      resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 },
    });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error('Document validation timed out.'));
    }, 5000);
    const finish = (error?: Error) => {
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error);
      else resolve();
    };
    worker.once('message', valid =>
      finish(valid === true ? undefined : new Error('Invalid document.')),
    );
    worker.once('error', error =>
      finish(error instanceof Error ? error : new Error(String(error))),
    );
    worker.once('exit', code => {
      if (code !== 0) finish(new Error('Document validation failed.'));
    });
  });
}
async function validate(data: Buffer, mimeType: string) {
  if (mimeType === 'application/pdf') {
    if (
      !/^%PDF-1\.[0-7]|^%PDF-2\.0/.test(data.toString('ascii', 0, 8)) ||
      !/startxref\s+\d+\s+%%EOF\s*$/.test(data.subarray(-2048).toString('ascii'))
    )
      throw Error();
    const pdf = await PDFDocument.load(data, { throwOnInvalidObject: true, updateMetadata: false });
    if (pdf.isEncrypted || pdf.getPageCount() < 1 || pdf.getPageCount() > 1000) throw Error();
    pdf.getPages().forEach(page => {
      const size = page.getSize();
      if (!(size.width > 0 && size.height > 0)) throw Error();
    });
    return;
  }
  const required = ['[Content_Types].xml', '_rels/.rels', 'word/document.xml'];
  let entries = 0,
    total = 0;
  const names = new Set<string>();
  const files = unzipSync(data, {
    filter: file => {
      total += file.originalSize;
      if (
        ++entries > 1000 ||
        total > 20 * 1024 * 1024 ||
        file.originalSize > 10 * 1024 * 1024 ||
        names.has(file.name) ||
        file.name.includes('..') ||
        file.name.startsWith('/')
      )
        throw Error();
      names.add(file.name);
      return required.includes(file.name);
    },
  });
  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    processEntities: false,
  });
  const parts = required.map(name => {
    if (!files[name]?.length || files[name].length > 10 * 1024 * 1024) throw Error();
    const xml = new TextDecoder('utf-8', { fatal: true }).decode(files[name]);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw Error();
    return parser.parse(xml);
  });
  const overrides = parts[0]?.Types?.Override;
  const relationships = parts[1]?.Relationships?.Relationship;
  if (
    !(Array.isArray(overrides) ? overrides : [overrides]).some(
      item =>
        item?.['@_PartName'] === '/word/document.xml' &&
        item?.['@_ContentType'] ===
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    ) ||
    !(Array.isArray(relationships) ? relationships : [relationships]).some(
      item =>
        item?.['@_Type']?.endsWith('/officeDocument') &&
        item?.['@_Target']?.replace(/^\//, '') === 'word/document.xml',
    ) ||
    !parts[2]?.document ||
    !Object.hasOwn(parts[2].document, 'body')
  )
    throw Error();
}
if (!isMainThread) {
  validate(Buffer.from(workerData.data), workerData.mimeType).then(
    () => parentPort!.postMessage(true),
    () => parentPort!.postMessage(false),
  );
}
