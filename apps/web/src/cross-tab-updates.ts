type UpdateChannel = Pick<BroadcastChannel, 'postMessage' | 'close' | 'onmessage'>;

export function subscribeWorkspaceUpdates(
  personId: string,
  target: EventTarget = window,
  createChannel: () => UpdateChannel | undefined = () =>
    typeof BroadcastChannel === 'undefined'
      ? undefined
      : new BroadcastChannel('skill-workspace-updates'),
) {
  const channel = createChannel();
  if (!channel) return () => {};
  let pending: ReturnType<typeof setTimeout> | undefined;
  const changed = () => {
    if (pending !== undefined) return;
    pending = setTimeout(() => {
      pending = undefined;
      channel.postMessage({ version: 1, personId });
    }, 25);
  };
  const events = ['notifications-updated', 'own-skills-updated', 'learning-updated'];
  for (const event of events) target.addEventListener(event, changed);
  channel.onmessage = event => {
    if (event.data?.version === 1 && event.data?.personId === personId)
      target.dispatchEvent(new Event('notifications-remote-updated'));
  };
  return () => {
    if (pending !== undefined) clearTimeout(pending);
    for (const event of events) target.removeEventListener(event, changed);
    channel.onmessage = null;
    channel.close();
  };
}
