// Exercises the Easel server API end-to-end against a throwaway canvas copied
// from the shipped template. Run with: npm test  (node --test).
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
  canvasRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'easel-test-'));
  await copyDir(path.join(TOOL, 'templates', 'design-canvas'), canvasRoot);
  server = await startServer({ canvasRoot, viewerRoot: path.join(TOOL, 'src', 'viewer'), port: 0 });
  base = `http://localhost:${server.address().port}`;
});
after(() => { server && server.close(); });

test('tree lists the example module and its views', async () => {
  const t = await get('/api/tree');
  assert.equal(t.modules.length, 1);
  assert.equal(t.modules[0].id, 'tasks');
  assert.ok(t.modules[0].views.length >= 3);
});

test('insert scaffolds a view and links it from the parent', async () => {
  const r = await post('/api/insert', { module: 'tasks', title: 'Filters', parent: 'tasks/task-list' });
  assert.ok(r.ok);
  assert.equal(r.path, 'tasks/filters');
  assert.ok(has('modules/tasks/filters/index.html'));
  assert.ok(has('modules/tasks/filters/view.json'));
  const tl = await get('/api/view?path=tasks/task-list');
  assert.ok(tl.view.links.some((l) => l.to === 'tasks/filters'));
});

test('duplicate copies a view within its module', async () => {
  const r = await post('/api/duplicate', { path: 'tasks/task-detail' });
  assert.ok(r.ok);
  assert.equal(r.path, 'tasks/task-detail-copy');
  assert.ok(has('modules/tasks/task-detail-copy/view.json'));
});

test('rename moves the folder and repoints inbound edges', async () => {
  const r = await post('/api/rename', { path: 'tasks/filters', id: 'task-filters' });
  assert.ok(r.ok);
  assert.ok(has('modules/tasks/task-filters'));
  assert.ok(!has('modules/tasks/filters'));
  const tl = await get('/api/view?path=tasks/task-list');
  assert.ok(tl.view.links.some((l) => l.to === 'tasks/task-filters'));
});

test('delete removes the folder and drops inbound edges', async () => {
  await post('/api/delete', { path: 'tasks/task-filters' });
  assert.ok(!has('modules/tasks/task-filters'));
  const tl = await get('/api/view?path=tasks/task-list');
  assert.ok(!tl.view.links.some((l) => l.to === 'tasks/task-filters'));
});

test('comments persist to the view sidecar', async () => {
  await post('/api/comments?path=tasks/new-task', { comments: [{ id: 'c1', selector: '#x', text: 'hi', status: 'open' }] });
  const v = await get('/api/view?path=tasks/new-task');
  assert.equal(v.comments.comments.length, 1);
  assert.equal(v.comments.comments[0].text, 'hi');
});

test('wire writes real navigation and records a wired edge', async () => {
  const before = '<button class="btn" id="new-task">+ New task</button>';
  const after = '<button class="btn" id="new-task" data-easel-nav="../task-detail/index.html" data-easel-view="tasks/task-detail">+ New task</button>';
  const r = await post('/api/wire', { path: 'tasks/task-list', selector: '#new-task', to: 'tasks/task-detail', label: '+ New task', before, after });
  assert.ok(r.ok);
  assert.ok(r.wired);
  const html = fss.readFileSync(path.join(canvasRoot, 'modules/tasks/task-list/index.html'), 'utf8');
  assert.ok(html.includes('data-easel-view="tasks/task-detail"'));
  const tree = await get('/api/tree');
  const tl = tree.modules[0].views.find((v) => v.id === 'tasks/task-list');
  assert.ok(tl.derivedLinks.some((l) => l.to === 'tasks/task-detail'));
  const view = await get('/api/view?path=tasks/task-list');
  assert.ok(view.view.links.some((l) => l.to === 'tasks/task-detail' && l.wired));
});

test('wire falls back to id-injection when no before/after given', async () => {
  const r = await post('/api/wire', { path: 'tasks/task-detail', selector: '#save-btn', to: 'tasks/new-task' });
  // task-detail's Save button has no id, so this should record the edge but not wire
  assert.ok(r.ok);
  assert.equal(r.wired, false);
});

test('path traversal is rejected', async () => {
  const r = await fetch(base + '/api/view?path=' + encodeURIComponent('../../../etc'));
  const j = await r.json();
  assert.ok(j.error || !j.view || Object.keys(j.view || {}).length === 0);
});
