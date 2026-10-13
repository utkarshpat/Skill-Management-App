type Channel = Pick<BroadcastChannel, 'postMessage' | 'close' | 'onmessage'>;
const signal = 'demo-session-changed';

/** Cookies are shared between tabs. Messages only invalidate UI, never select or authorize an actor. */
export function connectDemoSessionChanges(
  onChange: () => void,
  create: () => Channel | undefined = () => {
    try {
      return typeof BroadcastChannel === 'undefined'
        ? undefined
        : new BroadcastChannel('skill-management-demo-session');
    } catch {
      return undefined;
    }
  },
) {
  const channel = create();
  let invalidated = false;
  if (channel)
    channel.onmessage = event => {
      if (event.data === signal && !invalidated) {
        invalidated = true;
        onChange();
      }
    };
  return {
    changed: () => channel?.postMessage(signal),
    close: () => {
      if (channel) {
        channel.onmessage = null;
        channel.close();
      }
    },
  };
}
