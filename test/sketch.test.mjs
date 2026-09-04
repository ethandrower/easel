// Sketch mode: a view can exist as a rough native sketch (view.json only, no
// index.html) and later be promoted to a real design. Run with: npm test.
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
const has = (rel) => fss.existsSync(path.join(canvasRoot, rel));

before(async () => {
  canvasRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'easel-sketch-test-'));
  await copyDir(path.join(TOOL, 'templates', 'design-canvas'), canvasRoot);
  server = await startServer({ canvasRoot, viewerRoot: path.join(TOOL, 'src', 'viewer'), port: 0 });
  base = `http://localhost:${server.address().port}`;
});
after(() => { server && server.close(); });

const TEXT = 'Pick many, act once.\n\n## Toolbar\n- select all\n- delete selected\n? does this need undo?';

test('insert with sketch creates a native sketch (no index.html) and the tree flags its kind', async () => {
  const r = await post('/api/insert', { module: 'tasks', title: 'Bulk actions', sketch: true, text: TEXT });
  assert.ok(r.ok);
  assert.equal(r.path, 'tasks/bulk-actions');
  assert.ok(has('modules/tasks/bulk-actions/view.json'));
  assert.ok(has('modules/tasks/bulk-actions/comments.json'));
  assert.ok(!has('modules/tasks/bulk-actions/index.html'), 'a sketch has no HTML until promoted');
  const v = await get('/api/view?path=tasks/bulk-actions');
  assert.equal(v.view.sketch.text, TEXT);
  assert.equal(v.view.status, 'idea');
  const tree = await get('/api/tree');
  const views = tree.modules.find((m) => m.id === 'tasks').views;
  assert.equal(views.find((x) => x.id === 'tasks/bulk-actions').kind, 'sketch');
  assert.equal(views.find((x) => x.id === 'tasks/task-list').kind, 'design');
});

test('a sketch can be linked from a parent like any other view', async () => {
  const r = await post('/api/insert', { module: 'tasks', title: 'Undo toast', sketch: true, parent: 'tasks/bulk-actions' });
  assert.ok(r.ok);
  const parent = await get('/api/view?path=tasks/bulk-actions');
  assert.ok(parent.view.links.some((l) => l.to === 'tasks/undo-toast'));
  const child = await get('/api/view?path=tasks/undo-toast');
  assert.equal(child.view.sketch.text, '');
});

test('promote scaffolds index.html from the template and keeps the sketch text as the notes', async () => {
  const r = await post('/api/promote', { path: 'tasks/bulk-actions' });
  assert.ok(r.ok);
  assert.ok(has('modules/tasks/bulk-actions/index.html'));
  const html = fss.readFileSync(path.join(canvasRoot, 'modules/tasks/bulk-actions/index.html'), 'utf8');
  assert.ok(html.includes('Bulk actions'), 'template title substituted');
  const v = await get('/api/view?path=tasks/bulk-actions');
  assert.equal(v.view.sketch, undefined);
  assert.equal(v.view.notes, TEXT, 'the sketch text becomes the screen notes');
  assert.ok(v.view.links.some((l) => l.to === 'tasks/undo-toast'), 'links survive promotion');
  const tree = await get('/api/tree');
  const views = tree.modules.find((m) => m.id === 'tasks').views;
  assert.equal(views.find((x) => x.id === 'tasks/bulk-actions').kind, 'design');
});

test('promoting a view that already has HTML is refused', async () => {
  const again = await post('/api/promote', { path: 'tasks/bulk-actions' });
  assert.ok(!again.ok);
  const existing = await post('/api/promote', { path: 'tasks/task-list' });
  assert.ok(!existing.ok);
});
