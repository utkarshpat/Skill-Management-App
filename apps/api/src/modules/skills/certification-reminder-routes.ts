import { timingSafeEqual } from 'node:crypto';
import type { Express } from 'express';

// Caller input never selects an account/person. Ordinary sessions cannot run jobs.
export function registerCertificationReminderJob(
  app: Express,
  job?: { secret: string; run: () => Promise<{ created: number }> },
) {
  app.get('/api/jobs/certification-expiry', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!job?.secret) {
      res.sendStatus(503);
      return;
    }
    const expected = Buffer.from(`Bearer ${job.secret}`);
    const supplied = Buffer.from(req.headers.authorization ?? '');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      res.sendStatus(401);
      return;
    }
    try {
      res.json({ ok: true, ...(await job.run()) });
    } catch {
      res.status(503).json({ error: { message: 'Credential reminder job failed. Retry later.' } });
    }
  });
}
