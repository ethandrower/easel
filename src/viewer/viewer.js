/* Easel viewer — scans the on-disk module/view tree via the server API,
   lays it out as a pan/zoom graph of live prototype iframes, and drives the
   lean contextual rail (related links + element-pinned comments). Vanilla JS. */
(() => {
  const FRAME_W = 1200, FRAME_H = 780, HEAD_H = 40;
  const GAP_X = 160, GAP_Y = 180;
  const STATUS = ['idea', 'in-progress', 'in-review', 'approved'];
  const statusColor = (s) =>
    ({ 'idea': '#9ca3af', 'in-progress': '#f59e0b', 'in-review': '#2563eb', 'approved': '#16a34a' }[s] || '#9ca3af');

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
  const api = (u, opts) => fetch(u, opts).then((r) => r.json());

  // --- state ----------------------------------------------------------------
  const view = { x: 40, y: 40, z: 0.35 };       // pan + zoom of the surface
  const nodes = new Map();                        // path -> { data, cache:{view,comments}, dom }
  let selected = null;
  let pinning = null;                             // path of view awaiting an element click

  const surface = $('surface');
  const nodesLayer = $('nodes');
  const edgesSvg = $('edges');
  const canvas = $('canvas');

  // --- transform ------------------------------------------------------------
  function applyTransform() {
    surface.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
    $('zoom-label').textContent = Math.round(view.z * 100) + '%';
  }
  const screenToWorld = (sx, sy) => ({ x: (sx - view.x) / view.z, y: (sy - view.y) / view.z });

  // --- data load ------------------------------------------------------------
  async function load() {
    const tree = await api('/api/tree');
    const all = [];
    tree.modules.forEach((mod, mi) => {
      mod.views.forEach((v, vi) => {
        v._module = mod;
        // auto-layout for views without a saved position
        if (!v.position) v.position = { x: 60 + vi * (FRAME_W + GAP_X), y: 60 + mi * (FRAME_H + HEAD_H + GAP_Y) };
        all.push(v);
      });
    });
    // fetch each view's stored json + comments (small; parallel)
    await Promise.all(all.map(async (v) => {
      const full = await api('/api/view?path=' + encodeURIComponent(v.id));
      nodes.set(v.id, { data: v, cache: full, dom: null });
    }));
    render();
    fit();
  }

  // --- render nodes + edges -------------------------------------------------
  function render() {
    nodesLayer.innerHTML = '';
    for (const [path, n] of nodes) {
      const d = n.data;
      const node = el('div', 'node');
      node.style.left = d.position.x + 'px';
      node.style.top = d.position.y + 'px';
      node.dataset.path = path;

      const head = el('div', 'node-head');
      const dot = el('span', 'node-dot'); dot.style.background = statusColor(d.status);
      head.append(dot, el('span', 'node-title', d.title));
      const open = (n.cache.comments.comments || []).filter((c) => c.status !== 'resolved').length;
      if (open) head.append(el('span', 'node-badge', open + '💬'));
      node.append(head);

      const frame = el('div', 'node-frame');
      const iframe = document.createElement('iframe');
      iframe.src = d.url;
      iframe.addEventListener('load', () => renderPins(path));
      frame.append(iframe);
      node.append(frame);

      nodesLayer.append(node);
      n.dom = node;
      n.iframe = iframe;

      head.addEventListener('mousedown', (e) => startNodeDrag(e, path));
      head.addEventListener('dblclick', () => flyTo(path));
    }
    if (selected && nodes.has(selected)) nodes.get(selected).dom.classList.add('selected');
    drawEdges();
    applyTransform();
  }

  function nodeCenterRight(n) { return { x: n.data.position.x + FRAME_W, y: n.data.position.y + (HEAD_H + FRAME_H) / 2 }; }
  function nodeCenterLeft(n) { return { x: n.data.position.x, y: n.data.position.y + (HEAD_H + FRAME_H) / 2 }; }

  function drawEdges() {
    edgesSvg.innerHTML = '';
    for (const [, n] of nodes) {
      for (const link of (n.cache.view.links || [])) {
        const target = nodes.get(link.to);
        if (!target) continue;
        const a = nodeCenterRight(n), b = nodeCenterLeft(target);
        const dx = Math.max(80, Math.abs(b.x - a.x) * 0.4);
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`);
        edgesSvg.append(path);
        if (link.label) {
          const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          t.setAttribute('class', 'edge-label');
          t.setAttribute('x', (a.x + b.x) / 2); t.setAttribute('y', (a.y + b.y) / 2 - 8);
          t.setAttribute('text-anchor', 'middle');
          t.textContent = link.label;
          edgesSvg.append(t);
        }
      }
    }
  }

  // --- comment pins ---------------------------------------------------------
  function renderPins(path) {
    const n = nodes.get(path);
    if (!n || !n.dom) return;
    n.dom.querySelectorAll('.pin').forEach((p) => p.remove());
    const frame = n.dom.querySelector('.node-frame');
    let doc;
    try { doc = n.iframe.contentDocument; } catch { return; }
    if (!doc) return;
    (n.cache.comments.comments || []).forEach((c, i) => {
      let target;
      try { target = c.selector && doc.querySelector(c.selector); } catch { target = null; }
      const r = target ? target.getBoundingClientRect() : null;
      const pin = el('div', 'pin' + (c.status === 'resolved' ? ' resolved' : ''), String(i + 1));
      pin.style.left = (r ? r.left + r.width / 2 : (c.x || 20)) + 'px';
      pin.style.top = (r ? r.top : (c.y || 20)) + HEAD_H + 'px';
      pin.title = c.text;
      pin.addEventListener('mousedown', (e) => { e.stopPropagation(); select(path); highlightComment(i); });
      frame.append(pin);
    });
  }

  // --- selection + rail -----------------------------------------------------
  function select(path) {
    selected = path;
    for (const [, n] of nodes) n.dom && n.dom.classList.toggle('selected', n.data === nodes.get(path).data);
    const n = nodes.get(path);
    $('rail').classList.remove('empty');
    $('rail-body').hidden = false;
    $('rail-empty').style.display = 'none';

    $('v-title').value = n.data.title;
    $('v-status').value = n.data.status;
    $('v-module').textContent = n.data._module.title;
    fillLinks(path);
    fillComments(path);
  }

  function fillLinks(path) {
    const n = nodes.get(path);
    const inc = $('links-in'), out = $('links-out');
    inc.innerHTML = ''; out.innerHTML = '';
    (n.cache.view.links || []).forEach((l) => {
      if (!nodes.has(l.to)) return;
      const li = el('li');
      li.append(el('span', 'arrow', '→'), el('span', null, nodes.get(l.to).data.title));
      li.addEventListener('click', () => { select(l.to); flyTo(l.to); });
      out.append(li);
    });
    for (const [p, other] of nodes) {
      if ((other.cache.view.links || []).some((l) => l.to === path)) {
        const li = el('li');
        li.append(el('span', 'arrow', '←'), el('span', null, other.data.title));
        li.addEventListener('click', () => { select(p); flyTo(p); });
        inc.append(li);
      }
    }
    if (!out.children.length) out.append(Object.assign(el('li', 'empty-note', 'none'), {}));
    if (!inc.children.length) inc.append(Object.assign(el('li', 'empty-note', 'none'), {}));
  }

  function fillComments(path) {
    const n = nodes.get(path);
    const list = $('comments');
    list.innerHTML = '';
    const cs = n.cache.comments.comments || [];
    $('comment-count').textContent = cs.length || '';
    cs.forEach((c, i) => {
      const li = el('li');
      li.append(el('div', null, `${i + 1}. ${c.text}`));
      if (c.selector) li.append(el('div', 'c-sel', c.selector));
      li.append(el('span', c.status === 'resolved' ? 'c-resolved' : 'c-open', c.status || 'open'));
      li.addEventListener('click', () => highlightComment(i));
      li.addEventListener('dblclick', () => toggleResolved(path, i));
      list.append(li);
    });
  }

  function highlightComment(i) {
    const n = nodes.get(selected);
    n.dom.querySelectorAll('.pin').forEach((p, j) => p.classList.toggle('active', j === i));
    const c = (n.cache.comments.comments || [])[i];
    if (!c) return;
    try {
      const doc = n.iframe.contentDocument;
      const t = c.selector && doc.querySelector(c.selector);
      if (t) t.scrollIntoView({ block: 'center' });
    } catch {}
  }

  async function toggleResolved(path, i) {
    const n = nodes.get(path);
    const c = n.cache.comments.comments[i];
    c.status = c.status === 'resolved' ? 'open' : 'resolved';
    await saveComments(path);
    fillComments(path); renderPins(path); render();
  }

  // --- persistence ----------------------------------------------------------
  const saveView = (path) => api('/api/view?path=' + encodeURIComponent(path), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(nodes.get(path).cache.view),
  });
  const saveComments = (path) => api('/api/comments?path=' + encodeURIComponent(path), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(nodes.get(path).cache.comments),
  });

  // --- node drag / pan / zoom ----------------------------------------------
  function startNodeDrag(e, path) {
    e.preventDefault(); e.stopPropagation();
    const n = nodes.get(path);
    const start = { mx: e.clientX, my: e.clientY, ox: n.data.position.x, oy: n.data.position.y };
    let moved = false;
    const move = (ev) => {
      const dx = (ev.clientX - start.mx) / view.z, dy = (ev.clientY - start.my) / view.z;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      n.data.position.x = start.ox + dx; n.data.position.y = start.oy + dy;
      n.dom.style.left = n.data.position.x + 'px'; n.dom.style.top = n.data.position.y + 'px';
      drawEdges();
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      if (moved) { n.cache.view.position = n.data.position; saveView(path); }
      else select(path);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  canvas.addEventListener('mousedown', (e) => {
    if (e.target.closest('.node')) return;
    const start = { mx: e.clientX, my: e.clientY, ox: view.x, oy: view.y };
    canvas.classList.add('panning');
    const move = (ev) => { view.x = start.ox + (ev.clientX - start.mx); view.y = start.oy + (ev.clientY - start.my); applyTransform(); };
    const up = () => { canvas.classList.remove('panning'); document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const nz = Math.min(2, Math.max(0.05, view.z * factor));
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const w = screenToWorld(sx, sy);
    view.z = nz;
    view.x = sx - w.x * nz; view.y = sy - w.y * nz;
    applyTransform();
  }, { passive: false });

  function flyTo(path) {
    const n = nodes.get(path);
    const rect = canvas.getBoundingClientRect();
    const z = Math.min(0.9, (rect.width * 0.8) / FRAME_W);
    view.z = z;
    view.x = rect.width / 2 - (n.data.position.x + FRAME_W / 2) * z;
    view.y = rect.height / 2 - (n.data.position.y + (HEAD_H + FRAME_H) / 2) * z;
    applyTransform();
    select(path);
  }

  function fit() {
    if (!nodes.size) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [, n] of nodes) {
      minX = Math.min(minX, n.data.position.x); minY = Math.min(minY, n.data.position.y);
      maxX = Math.max(maxX, n.data.position.x + FRAME_W); maxY = Math.max(maxY, n.data.position.y + HEAD_H + FRAME_H);
    }
    const rect = canvas.getBoundingClientRect();
    const pad = 80;
    const z = Math.min((rect.width - pad) / (maxX - minX), (rect.height - pad) / (maxY - minY), 1);
    view.z = Math.max(0.05, z);
    view.x = (rect.width - (maxX - minX) * view.z) / 2 - minX * view.z;
    view.y = (rect.height - (maxY - minY) * view.z) / 2 - minY * view.z;
    applyTransform();
  }

  // --- add comment (element pin) -------------------------------------------
  $('add-comment').addEventListener('click', () => {
    if (!selected) return;
    pinning = selected;
    $('pin-hint').hidden = false;
    nodes.get(selected).dom.classList.add('pinning');
    armPinCapture(selected);
  });

  function armPinCapture(path) {
    const n = nodes.get(path);
    let doc;
    try { doc = n.iframe.contentDocument; } catch { return; }
    const onClick = async (e) => {
      e.preventDefault(); e.stopPropagation();
      doc.removeEventListener('click', onClick, true);
      n.dom.classList.remove('pinning');
      $('pin-hint').hidden = true;
      pinning = null;
      const selector = cssPath(e.target);
      const text = prompt('Comment on ' + selector + ':');
      if (!text) return;
      n.cache.comments.comments = n.cache.comments.comments || [];
      n.cache.comments.comments.push({ id: 'c' + Date.now(), selector, text, status: 'open' });
      await saveComments(path);
      fillComments(path); renderPins(path); render();
    };
    doc.addEventListener('click', onClick, true);
  }

  function cssPath(node) {
    if (!node || node.nodeType !== 1) return '';
    if (node.id) return '#' + CSS.escape(node.id);
    const parts = [];
    let eln = node;
    while (eln && eln.nodeType === 1 && eln.tagName.toLowerCase() !== 'html') {
      let sel = eln.tagName.toLowerCase();
      if (eln.id) { parts.unshift('#' + CSS.escape(eln.id)); break; }
      const parent = eln.parentNode;
      if (parent) {
        const sibs = [...parent.children].filter((c) => c.tagName === eln.tagName);
        if (sibs.length > 1) sel += `:nth-of-type(${sibs.indexOf(eln) + 1})`;
      }
      parts.unshift(sel);
      eln = eln.parentNode;
    }
    return parts.join(' > ');
  }

  // --- rail edits -----------------------------------------------------------
  $('v-status').addEventListener('change', (e) => {
    if (!selected) return;
    const n = nodes.get(selected);
    n.data.status = e.target.value; n.cache.view.status = e.target.value;
    saveView(selected); render(); select(selected);
  });
  $('v-title').addEventListener('change', (e) => {
    if (!selected) return;
    const n = nodes.get(selected);
    n.data.title = e.target.value; n.cache.view.title = e.target.value;
    saveView(selected); render(); select(selected);
  });

  // --- toolbar --------------------------------------------------------------
  $('fit').addEventListener('click', fit);
  $('zoom-in').addEventListener('click', () => { view.z = Math.min(2, view.z * 1.2); applyTransform(); });
  $('zoom-out').addEventListener('click', () => { view.z = Math.max(0.05, view.z / 1.2); applyTransform(); });
  $('search').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const q = e.target.value.toLowerCase().trim();
    for (const [p, n] of nodes) if (n.data.title.toLowerCase().includes(q)) { flyTo(p); break; }
  });

  // insert form
  $('add-view').addEventListener('click', () => { $('insert-form').hidden = false; });
  $('insert-cancel').addEventListener('click', () => { $('insert-form').hidden = true; });
  $('insert-create').addEventListener('click', async () => {
    const module = $('insert-module').value.trim();
    const title = $('insert-title').value.trim();
    const parent = $('insert-parent').value.trim();
    if (!module || !title) return;
    const res = await api('/api/insert', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module, title, parent: parent || null }),
    });
    $('insert-form').hidden = true;
    $('insert-module').value = ''; $('insert-title').value = ''; $('insert-parent').value = '';
    await reloadTree();
    if (res.path && nodes.has(res.path)) flyTo(res.path);
  });

  async function reloadTree() {
    const prevPositions = new Map([...nodes].map(([p, n]) => [p, n.data.position]));
    nodes.clear();
    const tree = await api('/api/tree');
    const all = [];
    tree.modules.forEach((mod, mi) => mod.views.forEach((v, vi) => {
      v._module = mod;
      v.position = prevPositions.get(v.id) || v.position || { x: 60 + vi * (FRAME_W + GAP_X), y: 60 + mi * (FRAME_H + HEAD_H + GAP_Y) };
      all.push(v);
    }));
    await Promise.all(all.map(async (v) => {
      nodes.set(v.id, { data: v, cache: await api('/api/view?path=' + encodeURIComponent(v.id)), dom: null });
    }));
    render();
  }

  // --- live reload ----------------------------------------------------------
  try {
    const es = new EventSource('/__reload');
    let t;
    es.onmessage = () => { clearTimeout(t); t = setTimeout(reloadTree, 150); };
  } catch {}

  load();
})();
