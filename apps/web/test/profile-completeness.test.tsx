import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { ProfileCompleteness, type ProfileCompletenessDetails } from '../src/ProfileCompleteness';
import { PrimaryCapabilitySummary } from '../src/PrimaryCapability';
import { EmploymentChange } from '../src/EmploymentDetails';
const details: ProfileCompletenessDetails = {
  filled: 4,
  total: 6,
  status: 'INCOMPLETE',
  items: [
    { key: 'name', label: 'Full name', state: 'COMPLETE' },
    { key: 'employeeCode', label: 'Employee ID', state: 'COMPLETE' },
    { key: 'jobTitle', label: 'Business job title', state: 'COMPLETE' },
    { key: 'grade', label: 'Grade', state: 'MISSING' },
    { key: 'department', label: 'Department', state: 'COMPLETE' },
    { key: 'primaryCapability', label: 'Primary capability', state: 'NEEDS_ATTENTION' },
  ],
};
test('read-only capability separates selection from proficiency and preserves archived labels safely', () => {
  const html = renderToStaticMarkup(
    <PrimaryCapabilitySummary
      value={{
        primaryCapabilityId: 'legacy',
        primaryCapabilityName: '<script>Cloud</script>',
        primaryCapabilityStatus: 'ARCHIVED',
      }}
    />,
  );
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /needs administrator attention/);
  assert.match(html, /has not been removed/);
  assert.match(html, /not verified proficiency or access/);
  assert.doesNotMatch(html, /<input|<select|<button|<script>/);
  assert.match(
    renderToStaticMarkup(<PrimaryCapabilitySummary value={{ primaryCapabilityId: null }} />),
    /Not assigned/,
  );
  assert.match(renderToStaticMarkup(<PrimaryCapabilitySummary />), /Unavailable/);
  assert.doesNotMatch(renderToStaticMarkup(<PrimaryCapabilitySummary failed />), /Not assigned/);
});
test('checklist shows exact denominator, actionable missing states and authorized correction entry only', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <ProfileCompleteness details={details} canRequest />
    </MemoryRouter>,
  );
  assert.match(html, /4 of 6 required fields complete/);
  assert.match(html, /Not assigned/);
  assert.match(html, /Needs administrator attention/);
  assert.match(html, /Reporting manager.*not required/);
  assert.match(html, /Optional skills, experience, evidence and access templates/);
  assert.match(html, /href="\/requests\?action=create"/);
  assert.doesNotMatch(html, /progress|<input|<select/);
  const denied = renderToStaticMarkup(<ProfileCompleteness details={details} />);
  assert.doesNotMatch(denied, /href=/);
});
test('loading, failed and unavailable completeness never become a successful or zero-percent score', () => {
  assert.match(
    renderToStaticMarkup(<ProfileCompleteness loading />),
    /aria-busy="true".*Checking/s,
  );
  assert.match(renderToStaticMarkup(<ProfileCompleteness failed />), /could not be confirmed/);
  const html = renderToStaticMarkup(
    <ProfileCompleteness
      details={{
        ...details,
        status: 'UNAVAILABLE',
        items: [{ key: 'grade', label: 'Grade', state: 'UNAVAILABLE' }],
      }}
    />,
  );
  assert.match(html, /not a confirmed completeness score/);
  assert.match(html, /Unavailable/);
  assert.doesNotMatch(html, /100%|0%/);
});
test('preview uses reviewed capability names and explicit unassignment', () => {
  const html = renderToStaticMarkup(
    <EmploymentChange
      before={{
        primaryCapabilityId: 'old',
        primaryCapabilityName: 'Cloud',
        primaryCapabilityStatus: 'PUBLISHED',
      }}
      after={{
        primaryCapabilityId: null,
        primaryCapabilityName: null,
        primaryCapabilityStatus: null,
      }}
    />,
  );
  assert.match(html, /Primary capability/);
  assert.match(html, /Cloud/);
  assert.match(html, /changes to.*Not assigned/s);
});
