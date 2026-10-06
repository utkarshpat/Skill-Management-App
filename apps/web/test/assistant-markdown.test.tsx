import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import AssistantMarkdown, { assistantUrl } from '../src/AssistantMarkdown';
const render = (text: string) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <AssistantMarkdown>{text}</AssistantMarkdown>
    </MemoryRouter>,
  );
test('assistant renders semantic emphasis, ordered and unordered lists, code and GFM tables', () => {
  const html = render(
    '# Guide\n\n**Important** and *optional*.\n\n- One\n- Two\n\n1. First\n2. Second\n\n> Review this.\n\n`const`\n\n```js\nconst value = 1;\n```\n\n| Skill | Status |\n| --- | --- |\n| JS | Draft |',
  );
  for (const tag of [
    '<h2>',
    '<strong>Important</strong>',
    '<em>optional</em>',
    '<ul>',
    '<ol>',
    '<blockquote>',
    '<pre>',
    '<table>',
  ])
    assert.ok(html.includes(tag), tag);
  assert.doesNotMatch(html, /\*\*Important\*\*/);
});
test('model content cannot load tracking images, execute raw HTML or navigate to arbitrary destinations', () => {
  const html = render(
    '<script>alert(1)</script>\n\n<img src="https://tracking.invalid/pixel" onerror="alert(1)">\n\n![Remote](https://tracking.invalid/image)\n\n[Unsafe](javascript:alert%281%29) [External](https://tracking.invalid) [API](/api/access) [Skills](/my-skills)',
  );
  assert.doesNotMatch(html, /<script|<img|onerror=|href="(?:javascript:|https:|\/api)/);
  assert.doesNotMatch(html, /<a\b|href=/);
  assert.ok(html.includes('Skills'));
  for (const url of [
    '//evil.invalid',
    '/\\evil.invalid',
    'data:text/html,bad',
    '/api/access',
    'https://example.com',
  ])
    assert.equal(assistantUrl(url), '');
});
