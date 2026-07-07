/*
 * Easel dev server — zero dependencies, works in any repo.
 *
 * Serves two things at once:
 *   1. the viewer app   (this package's src/viewer)          →  /            /app/*
 *   2. the host repo's design canvas (./design-canvas by default) →  /canvas/*
 *
 * Plus a small JSON API the viewer uses to read the module/view tree and to
 * persist annotations, view metadata, and newly-inserted views straight to the
 * files on disk — which is exactly what Claude Code then reads and edits.
 *
 * The server hardcodes nothing about any particular design system; the canvas
 * directory is the sole source of truth.
 */
import http from 'node:http';
import { promises as fs } from 'node:fs';
import fss from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

const slug = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled';

const json = (res, code, data) =>
  res.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); }
    });
  });
}

async function readJSON(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { return fallback; }
}
const writeJSON = (file, data) => fs.writeFile(file, JSON.stringify(data, null, 2) + '\n');
const exists = (p) => fss.existsSync(p);

// List every view directory as { path, dir } across all modules.
async function allViewDirs(canvasRoot) {
  const modulesDir = path.join(canvasRoot, 'modules');
  const out = [];
  let mods = [];
  try { mods = (await fs.readdir(modulesDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name); }
  catch { return out; }
  for (const mod of mods) {
    const modDir = path.join(modulesDir, mod);
    for (const v of (await fs.readdir(modDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)) {
      if (exists(path.join(modDir, v, 'view.json'))) out.push({ path: `${mod}/${v}`, dir: path.join(modDir, v) });
    }
  }
  return out;
}

// Remove/rewrite edges that point at `oldPath` across every view.
async function rewriteEdges(canvasRoot, oldPath, newPath /* null = delete */) {
  for (const { dir } of await allViewDirs(canvasRoot)) {
    const v = await readJSON(path.join(dir, 'view.json'), null);
    if (!v || !Array.isArray(v.links)) continue;
    const before = v.links.length;
    v.links = newPath
      ? v.links.map((l) => (l.to === oldPath ? { ...l, to: newPath } : l))
      : v.links.filter((l) => l.to !== oldPath);
    if (v.links.length !== before || newPath) await writeJSON(path.join(dir, 'view.json'), v);
  }
}

async function copyDir(src, dst) {
  await fs.mkdir(dst, { recursive: true });
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name), d = path.join(dst, entry.name);
    if (entry.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

async function rmDir(p) { await fs.rm(p, { recursive: true, force: true }); }

// Walk modules/<module>/<view>/ and assemble the graph the viewer renders.
async function scanTree(canvasRoot) {
  const modulesDir = path.join(canvasRoot, 'modules');
  const out = { modules: [] };
  let moduleNames = [];
  try { moduleNames = (await fs.readdir(modulesDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name); }
  catch { return out; }

  for (const mod of moduleNames) {
    const modDir = path.join(modulesDir, mod);
    const meta = await readJSON(path.join(modDir, 'module.json'), {});
    const views = [];
    const viewNames = (await fs.readdir(modDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    for (const view of viewNames) {
      const viewDir = path.join(modDir, view);
      if (!exists(path.join(viewDir, 'view.json'))) continue;
      const vjson = await readJSON(path.join(viewDir, 'view.json'), {});
      const cjson = await readJSON(path.join(viewDir, 'comments.json'), { comments: [] });
      const rel = `${mod}/${view}`;
      views.push({
        id: rel,
        module: mod,
        view,
        title: vjson.title || view,
        status: vjson.status || 'idea',
        position: vjson.position || null,
        links: Array.isArray(vjson.links) ? vjson.links : [],
        url: `/canvas/modules/${mod}/${view}/index.html`,
        openComments: (cjson.comments || []).filter((c) => c.status !== 'resolved').length,
        totalComments: (cjson.comments || []).length,
      });
    }
    out.modules.push({
      id: mod,
      title: meta.title || mod,
      color: meta.color || null,
      order: meta.order ?? 999,
      views,
    });
  }
  out.modules.sort((a, b) => a.order - b.order);
  return out;
}

export function startServer({ canvasRoot, viewerRoot, port = 4321 }) {
  // live reload: hold SSE clients, ping on any change under the canvas dir
  const sseClients = new Set();
  const broadcast = (file) => {
    const payload = `data: ${JSON.stringify({ file })}\n\n`;
    for (const res of sseClients) res.write(payload);
  };
  let debounce;
  const onChange = (file) => {
    if (!file || String(file).includes('.git')) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => broadcast(String(file).replace(/\\/g, '/')), 60);
  };
  // Recursive fs.watch works on macOS/Windows; on Linux it throws — fall back to mtime polling.
  try {
    fss.watch(canvasRoot, { recursive: true }, (_evt, file) => onChange(file));
  } catch {
    const mtimes = new Map();
    let primed = false;
    const scan = async () => {
      const seen = new Set();
      const stack = [canvasRoot];
      while (stack.length) {
        const dir = stack.pop();
        let entries;
        try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { continue; }
        for (const e of entries) {
          if (e.name === '.git' || e.name === 'node_modules') continue;
          const full = path.join(dir, e.name);
          if (e.isDirectory()) { stack.push(full); continue; }
          try {
            const s = await fs.stat(full);
            seen.add(full);
            const prev = mtimes.get(full);
            mtimes.set(full, s.mtimeMs);
            if (primed && prev !== s.mtimeMs) onChange(e.name);
          } catch { /* file vanished mid-scan */ }
        }
      }
      for (const k of [...mtimes.keys()]) if (!seen.has(k)) { mtimes.delete(k); if (primed) onChange('deleted'); }
      primed = true;
    };
    scan();
    setInterval(scan, 800);
  }

  const safeJoin = (root, rel) => {
    const p = path.join(root, rel);
    if (!p.startsWith(root)) return null; // path traversal guard
    return p;
  };

  const serveFile = async (res, file) => {
    try {
      const data = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }).end(data);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
    }
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const p = url.pathname;

    // ---- live reload stream -------------------------------------------------
    if (p === '/__reload') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('retry: 1000\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    // ---- API ----------------------------------------------------------------
    if (p === '/api/tree') return json(res, 200, await scanTree(canvasRoot));

    if (p === '/api/view') {
      const rel = url.searchParams.get('path') || '';
      const dir = safeJoin(path.join(canvasRoot, 'modules'), rel);
      if (!dir) return json(res, 400, { error: 'bad path' });
      if (req.method === 'GET') {
        return json(res, 200, {
          view: await readJSON(path.join(dir, 'view.json'), {}),
          comments: await readJSON(path.join(dir, 'comments.json'), { comments: [] }),
        });
      }
      if (req.method === 'POST') {
        await writeJSON(path.join(dir, 'view.json'), await readBody(req));
        return json(res, 200, { ok: true });
      }
    }

    if (p === '/api/comments' && req.method === 'POST') {
      const rel = url.searchParams.get('path') || '';
      const dir = safeJoin(path.join(canvasRoot, 'modules'), rel);
      if (!dir) return json(res, 400, { error: 'bad path' });
      await writeJSON(path.join(dir, 'comments.json'), await readBody(req));
      return json(res, 200, { ok: true });
    }

    // Insert a new view: scaffold from _template.html, wire into the graph.
    if (p === '/api/insert' && req.method === 'POST') {
      const { module: mod, title, parent, position } = await readBody(req);
      if (!mod || !title) return json(res, 400, { error: 'module and title required' });
      const modDir = path.join(canvasRoot, 'modules', slug(mod));
      await fs.mkdir(modDir, { recursive: true });
      if (!exists(path.join(modDir, 'module.json')))
        await writeJSON(path.join(modDir, 'module.json'), { title: mod, order: 999 });
      let id = slug(title);
      let n = 1;
      while (exists(path.join(modDir, id))) id = `${slug(title)}-${++n}`;
      const viewDir = path.join(modDir, id);
      await fs.mkdir(viewDir, { recursive: true });
      let tpl = await fs.readFile(path.join(canvasRoot, '_template.html'), 'utf8').catch(() => '<!doctype html><html><head><script src="../../../shared/ds.js"></script></head><body><main class="p-6"><h1>__TITLE__</h1></main></body></html>');
      tpl = tpl.replace(/__TITLE__/g, title);
      await fs.writeFile(path.join(viewDir, 'index.html'), tpl);
      // place below the parent (if any); otherwise at the client-supplied spot
      // (the viewer sends the current viewport center) or a default.
      const parentDir = parent ? safeJoin(path.join(canvasRoot, 'modules'), parent) : null;
      let pv = parentDir ? await readJSON(path.join(parentDir, 'view.json'), null) : null;
      const pos = pv && pv.position ? { x: pv.position.x, y: pv.position.y + 900 } : (position || { x: 80, y: 80 });
      await writeJSON(path.join(viewDir, 'view.json'), { title, status: 'idea', position: pos, links: [] });
      await writeJSON(path.join(viewDir, 'comments.json'), { comments: [] });
      if (pv) {
        pv.links = pv.links || [];
        pv.links.push({ to: `${slug(mod)}/${id}`, label: '' });
        await writeJSON(path.join(parentDir, 'view.json'), pv);
      }
      return json(res, 200, { ok: true, path: `${slug(mod)}/${id}` });
    }

    // Delete a view: remove its folder and drop every edge pointing at it.
    if (p === '/api/delete' && req.method === 'POST') {
      const { path: rel } = await readBody(req);
      const dir = safeJoin(path.join(canvasRoot, 'modules'), rel || '');
      if (!dir || !exists(dir)) return json(res, 400, { error: 'bad path' });
      await rmDir(dir);
      await rewriteEdges(canvasRoot, rel, null);
      return json(res, 200, { ok: true });
    }

    // Duplicate a view within its module (great for variants).
    if (p === '/api/duplicate' && req.method === 'POST') {
      const { path: rel } = await readBody(req);
      const dir = safeJoin(path.join(canvasRoot, 'modules'), rel || '');
      if (!dir || !exists(dir)) return json(res, 400, { error: 'bad path' });
      const [mod, view] = rel.split('/');
      const modDir = path.join(canvasRoot, 'modules', mod);
      let id = `${view}-copy`, n = 1;
      while (exists(path.join(modDir, id))) id = `${view}-copy-${++n}`;
      const dst = path.join(modDir, id);
      await copyDir(dir, dst);
      const v = await readJSON(path.join(dst, 'view.json'), {});
      v.title = (v.title || view) + ' copy';
      v.position = { x: (v.position?.x || 80) + 80, y: (v.position?.y || 80) + 80 };
      await writeJSON(path.join(dst, 'view.json'), v);
      return json(res, 200, { ok: true, path: `${mod}/${id}` });
    }

    // Rename a view's folder id and repoint every edge that referenced it.
    if (p === '/api/rename' && req.method === 'POST') {
      const { path: rel, id: rawId } = await readBody(req);
      const dir = safeJoin(path.join(canvasRoot, 'modules'), rel || '');
      if (!dir || !exists(dir) || !rawId) return json(res, 400, { error: 'bad path' });
      const [mod] = rel.split('/');
      const id = slug(rawId);
      const dst = path.join(canvasRoot, 'modules', mod, id);
      if (exists(dst)) return json(res, 409, { error: 'id already exists' });
      await fs.rename(dir, dst);
      await rewriteEdges(canvasRoot, rel, `${mod}/${id}`);
      return json(res, 200, { ok: true, path: `${mod}/${id}` });
    }

    // ---- static: host canvas ------------------------------------------------
    if (p.startsWith('/canvas/')) {
      const file = safeJoin(canvasRoot, decodeURIComponent(p.slice('/canvas/'.length)));
      if (!file) return json(res, 403, { error: 'forbidden' });
      return serveFile(res, file);
    }

    // ---- static: viewer app -------------------------------------------------
    const rel = p === '/' ? 'index.html' : decodeURIComponent(p.replace(/^\/app\//, '').replace(/^\//, ''));
    const file = safeJoin(viewerRoot, rel);
    if (!file) return json(res, 403, { error: 'forbidden' });
    return serveFile(res, file);
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      console.log(`\n  ▲ easel  →  http://localhost:${port}`);
      console.log(`     canvas: ${canvasRoot}\n`);
      resolve(server);
    });
  });
}
