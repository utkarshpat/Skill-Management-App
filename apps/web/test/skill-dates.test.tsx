import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { SkillExperienceDates } from '../src/SkillExperienceDates';
import { formatSkillDate, skillDateError } from '../src/skill-dates';

const at = new Date('2026-10-05T23:59:59Z');
test('last-used validation accepts unknown and real dates but rejects future and impossible dates', () => {
  for (const value of [undefined, null, '', '2024-02-29', '2026-10-05'])
    assert.equal(skillDateError(value, at), '');
  for (const value of ['2026-10-06', '2025-02-29', '2026-04-31', '0000-01-01', '2026-1-01'])
    assert.notEqual(skillDateError(value, at), '');
  assert.equal(formatSkillDate(null), 'Not provided');
  assert.equal(formatSkillDate(undefined), 'Not provided');
  assert.equal(formatSkillDate('2024-02-29'), '29 Feb 2024');
});
test('experience form exposes an optional date, UTC limit and associated inline recovery message', () => {
  const render = (lastUsedOn: string | null) =>
    renderToStaticMarkup(
      <SkillExperienceDates
        value={{ experienceMonths: 12, lastUsedOn }}
        onChange={() => {}}
        at={at}
      />,
    );
  const empty = render(null);
  assert.match(empty, /for="skill-last-used"/);
  assert.match(empty, /type="date".*max="2026-10-05"/);
  assert.match(empty, /aria-describedby="skill-last-used-help"/);
  assert.match(empty, /Leave blank if unsure/);
  assert.doesNotMatch(empty, /required=|role="alert"/);
  const invalid = render('2026-10-06');
  assert.match(invalid, /aria-invalid="true"/);
  assert.match(invalid, /aria-describedby="skill-last-used-help skill-last-used-error"/);
  assert.match(invalid, /id="skill-last-used-error".*role="alert"/);
  assert.match(invalid, /cannot be after today/);
  assert.match(render('2024-02-29'), /value="2024-02-29"/);
});
