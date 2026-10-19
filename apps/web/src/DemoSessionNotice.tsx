import { useEffect, useRef, useState } from 'react';
import { isDemoSession, expireDemoSession, demoSessionFetch } from './auth';
import { startDemoSession, type DemoSessionNotice as Notice } from './demo-session';

export function DemoSessionNotice() {
  const [notice, setNotice] = useState<Notice>();
  const session = useRef<ReturnType<typeof startDemoSession>>(undefined);
  useEffect(() => {
    if (!isDemoSession()) return;
    session.current = startDemoSession(setNotice, expireDemoSession, undefined, demoSessionFetch);
    return () => session.current?.stop();
  }, []);
  if (!notice || (!notice.warning && !notice.error)) return null;
  return (
    <div className="workspace-refresh-warning" role="status" aria-live="polite">
      {notice.error ||
        (notice.absolute
          ? `Your demo workday session ends in ${notice.minutes} minutes. Save your work, then sign in again.`
          : `Your demo session ends in ${notice.minutes} minutes due to inactivity.`)}{' '}
      {!notice.absolute && (
        <button disabled={notice.busy} onClick={() => void session.current?.continueSession()}>
          {notice.busy ? 'Extending session…' : 'Continue session'}
        </button>
      )}
    </div>
  );
}
