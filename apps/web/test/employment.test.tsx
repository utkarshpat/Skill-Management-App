import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmploymentFields, EmploymentSummary, EmploymentChange } from '../src/EmploymentDetails';
test('employment form is optional, bounded and distinguishes work information from access', () => {
  const html = renderToStaticMarkup(
    <EmploymentFields value={{ jobTitle: 'Engineer', grade: 'G4' }} onChange={() => {}} />,
  );
  assert.match(html, /Business job title/);
  assert.match(html, /maxLength="100"/);
  assert.match(html, /maxLength="40"/);
  assert.match(html, /aria-describedby="employment-help"/);
  assert.doesNotMatch(html, /required=/);
  assert.match(html, /Leave blank to clear/);
  assert.match(html, /Neither field assigns access/);
});
test('own summary distinguishes unassigned, unsupported, loading and failed values and escapes content', () => {
  const assigned = renderToStaticMarkup(
    <EmploymentSummary value={{ jobTitle: '<script>Head</script>', grade: 'G4' }} />,
  );
  assert.match(assigned, /&lt;script&gt;/);
  assert.match(assigned, /G4/);
  assert.doesNotMatch(assigned, /<script>|<input|<button/);
  assert.match(
    renderToStaticMarkup(<EmploymentSummary value={{ jobTitle: null, grade: null }} />),
    /Not assigned/,
  );
  assert.match(renderToStaticMarkup(<EmploymentSummary value={{}} />), /Unavailable/);
  assert.match(renderToStaticMarkup(<EmploymentSummary loading />), /Loading work details/);
  const failed = renderToStaticMarkup(<EmploymentSummary failed />);
  assert.match(failed, /Unavailable/);
  assert.doesNotMatch(failed, /Not assigned|Loading/);
});
test('confirmation shows server-normalized before and after values including clearing', () => {
  const html = renderToStaticMarkup(
    <EmploymentChange
      before={{ jobTitle: 'Engineer', grade: 'G4' }}
      after={{ jobTitle: 'Lead', grade: null }}
    />,
  );
  assert.match(html, /Engineer/);
  assert.match(html, /Lead/);
  assert.match(html, /G4/);
  assert.match(html, /Not assigned/);
  assert.match(html, /changes to/);
  assert.match(html, /do not change effective access/);
});
