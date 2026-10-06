export interface ApiResponseError extends Error {
  status: number;
}

export async function readApiResponse<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => undefined);
  if (!response.ok)
    throw Object.assign(Error(body?.error?.message ?? fallback), {
      status: response.status,
    }) as ApiResponseError;
  return body as T;
}
