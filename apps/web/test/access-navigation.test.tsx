import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/AccessAdmin.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/access-navigation.css', import.meta.url), 'utf8');

test('People and Access navigation owns its styles before optional screens load', () => {
  assert.match(source, /import '\.\/access-navigation\.css';/);
  assert.match(
    source,
    /<nav className="access-section-tabs" aria-label="People and access sections">/,
  );
  assert.doesNotMatch(source, /<nav className="bo-tabs"/);
  assert.match(source, /state\?\.canManageUsers \? \[\['people', 'People'\]\]/);
  assert.match(source, /workspaceContext\?\.capabilities\.businessAdministration/);
  assert.match(source, /aria-current=\{tab === id \? 'page' : undefined\}/);
  assert.match(source, /setTab\(id as View\)/);
  assert.match(source, /<button\s+type="button"\s+key=\{id\}/);
});

test('section tabs support themed selection, keyboard focus and narrow layouts', () => {
  assert.match(css, /\.access-section-tabs \{[^}]*flex-wrap: wrap;/);
  assert.match(css, /\.access-section-tabs button \{[^}]*min-height: 44px;/);
  assert.match(css, /\.access-section-tabs button \{[^}]*overflow-wrap: anywhere;/);
  assert.match(css, /button\[aria-current='page'\] \{[^}]*background: var\(--accent-soft\);/);
  assert.match(css, /button\[aria-current='page'\] \{[^}]*color: var\(--accent-ink\);/);
  assert.match(css, /button:focus-visible \{[^}]*outline: 2px solid/);
  assert.match(css, /button:hover:not\(\[aria-current='page'\]\):not\(:disabled\)/);
  assert.match(css, /button:disabled \{[^}]*cursor: not-allowed;/);
  assert.doesNotMatch(css, /\.bo-tabs|\.bo-access-admin/);
});
