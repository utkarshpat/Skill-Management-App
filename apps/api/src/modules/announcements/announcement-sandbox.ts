import { parseFragment, serialize, type DefaultTreeAdapterTypes } from 'parse5';
import postcss from 'postcss';
import { AccessError } from '../../shared/errors.js';

export interface DesignBinding {
  elementId: string;
  kind: 'content' | 'identity' | 'field' | 'form' | 'action' | 'vote' | 'image';
  key: string;
}
interface Configuration {
  kind: string;
  fields: { id: string; type: string }[];
  options: string[];
}
export function announcementBindings(def: Configuration): DesignBinding[] {
  return [
    { elementId: 'ann-title', kind: 'content', key: 'title' },
    { elementId: 'ann-message', kind: 'content', key: 'message' },
    ...(def.kind === 'FORM'
      ? [
          { elementId: 'ann-form', kind: 'form', key: 'response' },
          { elementId: 'ann-open', kind: 'action', key: 'open-form' },
          { elementId: 'ann-submit', kind: 'action', key: 'submit' },
          { elementId: 'ann-name', kind: 'identity', key: 'name' },
          { elementId: 'ann-email', kind: 'identity', key: 'email' },
          { elementId: 'ann-employee-id', kind: 'identity', key: 'employeeId' },
          ...def.fields.map(field => ({
            elementId: 'ann-field-' + field.id,
            kind: 'field',
            key: field.id,
          })),
        ]
      : def.options.map((_option, index) => ({
          elementId: 'ann-vote-' + index,
          kind: 'vote',
          key: String(index),
        }))),
  ] as DesignBinding[];
}
const tags = new Set(
  'div span section main article header footer nav aside h1 h2 h3 h4 h5 h6 p strong em b i u s small sup sub blockquote ul ol li dl dt dd figure figcaption img table caption thead tbody tfoot tr th td colgroup col br hr label input textarea select option optgroup button form fieldset legend details summary'.split(
    ' ',
  ),
);
const attrs = new Set(
  'id class role title for type name value placeholder required readonly disabled checked selected multiple min max step minlength maxlength rows cols autocomplete inputmode pattern aria-label aria-labelledby aria-describedby aria-live aria-atomic aria-hidden aria-required aria-invalid aria-expanded tabindex alt width height colspan rowspan scope open'.split(
    ' ',
  ),
);
function fail(message: string): never {
  throw new AccessError(400, message);
}
function safeCss(css: string) {
  if (
    css.length > 20_000 ||
    /[\\]|<\/|\b(?:url|image-set|expression)\s*\(|javascript:|\bbehavior\s*:/i.test(css)
  )
    fail('Design CSS cannot load resources or execute code.');
  try {
    const tree = postcss.parse(css);
    tree.walkAtRules(rule => {
      if (
        !['media', 'supports', 'keyframes', '-webkit-keyframes', 'container', 'layer'].includes(
          rule.name.toLowerCase(),
        )
      )
        fail('Unsupported design CSS rule.');
    });
  } catch (error) {
    if (error instanceof AccessError) throw error;
    fail('Design CSS is invalid.');
  }
  return css;
}
export function sandboxDesign(candidate: Record<string, unknown>) {
  if (
    typeof candidate.html !== 'string' ||
    !candidate.html.trim() ||
    candidate.html.length > 30_000 ||
    typeof candidate.css !== 'string'
  )
    fail('Check sandbox design size.');
  if (!Array.isArray(candidate.bindings) || candidate.bindings.length > 50)
    fail('Design must provide a bindings array.');
  const bindings = candidate.bindings.map(raw => {
    const item = raw as DesignBinding;
    if (
      !item ||
      typeof item.elementId !== 'string' ||
      !/^ann-[\w-]{1,80}$/.test(item.elementId) ||
      !['content', 'identity', 'field', 'form', 'action', 'vote', 'image'].includes(item.kind) ||
      typeof item.key !== 'string' ||
      item.key.length > 80
    )
      fail('Invalid design binding.');
    return { elementId: item.elementId, kind: item.kind, key: item.key };
  });
  if (new Set(bindings.map(b => b.elementId)).size !== bindings.length)
    fail('Design bindings must use unique element IDs.');
  const fragment = parseFragment(candidate.html);
  const elements = new Map<string, DefaultTreeAdapterTypes.Element>();
  let count = 0;
  const visit = (node: DefaultTreeAdapterTypes.ChildNode, depth: number) => {
    if (++count > 1000 || depth > 30) fail('Design HTML is too complex.');
    if (!('tagName' in node)) return;
    if (!tags.has(node.tagName) || node.namespaceURI !== 'http://www.w3.org/1999/xhtml')
      fail('Design HTML contains an unsupported element.');
    for (const attr of node.attrs) {
      if (attr.namespace || !attrs.has(attr.name) || attr.value.length > 2000)
        fail('Design HTML contains an unsupported attribute.');
    }
    const elementId = node.attrs.find(a => a.name === 'id')?.value;
    if (elementId) {
      if (!/^ann-[\w-]{1,80}$/.test(elementId) || elements.has(elementId))
        fail('HTML IDs must be unique and start with ann-.');
      elements.set(elementId, node);
    }
    if (
      ['input', 'textarea', 'select', 'button', 'form'].includes(node.tagName) &&
      !bindings.some(b => b.elementId === elementId)
    )
      fail('Every interactive element needs a configured binding.');
    if (
      node.tagName === 'input' &&
      !['text', 'email', 'checkbox', 'date', 'number', 'radio', undefined].includes(
        node.attrs.find(a => a.name === 'type')?.value,
      )
    )
      fail('Unsupported design input type.');
    for (const child of node.childNodes) visit(child, depth + 1);
  };
  fragment.childNodes.forEach(node => visit(node, 0));
  for (const binding of bindings) {
    const element = elements.get(binding.elementId);
    if (!element) fail('A design binding points to a missing element.');
    const expected =
      binding.kind === 'identity'
        ? ['input']
        : binding.kind === 'field'
          ? ['input', 'textarea', 'select']
          : binding.kind === 'form'
            ? ['form']
            : ['action', 'vote'].includes(binding.kind)
              ? ['button']
              : binding.kind === 'image'
                ? ['img']
                : ['div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'strong'];
    if (!expected.includes(element.tagName)) fail('A design binding has an incompatible element.');
    if (binding.kind === 'content' && element.childNodes.some(node => 'tagName' in node))
      fail('Content bindings must use text-only elements.');
  }
  return {
    format: 'sandbox-v1' as const,
    html: serialize(fragment),
    css: safeCss(candidate.css),
    bindings,
  };
}
export function checkAnnouncementBindings(
  def: Configuration & { design?: { format?: string; bindings?: DesignBinding[]; html: string } },
) {
  if (def.design?.format !== 'sandbox-v1') return;
  const expected = announcementBindings(def);
  const supplied = def.design.bindings ?? [];
  if (
    expected.some(
      b => !supplied.some(x => x.elementId === b.elementId && x.kind === b.kind && x.key === b.key),
    ) ||
    supplied.some(
      b =>
        !expected.some(x => x.elementId === b.elementId && x.kind === b.kind && x.key === b.key) &&
        !(b.kind === 'image' && b.elementId === 'ann-image' && b.key === 'image'),
    )
  )
    fail('Design bindings must match the current form or poll configuration.');
  if (def.kind === 'FORM') {
    const fragment = parseFragment(def.design.html);
    const nodes: DefaultTreeAdapterTypes.Element[] = [];
    const visit = (node: DefaultTreeAdapterTypes.ChildNode) => {
      if ('tagName' in node) {
        nodes.push(node);
        node.childNodes.forEach(visit);
      }
    };
    fragment.childNodes.forEach(visit);
    let opener: DefaultTreeAdapterTypes.ParentNode | null | undefined = nodes.find(n =>
      n.attrs.some(a => a.name === 'id' && a.value === 'ann-open'),
    );
    while (opener) {
      if ('attrs' in opener && opener.attrs.some(a => a.name === 'id' && a.value === 'ann-form'))
        fail('ann-open must be outside ann-form.');
      opener = 'parentNode' in opener ? opener.parentNode : undefined;
    }
    if (nodes.some(n => n.tagName === 'fieldset' && n.attrs.some(a => a.name === 'disabled')))
      fail('Do not disable the configured response form.');
    for (const binding of supplied.filter(b => b.kind === 'identity' || b.kind === 'field')) {
      const node = nodes.find(n =>
        n.attrs.some(a => a.name === 'id' && a.value === binding.elementId),
      )!;
      const field = def.fields.find(f => f.id === binding.key);
      const expectedTag =
        binding.kind === 'identity'
          ? 'input'
          : field?.type === 'longText'
            ? 'textarea'
            : ['choice', 'rating'].includes(field?.type ?? '')
              ? 'select'
              : 'input';
      if (
        node.tagName !== expectedTag ||
        !nodes.some(
          n =>
            n.tagName === 'label' &&
            n.attrs.some(a => a.name === 'for' && a.value === binding.elementId),
        )
      )
        fail('Use the configured field type and an associated label.');
    }
    for (const binding of supplied.filter(
      b => b.kind === 'identity' || b.kind === 'field' || b.key === 'submit',
    )) {
      let node: DefaultTreeAdapterTypes.ParentNode | null | undefined = nodes.find(n =>
        n.attrs.some(a => a.name === 'id' && a.value === binding.elementId),
      );
      while (
        node &&
        !('attrs' in node && node.attrs.some(a => a.name === 'id' && a.value === 'ann-form'))
      )
        node = 'parentNode' in node ? node.parentNode : undefined;
      if (!node) fail('Response fields and submit button must belong to ann-form.');
    }
  }
}
