import type { Response } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
/** Authorization and snapshot rechecks finish before starting the streamed response. */
export async function streamPrivateFile(res: Response, data: Buffer) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const parts: Buffer[] = [];
  for (let offset = 0; offset < data.length; offset += 65536)
    parts.push(data.subarray(offset, offset + 65536));
  await pipeline(Readable.from(parts), res);
}
