// Explicit local UI fixture; not an entry in the production build. No save callbacks or SQL.
// From apps/web: VERCEL=1 npx vite --host 127.0.0.1 --port 5186
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FormDialog } from '../src/FormDialog';
import { CertificationDialog } from '../src/certifications/CertificationDialog';
import type { CertificationRecord } from '../src/certifications/types';
import '../src/certifications/certifications.css';
import { SkillClaimWizard, type SkillDraft } from '../src/SkillClaimWizard';
import '../src/styles.css';
import '../src/ui.css';
import '../src/theme.css';
import '../src/toast.css';
const text = Array.from(
  { length: 40 },
  (_, i) => `Long field line ${i + 1}: ${'unbroken'.repeat(18)}`,
).join('\n');
function Preview() {
  const [kind, setKind] = useState<'plain' | 'wizard' | 'certification' | undefined>();
  const [saved, setSaved] = useState<CertificationRecord>();
  const [canSubmit, setCanSubmit] = useState(true);
  const [failSave, setFailSave] = useState(false);
  const [page, setPage] = useState(2);
  const [draft, setDraft] = useState<SkillDraft>({
    id: crypto.randomUUID(),
    revision: 0,
    skillId: 'preview',
    definitionRevision: 1,
    rank: 3,
    experienceMonths: 3,
    lastUsedOn: '2026-09-30',
    description: text,
    projects: text,
    evidence: text,
  });
  return (
    <main>
      <h1>Local dialog scroll fixtures</h1>
      <p>Synthetic long content. No changes are saved.</p>
      <button onClick={() => setKind('certification')}>Open certification wizard</button>
      <label>
        <input type="checkbox" checked={canSubmit} onChange={e => setCanSubmit(e.target.checked)} />
        Manager available
      </label>
      <label>
        <input type="checkbox" checked={failSave} onChange={e => setFailSave(e.target.checked)} />
        Simulate save failure
      </label>
      {saved && (
        <p>
          Fixture saved: {saved.certificationName} ({saved.status}), revision {saved.revision}
        </p>
      )}
      {kind === 'certification' && (
        <CertificationDialog
          initial={saved}
          canSubmit={canSubmit}
          onClose={() => setKind(undefined)}
          onSave={async (id, revision, fields, submit) => {
            if (failSave) throw new Error('Synthetic save failure. Your entries are still here.');
            setSaved({
              ...fields,
              id,
              revision: revision + 1,
              personId: 'fixture',
              name: 'Fixture',
              employeeCode: 'TEST',
              status: submit ? 'SUBMITTED' : 'DRAFT',
              feedback: '',
              canEdit: !submit,
              canSubmit: !submit && canSubmit,
              canReview: false,
            });
            return revision + 1;
          }}
        />
      )}
      <button onClick={() => setKind('plain')}>Open long popup</button>
      <button
        onClick={() => {
          setPage(2);
          setKind('wizard');
        }}
      >
        Open skill review preview
      </button>
      {kind === 'plain' && (
        <FormDialog
          title="Long popup"
          onClose={() => setKind(undefined)}
          footer={<button onClick={() => setKind(undefined)}>Done</button>}
        >
          <p style={{ whiteSpace: 'pre-wrap' }}>{text.repeat(3)}</p>
          <label>
            Last field
            <input aria-label="Last field" />
          </label>
        </FormDialog>
      )}
      {kind === 'wizard' && (
        <SkillClaimWizard
          draft={draft}
          onDraft={setDraft}
          selected={{
            id: 'preview',
            name: 'AI Governance',
            category: 'Data / AI / ML',
            definitionRevision: 1,
            levels: Array.from({ length: 5 }, (_, i) => ({
              rank: i + 1,
              name: ['Awareness', 'Foundation', 'Practitioner', 'Advanced', 'Expert'][i],
              description: 'Synthetic criteria',
            })),
          }}
          onSelect={() => {}}
          options={{ skills: [], total: 0, page: 1, pageSize: 3 }}
          loading={false}
          busy={false}
          error=""
          page={page}
          onPage={setPage}
          search=""
          onSearch={() => {}}
          category=""
          onCategory={() => {}}
          onResultsPage={() => {}}
          onSave={() => {}}
          onClose={() => setKind(undefined)}
        />
      )}
    </main>
  );
}
if (['127.0.0.1', 'localhost'].includes(window.location.hostname))
  createRoot(document.getElementById('root')!).render(<Preview />);
