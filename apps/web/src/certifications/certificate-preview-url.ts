// Download may finish after the preview closes, even if transport was cancelled.
export async function certificatePreviewUrl(
  read: () => Promise<Blob>,
  signal: AbortSignal,
  urls: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'> = URL,
) {
  const blob = await read();
  signal.throwIfAborted();
  const url = urls.createObjectURL(blob);
  if (signal.aborted) {
    urls.revokeObjectURL(url);
    signal.throwIfAborted();
  }
  return url;
}
