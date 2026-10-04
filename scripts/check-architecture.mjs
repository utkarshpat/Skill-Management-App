import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleNames = new Set(['identity', 'access', 'organization', 'skills', 'ai', 'learning', 'workflows', 'dashboard', 'recommendations']);
const runtimeDependencies = {
  recommendations: ['access','learning'],
  dashboard: ['access'],
  identity: ['access'], access: [], organization: ['access'], learning: ['access'], workflows: ['access'],
  skills: ['access'], ai: ['access', 'organization', 'skills'],
};
const typeDependencies = {
  recommendations: ['access','learning','identity'],
  dashboard: ['access','identity','skills','learning','workflows'],
  identity: ['access'], access: ['identity'], organization: ['access'], learning: ['access', 'identity'], workflows: ['access', 'identity'],
  skills: ['access', 'identity'], ai: ['access', 'organization', 'skills', 'identity', 'learning', 'workflows'],
};
const normalize = value => value.replaceAll('\\', '/');
const owner = file => /^apps\/api\/src\/modules\/([^/]+)\//.exec(file)?.[1];

// Tokenize source so comments and unrelated string literals cannot masquerade as imports.
// Computed imports are rejected: dependencies must remain statically reviewable.
function tokens(source) {
  const result = [];
  const expression = /\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[A-Za-z_$][\w$]*|[^\s]/g;
  for (const match of source.matchAll(expression)) {
    const value = match[0];
    if (value.startsWith('//') || value.startsWith('/*')) continue;
    const quote = value[0];
    const string = quote === "'" || quote === '"' || quote === '`';
    result.push({ value: string ? value.slice(1, -1) : value, string, template: quote === '`' });
  }
  return result;
}

export function imports(source) {
  const list = tokens(source), result = [];
  for (let i = 0; i < list.length; i++) {
    const token = list[i];
    if (token.string || !['import', 'export', 'require'].includes(token.value)) continue;
    if (list[i + 1]?.value === '.') continue; // import.meta
    const typeOnly = list[i + 1]?.value === 'type';
    if (list[i + 1]?.value === '(') {
      const specifier = list[i + 2];
      const literal = specifier?.string && (!specifier.template || !specifier.value.includes('${')) && [')', ','].includes(list[i + 3]?.value);
      result.push({ specifier: literal ? specifier.value : null, typeOnly: false });
      continue;
    }
    if (token.value === 'require') continue;
    if (token.value === 'import' && list[i + 1]?.string) {
      result.push({ specifier: list[i + 1].value, typeOnly: false });
      continue;
    }
    for (let j = i + 1; j < list.length; j++) {
      if ([';', 'import', 'export'].includes(list[j].value) && !list[j].string) break;
      if (list[j].value === 'from' && !list[j].string && list[j + 1]?.string) {
        result.push({ specifier: list[j + 1].value, typeOnly });
        break;
      }
    }
  }
  return result;
}

export function checkSources(sources) {
  const errors = [];
  for (const [file, source] of sources) {
    const module = owner(file);
    if (module && !moduleNames.has(module)) errors.push(`${file}: unregistered module ${module}`);
    for (const dependency of imports(source)) {
      const specifier = dependency.specifier;
      const reject = reason => errors.push(`${file}: ${specifier ?? 'computed import'}: ${reason}`);
      if (specifier === null) { reject('computed imports are not allowed'); continue; }
      if (specifier.includes('\\') || specifier.startsWith('/') || /^[A-Za-z]:/.test(specifier) || specifier.startsWith('#')) {
        reject('use a relative import or a declared external package'); continue;
      }
      if (!specifier.startsWith('.')) {
        if (specifier.startsWith('@capability/')) reject('apps communicate through HTTP, not workspace source imports');
        continue;
      }
      const resolved = normalize(path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)));
      const candidates = [resolved, resolved.replace(/\.js$/, '.ts'), resolved.replace(/\.js$/, '.tsx'), resolved + '/index.ts', resolved + '/index.tsx'];
      const target = candidates.find(candidate => sources.has(candidate));
      // Non-source assets (CSS, images) are outside this source dependency check.
      if (!target && /\.(?:js|tsx?|mjs)$/.test(resolved)) { reject('source target is missing'); continue; }
      const destination = target ?? resolved;
      if (file.startsWith('apps/web/') && destination.startsWith('apps/api/')) reject('frontend cannot import backend implementation');
      if (file.startsWith('apps/api/') && destination.startsWith('apps/web/')) reject('backend cannot import frontend implementation');
      if (file.startsWith('apps/api/src/shared/') && !destination.startsWith('apps/api/src/shared/')) reject('shared infrastructure cannot depend on modules or bootstrap');
      if (!module) continue;
      if (!destination.startsWith('apps/api/src/shared/') && !destination.startsWith('apps/api/src/modules/')) {
        reject('modules cannot depend on composition roots or other apps'); continue;
      }
      const other = owner(destination);
      if (other && other !== module) {
        if (destination !== `apps/api/src/modules/${other}/index.ts`) reject('cross-module imports must use the public index');
        const allowed = (dependency.typeOnly ? typeDependencies : runtimeDependencies)[module] ?? [];
        if (!allowed.includes(other)) reject('dependency is outside the declared module graph');
      }
    }
  }
  return errors;
}

export function repositorySources(root) {
  const sources = new Map();
  const scan = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) scan(file);
      else if (/\.(?:tsx?|mjs)$/.test(file)) sources.set(normalize(path.relative(root, file)), readFileSync(file, 'utf8'));
    }
  };
  for (const directory of ['apps/api/src', 'apps/web/src']) scan(path.join(root, directory));
  return sources;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  if (!existsSync(path.join(root, 'apps/api/src'))) throw new Error('Repository source is missing.');
  const errors = checkSources(repositorySources(root));
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log('Architecture boundaries passed: nine modules, shared infrastructure and separate frontend.');
}
