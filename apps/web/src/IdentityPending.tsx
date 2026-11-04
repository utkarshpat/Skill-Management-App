import { useEffect, useState } from 'react';
import { authenticatedFetch, isDemoSession } from './auth';

// A successful Microsoft sign-in does not imply employee membership or activation.
export function IdentityPending() {
  const [identity, setIdentity] = useState<{ tenantId: string; objectId: string }>();
  useEffect(() => {
    if (isDemoSession()) return;
    const controller = new AbortController();
    void authenticatedFetch('/api/auth/identity', { signal: controller.signal })
      .then(async response => {
        if (response.ok) {
          const body = await response.json();
          if (!controller.signal.aborted) setIdentity(body);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return (
    <section aria-label="Company sign-in">
      {identity && (
        <>
          <p>
            Your Microsoft identity is verified. An administrator must review your employee binding
            before workspace access is enabled.
          </p>
          <dl>
            <dt>Tenant ID</dt>
            <dd>{identity.tenantId}</dd>
            <dt>Object ID</dt>
            <dd>{identity.objectId}</dd>
          </dl>
          <p>
            Share these IDs and your employee code with your administrator. Do not share your access
            token.
          </p>
        </>
      )}
    </section>
  );
}
