import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { zipSync } = require('fflate');
const repository = fileURLToPath(new URL('../', import.meta.url));
const roots = ['apps/api/src', 'apps/web/src', 'apps/web/public'];
const required = [
  'package.json',
  'package-lock.json',
  'apps/api/package.json',
  'apps/api/tsconfig.json',
  'apps/api/scripts/build.mjs',
  'apps/web/package.json',
  'apps/web/tsconfig.json',
  'apps/web/vite.config.ts',
  'apps/web/index.html',
];
const sourceExtensions =
  /\.(?:ts|tsx|js|jsx|mjs|cjs|css|json|svg|png|jpg|jpeg|webp|ico|woff2?|ttf|txt|html|wasm)$/i;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const isPrivatePath = path =>
  path.split('/').some(segment => /^(?:\.|node_modules$|dist$|artifacts$)/i.test(segment)) ||
  /\.(?:pem|key|pfx|p12|bacpac|bak|log|publishsettings)$/i.test(path);

/** Explicit hosting-source allowlist: never zip the whole working directory. */
export async function appServicePackage(root, provenance = {}) {
  const sourceRoot = resolve(root);
  const contents = Object.create(null);
  async function add(path) {
    if (isPrivatePath(path)) return;
    const absolute = resolve(sourceRoot, path);
    if (relative(sourceRoot, absolute).startsWith('..')) throw Error('Invalid package path.');
    const stat = await lstat(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error(`Not a regular source file: ${path}`);
    contents[path] = new Uint8Array(await readFile(absolute));
  }
  async function visit(path) {
    const stat = await lstat(join(sourceRoot, path));
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw Error(`Not a source directory: ${path}`);
    for (const entry of (await readdir(join(sourceRoot, path), { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const name = `${path}/${entry.name}`;
      if (isPrivatePath(name)) continue;
      if (entry.isSymbolicLink()) throw Error(`Source symlinks are not packaged: ${name}`);
      if (entry.isDirectory()) await visit(name);
      else if (sourceExtensions.test(entry.name)) await add(name);
      else throw Error(`Review unsupported source asset before packaging: ${name}`);
    }
  }
  for (const path of required) await add(path);
  for (const path of roots) await visit(path);

  const rootPackage = JSON.parse(new TextDecoder().decode(contents['package.json']));
  if (rootPackage.scripts?.start !== 'npm run start -w apps/api')
    throw Error('Root npm start must launch the API workspace.');
  if (!contents['apps/api/src/shared/web-hosting.ts'])
    throw Error('Same-origin hosting adapter is missing.');

  const files = Object.entries(contents)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, data]) => ({ path, bytes: data.length, sha256: hash(data) }));
  const manifest = {
    format: 1,
    purpose: 'App Service Linux source deployment; remote build required',
    ...provenance,
    includedConfiguration: 'No local environment files, credentials, dependencies or built output',
    requiredSettings: {
      NODE_ENV: 'production',
      SERVE_WEB: 'true',
      HOST: '0.0.0.0',
      SCM_DO_BUILD_DURING_DEPLOYMENT: 'true',
      NPM_CONFIG_INCLUDE: 'dev',
    },
    startupCommand: 'npm start',
    hostingAcceptance: ['/api/health', '/'],
    files,
  };
  contents['release-manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  const fixedTime = new Date('2020-01-01T00:00:00Z');
  const archive = zipSync(
    Object.fromEntries(Object.entries(contents).sort(([a], [b]) => a.localeCompare(b))),
    { level: 6, mtime: fixedTime },
  );
  return { archive, sha256: hash(archive), manifest };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repository,
    encoding: 'utf8',
  }).trim();
  const workingTreeDirty = Boolean(
    execFileSync('git', ['status', '--porcelain'], { cwd: repository, encoding: 'utf8' }).trim(),
  );
  const result = await appServicePackage(repository, { sourceCommit, workingTreeDirty });
  const output = join(
    repository,
    'artifacts',
    `skills-appservice-${result.sha256.slice(0, 12)}.zip`,
  );
  await mkdir(dirname(output), { recursive: true });
  // Content-addressed names keep previous release packages available for review.
  await writeFile(output, result.archive);
  await writeFile(`${output}.manifest.json`, JSON.stringify(result.manifest, null, 2));
  console.log(
    JSON.stringify(
      {
        path: output,
        sha256: result.sha256,
        bytes: result.archive.length,
        files: result.manifest.files.length,
        sourceCommit,
        workingTreeDirty,
      },
      null,
      2,
    ),
  );
}
