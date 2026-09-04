// Iterations: lettered variant copies of a screen tied back to their base view.
// Run with: npm test.
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { promises as fs } from 'node:fs';
import fss from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer } from '../src/server/serve.mjs';

const TOOL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let server, base, canvasRoot;

async function copyDir(src, dst) {
  await fs.mkdir(dst, { recursive: true });
  for (const e of await fs.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) await copyDir(s, d); else await fs.copyFile(s, d);
  }
}
const get = (p) => fetch(base + p).then((r) => r.json());
const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());

before(async () => {
  canvasRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'easel-variant-test-'));
  await copyDir(path.join(TOOL, 'templates', 'design-canvas'), canvasRoot);
  server = await startServer({ canvasRoot, viewerRoot: path.join(TOOL, 'src', 'viewer'), port: 0 });
  base = `http://localhost:${server.address().port}`;
});
after(() => { server && server.close(); });

test('variant copies the screen as a lettered iteration linked from its base', async () => {
  const r = await post('/api/variant', { path: 'tasks/task-list' });
  assert.ok(r.ok);
  assert.equal(r.path, 'tasks/task-list-b');
  assert.ok(fss.existsSync(path.join(canvasRoot, 'modules/tasks/task-list-b/index.html')));
  const v = await get('/api/view?path=tasks/task-list-b');
  assert.deepEqual(v.view.variant, { of: 'tasks/task-list', label: 'b' });
  assert.ok(v.view.title.endsWith('iteration B'));
  const baseV = await get('/api/view?path=tasks/task-list');
  assert.ok(baseV.view.links.some((l) => l.to === 'tasks/task-list-b' && l.label === 'iteration B'));
  const tree = await get('/api/tree');
  const node = tree.modules.find((m) => m.id === 'tasks').views.find((x) => x.id === 'tasks/task-list-b');
  assert.deepEqual(node.variant, { of: 'tasks/task-list', label: 'b' });
});

test('iterating an iteration joins the same family with the next letter', async () => {
  const r = await post('/api/variant', { path: 'tasks/task-list-b' });
  assert.ok(r.ok);
  assert.equal(r.path, 'tasks/task-list-c');
  const v = await get('/api/view?path=tasks/task-list-c');
  assert.deepEqual(v.view.variant, { of: 'tasks/task-list', label: 'c' });
  const baseV = await get('/api/view?path=tasks/task-list');
  assert.ok(baseV.view.links.some((l) => l.to === 'tasks/task-list-c'));
});
