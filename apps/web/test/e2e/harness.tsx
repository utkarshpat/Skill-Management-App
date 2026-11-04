import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { useEffect, useState } from 'react';
import { BusinessWorkflows } from '../../src/business/BusinessWorkflows';
import { CatalogueCertificationPicker } from '../../src/CatalogueCertificationPicker';
import { SkillReviews } from '../../src/SkillReviews';
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
  const [ready, setReady] = useState(false),
    [value, setValue] = useState<any[]>([]);
  useEffect(() => {
    void initializeAuth().then(() => setReady(true));
  }, []);
  if (!ready) return <p>Preparing synthetic fixture</p>;
  const mode = new URLSearchParams(location.search).get('fixture');
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
