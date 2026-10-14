import { authenticatedFetch } from './auth';
/** Small authenticated requests work on both organization hosting and serverless hosts. */
export async function uploadPrivateFile(url: string, init: RequestInit & { body: Blob }) {
  const size = 3 * 1024 * 1024;
  if (init.body.size <= size) return authenticatedFetch(url, init);
  const id = crypto.randomUUID(),
    count = Math.ceil(init.body.size / size);
  for (let index = 0; index < count; index++) {
    const headers = new Headers(init.headers);
    headers.set('X-Upload-Id', id);
    headers.set('X-Upload-Index', String(index));
    headers.set('X-Upload-Count', String(count));
    headers.set('X-Upload-Bytes', String(init.body.size));
    const response = await authenticatedFetch(url, {
      ...init,
      headers,
      body: init.body.slice(index * size, (index + 1) * size, init.body.type),
    });
    if (!response.ok || index === count - 1) return response;
    if (response.status !== 202)
      throw Error('File upload was not confirmed. Reopen the draft before retrying.');
    await response.arrayBuffer();
  }
  throw Error('File upload was not confirmed.');
}
