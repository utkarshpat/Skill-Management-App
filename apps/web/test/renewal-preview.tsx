// Local UI acceptance fixture. It never calls SQL, storage, real AI or a save endpoint.
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { BrowserRouter } from 'react-router';
import { CapabilityComposer } from '../src/capabilities/CapabilityComposer';
import { LearningCompletionNextSteps } from '../src/LearningCompletionNextSteps';
import { Notifications } from '../src/Notifications';
import { initializeAuth } from '../src/auth';
import '../src/styles.css';
import '../src/theme.css';
import '../src/ui.css';
import '../src/learning-home.css';
const skillId = '00000000-0000-4000-8000-000000000001',
  claimId = '00000000-0000-4000-8000-000000000002',
  oldId = '00000000-0000-4000-8000-000000000003';
const today = new Date().toISOString().slice(0, 10);
const fixtureAt = new Date().toISOString();
const levels = ['Foundation', 'Autonomous', 'Experienced', 'Expert'].map((name, i) => ({
  rank: i + 1,
  name,
  description: 'QA criterion ' + (i + 1),
}));
const choice = {
  id: skillId,
  name: 'QA Cloud skill',
  category: 'QA',
  definitionRevision: 1,
  levels,
};
window.fetch = async (input, init) => {
  const path = String(input);
  let data: any;
  if (path === '/api/dev-login') data = { mode: 'local-demo', signedIn: true, people: [] };
  else if (path.endsWith('/availability')) data = { aiAvailable: false, fileAvailable: true };
  else if (path.endsWith('/options'))
    data = {
      claims: [
        {
          id: claimId,
          skillId,
          name: choice.name,
          category: 'QA',
          status: 'APPROVED',
          revision: 1,
          definitionRevision: 1,
          rank: 2,
          experienceMonths: 12,
          description: 'QA saved experience',
        },
      ],
      certifications: [],
      definitions: [],
    };
  else if (path.startsWith('/api/my-skills/catalogue')) data = { skills: [choice], total: 1 };
  else if (path.includes('/evidence')) data = { items: [], revision: 1 };
  else if (path === '/api/notifications')
    data = {
      personId: 'qa',
      items: [
        {
          id: 'qa-review',
          at: fixtureAt,
          title: 'Skill review completed',
          actorName: 'QA Manager',
          actionLabel: 'Review completed',
          subject: 'QA Cloud skill · QA Cloud certification',
          body: '1 skill, 1 certificate · 1 approved; 1 changes requested',
          href: '/my-skills?submission=' + oldId,
        },
        {
          id: 'qa-renew',
          at: fixtureAt,
          title: 'Certificate expires in 14 days',
          body: 'QA Cloud certification expires soon. Upload the renewed certificate if earned.',
          href: '/certifications?renew=' + oldId,
        },
      ],
    };
  else if (path === '/api/assistant/navigation')
    data = { canReviewOwnSkill: true, pages: [{ url: '/my-skills' }] };
  else if (path === '/api/assistant')
    data = {
      reply:
        'Based on this completed QA plan, explore the published QA Cloud certification, or prepare a QA Cloud skill claim based on your experience. Completion does not award certification.',
    };
  else throw Error('QA fixture blocked request: ' + path + ' ' + (init?.method ?? 'GET'));
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
};
await initializeAuth();
document.documentElement.dataset.theme = 'light';
function Preview() {
  const [open, setOpen] = useState(true);
  return (
    <BrowserRouter>
      <main>
        <h1>Local QA — no data is saved</h1>
        <button onClick={() => setOpen(true)}>Open renewal</button>
        <Notifications id="qa-notifications" />
        <LearningCompletionNextSteps
          plans={[
            {
              id: oldId,
              title: 'QA Cloud learning',
              revision: 1,
              status: 'ACTIVE',
              goal: 'Cloud',
              timezone: 'UTC',
              dailyMinutes: 30,
              targetDate: today,
              tasks: [
                {
                  id: claimId,
                  title: 'QA exercise',
                  plannedDate: today,
                  estimatedMinutes: 30,
                  completedAt: new Date().toISOString(),
                },
              ],
            },
          ]}
        />
        {open && (
          <CapabilityComposer
            renewal={{
              id: oldId,
              skillIds: [skillId],
              fields: {
                certificationName: 'QA Cloud certification',
                provider: 'QA Issuer',
                category: 'Cloud',
                certificationDate: today,
                expiryDate: '',
                credentialId: '',
                credentialUrl: '',
                notes: '',
              },
            }}
            onClose={() => setOpen(false)}
            onSaved={() => {
              throw Error('Saving is blocked in this fixture');
            }}
          />
        )}
      </main>
    </BrowserRouter>
  );
}
createRoot(document.getElementById('root')!).render(<Preview />);
