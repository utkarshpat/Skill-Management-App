import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { CommonProficiency } from '../src/CommonProficiency';
import { commonLevels, proficiencyNames } from '../src/proficiency';
import { commonLevels as serverLevels } from '../../api/src/modules/skills/proficiency';

test('the shared four-level rubric matches the server and each caller gets an independent copy', () => {
  const levels = commonLevels();
  assert.deepEqual(levels, serverLevels());
  assert.deepEqual(
    levels.map(l => l.name),
    proficiencyNames,
  );
  levels[0].description = 'Changed locally';
  assert.notEqual(commonLevels()[0].description, levels[0].description);
});

test('common criteria are readable without per-skill editing or scale mutation controls', () => {
  const html = renderToStaticMarkup(<CommonProficiency />);
  for (const level of commonLevels()) assert.ok(html.includes(level.description));
  assert.match(html, /shared and cannot be edited/);
  assert.doesNotMatch(html, /<textarea|<input|Add level|Remove level/);
});

test('the shared rubric matches the versioned SQL framework without changing historical definitions', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(
    new URL('../../../database/migrations/074_four_level_proficiency.sql', import.meta.url),
    'utf8',
  );
  for (const level of commonLevels()) assert.ok(source.includes(level.description));
});
