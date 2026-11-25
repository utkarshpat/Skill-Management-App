import './support/phase-two';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { ProfileCompleteness, type ProfileCompletenessDetails } from '../src/ProfileCompleteness';
import { PrimaryCapabilitySummary } from '../src/PrimaryCapability';
const details: ProfileCompletenessDetails = {
  filled: 4,
  total: 6,
  status: 'INCOMPLETE',
  items: [
    { key: 'name', label: 'Full name', state: 'COMPLETE' },
    { key: 'employeeCode', label: 'Employee ID', state: 'COMPLETE' },
    { key: 'jobTitle', label: 'Business job title', state: 'COMPLETE' },
    { key: 'grade', label: 'Grade', state: 'COMPLETE' },
    { key: 'department', label: 'Department', state: 'MISSING' },
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
  assert.match(html, /Accounts\/Clients/);
  assert.doesNotMatch(html, /<dt>Department<\/dt>/);
  assert.equal(details.items.find(item => item.key === 'department')?.label, 'Department');
  assert.match(html, /Not assigned/);
  assert.match(html, /Needs administrator attention/);
  assert.doesNotMatch(html, /Full name|Employee ID|Business job title|<dt>Grade<\/dt>/);
  assert.match(html, /href="\/requests\?action=create"/);
  assert.doesNotMatch(html, /progress|<input|<select/);
  const denied = renderToStaticMarkup(<ProfileCompleteness details={details} />);
  assert.match(denied, /Ask your administrator to update/);
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
  assert.match(html, /Some profile fields couldn’t be checked/);
  assert.match(html, /Unavailable/);
  assert.doesNotMatch(html, /required fields complete|100%|0%/);
});
