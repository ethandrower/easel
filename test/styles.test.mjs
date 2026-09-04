// Style library sync + lint against a throwaway canvas with a fake repo's
// tailwind config and component stylesheet. Run with: npm test.
import { test, before } from 'node:test';
import assert from 'node:assert';
import { promises as fs } from 'node:fs';
import fss from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { syncStyles, lintStyles, parseRules } from '../src/server/styles.mjs';

let repo, canvasRoot;

before(async () => {
  repo = await fs.mkdtemp(path.join(os.tmpdir(), 'easel-styles-test-'));
  canvasRoot = path.join(repo, 'design-canvas');
  await fs.mkdir(path.join(canvasRoot, 'modules', 'tasks', 'task-list'), { recursive: true });
  await fs.writeFile(path.join(repo, 'tailwind.config.js'),
    'export default { content: ["./src/**/*.vue"], theme: { extend: { colors: { brand: { 500: "#123456" } } } } };\n');
  await fs.writeFile(path.join(repo, 'app.css'), [
    '@tailwind base;',
    '@layer components {',
    '  .btn-primary { @apply px-4 py-2 text-white; }',
    '  .btn-primary:hover { @apply bg-brand-500; }',
    '  .card { border: 1px solid #eee; border-radius: 8px; }',
    '}',
  ].join('\n'));
  await fs.writeFile(path.join(canvasRoot, 'canvas.config.json'), JSON.stringify({
    title: 'test', styles: { tailwind: '../tailwind.config.js', css: ['../app.css'] },
  }));
  await fs.writeFile(path.join(canvasRoot, 'modules', 'tasks', 'task-list', 'view.json'), '{"title":"Task list"}');
  await fs.writeFile(path.join(canvasRoot, 'modules', 'tasks', 'task-list', 'index.html'), [
    '<!doctype html><html><head>',
    '<style>.my-card { border-radius: 8px; border: 1px solid #eee; } .weird { color: fuchsia; }</style>',
    '</head><body>',
    '<button class="btn-primary">ok</button>',
    '<button class="btn-fancy">nope</button>',
    '<span class="text-brand-500">tailwind utility, fine</span>',
    '<div style="color: fuchsia">inline</div>',
    '</body></html>',
  ].join('\n'));
});

test('parseRules captures innermost rules through @layer wrappers', () => {
  const rules = parseRules('@layer components { .a { color: red; } .b:hover { x: y } } .c { z: w }');
  assert.deepEqual(rules.map((r) => r.selector), ['.a', '.b:hover', '.c']);
});

test('sync generates runtime injection, plain css, and the class inventory', async () => {
  const res = await syncStyles(canvasRoot);
  assert.equal(res.tailwind, true);
  assert.equal(res.themeError, null);
  assert.ok(res.classes.includes('btn-primary'));
  assert.ok(res.classes.includes('card'));
  assert.ok(res.stripped.some((s) => s.startsWith('@tailwind')));
  const genJs = await fs.readFile(path.join(canvasRoot, 'shared', 'library.gen.js'), 'utf8');
  assert.ok(genJs.includes('tailwind.config='));
  assert.ok(genJs.includes('brand') && genJs.includes('#123456'), 'theme tokens embedded');
  assert.ok(genJs.includes('text/tailwindcss'));
  assert.ok(!genJs.includes('@tailwind base'), 'build-time directives stripped');
  assert.ok(fss.existsSync(path.join(canvasRoot, 'shared', 'library.gen.css')));
  const inv = JSON.parse(await fs.readFile(path.join(canvasRoot, 'shared', 'library.json'), 'utf8'));
  assert.ok(inv.classes.includes('btn-primary'));
  // second run is a no-op apart from timestamps
  const res2 = await syncStyles(canvasRoot);
  assert.equal(res2.files['shared/library.gen.css'], 'updated');   // timestamp header changes
});

test('lint flags duplicates, look-alikes, inline styles, and style attributes', async () => {
  const report = await lintStyles(canvasRoot);
  const types = report.findings.map((f) => f.type);
  const dup = report.findings.find((f) => f.type === 'duplicate-of-library');
  assert.ok(dup, 'my-card duplicates .card');
  assert.equal(dup.selector, '.my-card');
  assert.ok(dup.duplicates.includes('.card'));
  const fake = report.findings.find((f) => f.type === 'library-lookalike');
  assert.ok(fake && fake.class === 'btn-fancy');
  assert.ok(!report.findings.some((f) => f.type === 'library-lookalike' && f.class === 'text-brand-500'),
    'tailwind utilities are not look-alikes');
  assert.ok(types.includes('inline-styles'));
  assert.ok(types.includes('style-attributes'));
  assert.ok(fss.existsSync(path.join(canvasRoot, 'style-report.json')));
});

test('lint without a sync explains itself', async () => {
  const bare = await fs.mkdtemp(path.join(os.tmpdir(), 'easel-styles-bare-'));
  await assert.rejects(() => lintStyles(bare), /easel styles sync/);
});
