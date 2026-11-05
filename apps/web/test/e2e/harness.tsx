import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { useEffect, useState } from 'react';
import { BusinessWorkflows } from '../../src/business/BusinessWorkflows';
import { CatalogueCertificationPicker } from '../../src/CatalogueCertificationPicker';
import { SkillReviews } from '../../src/SkillReviews';
import { CapabilityComposer } from '../../src/capabilities/CapabilityComposer';
import { BusinessOperations } from '../../src/business/BusinessOperations';
import { BusinessAdministration } from '../../src/business/BusinessAdministration';
import { CapabilityReview } from '../../src/capabilities/CapabilityReview';
import { TeamCapability } from '../../src/TeamCapability';
import { initializeAuth } from '../../src/auth';
import { ThemeProvider } from '../../src/Theme';
import '../../src/styles.css';
import '../../src/theme.css';
import '../../src/ui.css';
import '../../src/modern-ui.css';
const context = {
  actorId: '33333333-3333-4333-8333-333333333333',
  canApprove: true,
  canAmend: true,
};
function Harness() {
  const [outcome, setOutcome] = useState('');
  const [ready, setReady] = useState(false),
    [value, setValue] = useState<any[]>([]);
  useEffect(() => {
    void initializeAuth().then(() => setReady(true));
  }, []);
  if (!ready) return <p>Preparing synthetic fixture</p>;
  const mode = new URLSearchParams(location.search).get('fixture');
  if (outcome) return <p role="status">{outcome}</p>;
  if (mode === 'capability-review' || mode === 'capability-history')
    return (
      <CapabilityReview
        id="88888888-8888-4888-8888-000000000001"
        employeeName="Aditi Menon"
        readOnly={mode === 'capability-history'}
        onClose={() => setOutcome('Review closed')}
        onSaved={() => setOutcome('Review decision confirmed')}
      />
    );
  if (mode === 'team')
    return <TeamCapability onReviews={id => setOutcome('Review queue for ' + id)} canAskAi />;
  if (mode === 'analytics') return <BusinessOperations />;
  if (mode === 'access-profiles')
    return (
      <BusinessAdministration
        onSaved={() => setOutcome('Configuration saved and access refreshed')}
      />
    );
  if (mode === 'composer')
    return (
      <CapabilityComposer
        initialSkill={{ id: '11111111-1111-4111-8111-000000000001', name: 'SQL' }}
        onClose={() => setOutcome('Form closed without saving')}
        onSaved={() => setOutcome('Capability saved')}
      />
    );
  if (mode === 'picker')
    return (
      <>
        <button
          onClick={() =>
            setValue([
              {
                id: 'cert-one',
                name: 'Existing certificate',
                provider: 'Synthetic issuer',
                active: true,
              },
            ])
          }
        >
          Load existing value
        </button>
        <CatalogueCertificationPicker value={value} onChange={setValue} />
      </>
    );
  if (mode === 'reviews') return <SkillReviews unified />;
  return <BusinessWorkflows context={context as any} view="amendments" catalogueMode={false} />;
}
createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <ThemeProvider>
      <Harness />
    </ThemeProvider>
  </BrowserRouter>,
);
