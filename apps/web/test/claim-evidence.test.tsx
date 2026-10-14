import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { prepareSkillEvidenceFile } from '../src/evidence-image';
import { EvidenceVisibility } from '../src/EvidenceVisibility';

test('Editable evidence explains private new uploads and previously submitted visibility', () => {
  for (const status of ['DRAFT', 'CHANGES_REQUESTED', 'REJECTED'] as const) {
    const html = renderToStaticMarkup(<EvidenceVisibility status={status} />);
    assert.match(html, /New files stay private until you submit this claim for review/);
    assert.match(
      html,
      /Previously submitted files remain visible to your current assigned reviewer/,
    );
    assert.doesNotMatch(html, /Only files included in the latest submission/);
  }
});
test('Reviewer evidence explains its latest-submission boundary without upload controls', () => {
  const html = renderToStaticMarkup(<EvidenceVisibility reviewer status="CHANGES_REQUESTED" />);
  assert.match(html, /Only files included in the latest submission are shown/);
  assert.match(html, /New draft files stay private until resubmission/);
  assert.doesNotMatch(html, /type="file"|New files stay private until you submit/);
});
test('Submitted and approved owner views do not advertise editing', () => {
  for (const status of ['SUBMITTED', 'APPROVED'] as const) {
    assert.equal(renderToStaticMarkup(<EvidenceVisibility status={status} />), '');
  }
});

test('PDF evidence reaches the API unchanged and rejects empty or oversized files before upload', async () => {
  const file = new File(['%PDF-test'], 'proof.pdf', { type: 'application/pdf' });
  assert.equal(await prepareSkillEvidenceFile(file), file);
  await assert.rejects(
    prepareSkillEvidenceFile(new File([], 'empty.pdf', { type: 'application/pdf' })),
    /10 MB/,
  );
  await assert.rejects(
    prepareSkillEvidenceFile(
      new File([new Uint8Array(10485761)], 'large.pdf', { type: 'application/pdf' }),
    ),
    /10 MB/,
  );
  await assert.rejects(
    prepareSkillEvidenceFile(new File(['<svg/>'], 'active.svg', { type: 'image/svg+xml' })),
    /JPEG, PNG or WebP/,
  );
});
