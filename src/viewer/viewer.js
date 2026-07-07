/* Easel viewer — scans the on-disk module/view tree via the server API, lays it
   out as a pan/zoom graph of live prototype iframes, and drives the lean
   contextual rail (related links + element-pinned comments). Vanilla JS.

   Editing philosophy: the viewer only *views, organizes, and annotates*. Every
   design change goes through Claude Code (comments -> resolve) or hand-edited
   HTML. No WYSIWYG here by design. */
(() => {
  const FRAME_W = 1200, FRAME_H = 780, HEAD_H = 40;
  const GAP_X = 160, GAP_Y = 180;
  const statusColor = (s) =>
    ({ 'idea': '#9ca3af', 'in-progress': '#f59e0b', 'in-review': '#2563eb', 'approved': '#16a34a' }[s] || '#9ca3af');

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
  const api = (u, opts) => fetch(u, opts).then((r) => r.json());
  const toast = (msg) => { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 1800); };
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); } catch { toast('Copy failed'); } };
  // transparent overlay so mouse events keep firing while dragging over iframes
  const dragShield = () => { const s = document.createElement('div'); s.style.cssText = 'position:fixed;inset:0;z-index:9999'; document.body.append(s); return () => s.remove(); };

  const view = { x: 40, y: 40, z: 0.35 };
  const nodes = new Map();          // path -> { data, cache:{view,comments}, dom, iframe }
  let selected = null;
  let deleteArmed = false;

  const surface = $('surface');
  const nodesLayer = $('nodes');
  const edgesSvg = $('edges');
  const canvas = $('canvas');
  const SVGNS = 'http://www.w3.org/2000/svg';

  function applyTransform() {
    surface.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
    $('zoom-label').textContent = Math.round(view.z * 100) + '%';
  }
  const screenToWorld = (sx, sy) => ({ x: (sx - view.x) / view.z, y: (sy - view.y) / view.z });
  const canvasPoint = (e) => { const r = canvas.getBoundingClientRect(); return screenToWorld(e.clientX - r.left, e.clientY - r.top); };
  const nodeAtWorld = (wx, wy) => {
    for (const [p, n] of nodes) {
      const d = n.data.position;
      if (wx >= d.x && wx <= d.x + FRAME_W && wy >= d.y && wy <= d.y + HEAD_H + FRAME_H) return p;
    }
    return null;
  };

  // --- data load ------------------------------------------------------------
  async function load() { await reloadTree(false); fit(); }

  let reloadSeq = 0;
  async function reloadTree(keepSelection = true) {
    const my = ++reloadSeq;                       // newest reload wins; older ones bail
    const prevPos = new Map([...nodes].map(([p, n]) => [p, n.data.position]));
    const tree = await api('/api/tree');
    if (my !== reloadSeq) return;                 // superseded while fetching the tree
    const all = [];
    tree.modules.forEach((mod, mi) => mod.views.forEach((v, vi) => {
      v._module = mod;
      v.position = prevPos.get(v.id) || v.position || { x: 60 + vi * (FRAME_W + GAP_X), y: 60 + mi * (FRAME_H + HEAD_H + GAP_Y) };
      all.push(v);
    }));
    const caches = await Promise.all(all.map((v) => api('/api/view?path=' + encodeURIComponent(v.id))));
    if (my !== reloadSeq) return;                 // superseded while fetching views
    nodes.clear();
    all.forEach((v, i) => nodes.set(v.id, { data: v, cache: caches[i], dom: null }));
    render();
    if (keepSelection && selected && nodes.has(selected)) select(selected);
    else if (!nodes.has(selected)) clearSelection();
  }

  // --- render ---------------------------------------------------------------
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

      const handle = el('div', 'link-handle', '↗');
      handle.title = 'Drag to another view to link';
      handle.addEventListener('mousedown', (e) => startLinkDrag(e, path));
      node.append(handle);

      nodesLayer.append(node);
      n.dom = node; n.iframe = iframe;

      head.addEventListener('mousedown', (e) => startNodeDrag(e, path));
      head.addEventListener('dblclick', () => flyTo(path));
    }
    if (selected && nodes.has(selected)) nodes.get(selected).dom.classList.add('selected');
    drawEdges();
    applyTransform();
  }

  const centerR = (n) => ({ x: n.data.position.x + FRAME_W, y: n.data.position.y + (HEAD_H + FRAME_H) / 2 });
  const centerL = (n) => ({ x: n.data.position.x, y: n.data.position.y + (HEAD_H + FRAME_H) / 2 });

  function drawEdges() {
    edgesSvg.innerHTML = '';
    for (const [from, n] of nodes) {
      (n.cache.view.links || []).forEach((link, li) => {
        const target = nodes.get(link.to);
        if (!target) return;
        const a = centerR(n), b = centerL(target);
        const dx = Math.max(80, Math.abs(b.x - a.x) * 0.4);
        const dpath = `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
        const p = document.createElementNS(SVGNS, 'path');
        p.setAttribute('d', dpath); p.setAttribute('pointer-events', 'none');
        edgesSvg.append(p);
        const hit = document.createElementNS(SVGNS, 'path');
        hit.setAttribute('d', dpath); hit.setAttribute('class', 'hit');
        hit.addEventListener('mousedown', (e) => e.stopPropagation());
        hit.addEventListener('click', (e) => { e.stopPropagation(); openEdgePop(from, li, e.clientX, e.clientY); });
        edgesSvg.append(hit);
        if (link.label) {
          const t = document.createElementNS(SVGNS, 'text');
          t.setAttribute('class', 'edge-label');
          t.setAttribute('x', (a.x + b.x) / 2); t.setAttribute('y', (a.y + b.y) / 2 - 8);
          t.setAttribute('text-anchor', 'middle');
          t.textContent = link.label;
          edgesSvg.append(t);
        }
      });
    }
  }

  function renderPins(path) {
    const n = nodes.get(path);
    if (!n || !n.dom) return;
    n.dom.querySelectorAll('.pin').forEach((p) => p.remove());
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
      n.dom.append(pin);
    });
  }

  // --- selection + rail -----------------------------------------------------
  function clearSelection() {
    selected = null;
    $('rail').classList.add('empty');
    $('rail-body').hidden = true;
    $('rail-empty').style.display = 'block';
  }
  function select(path) {
    selected = path; deleteArmed = false;
    for (const [p, n] of nodes) n.dom && n.dom.classList.toggle('selected', p === path);
    const n = nodes.get(path);
    $('rail').classList.remove('empty');
    $('rail-body').hidden = false;
    $('rail-empty').style.display = 'none';
    $('v-title').value = n.data.title;
    $('v-status').value = n.data.status;
    $('v-module').textContent = n.data._module.title;
    // rebuild the id row fresh (the inline rename UI may have replaced its contents)
    const idWrap = document.querySelector('.v-id');
    idWrap.innerHTML = '<code id="v-path"></code>';
    idWrap.firstChild.textContent = path;
    $('act-delete').textContent = 'delete';
    $('act-delete').classList.remove('armed');
    $('composer').hidden = true; $('pin-hint').hidden = true;
    fillLinks(path); fillComments(path);
  }

  function fillLinks(path) {
    const n = nodes.get(path);
    const inc = $('links-in'), out = $('links-out');
    inc.innerHTML = ''; out.innerHTML = '';
    (n.cache.view.links || []).forEach((l) => {
      if (!nodes.has(l.to)) return;
      const li = el('li');
      li.append(el('span', 'arrow', '→'), el('span', null, nodes.get(l.to).data.title));
      li.addEventListener('click', () => flyTo(l.to));
      out.append(li);
    });
    for (const [p, other] of nodes) {
      if ((other.cache.view.links || []).some((l) => l.to === path)) {
        const li = el('li');
        li.append(el('span', 'arrow', '←'), el('span', null, other.data.title));
        li.addEventListener('click', () => flyTo(p));
        inc.append(li);
      }
    }
    if (!out.children.length) out.append(el('li', 'empty-note', 'none'));
    if (!inc.children.length) inc.append(el('li', 'empty-note', 'none'));
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
    try { const t = n.iframe.contentDocument.querySelector(c.selector); if (t) t.scrollIntoView({ block: 'center' }); } catch {}
  }

  async function toggleResolved(path, i) {
    const c = nodes.get(path).cache.comments.comments[i];
    c.status = c.status === 'resolved' ? 'open' : 'resolved';
    await saveComments(path);
    fillComments(path); renderPins(path); render();
  }

  // --- persistence ----------------------------------------------------------
  const post = (url, body) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const saveView = (path) => post('/api/view?path=' + encodeURIComponent(path), nodes.get(path).cache.view);
  const saveComments = (path) => post('/api/comments?path=' + encodeURIComponent(path), nodes.get(path).cache.comments);

  // --- node drag / pan / zoom ----------------------------------------------
  function startNodeDrag(e, path) {
    e.preventDefault(); e.stopPropagation();
    const n = nodes.get(path);
    const start = { mx: e.clientX, my: e.clientY, ox: n.data.position.x, oy: n.data.position.y };
    let moved = false;
    const kill = dragShield();
    const move = (ev) => {
      const dx = (ev.clientX - start.mx) / view.z, dy = (ev.clientY - start.my) / view.z;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      n.data.position.x = start.ox + dx; n.data.position.y = start.oy + dy;
      n.dom.style.left = n.data.position.x + 'px'; n.dom.style.top = n.data.position.y + 'px';
      drawEdges();
    };
    const up = () => {
      kill(); document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
      if (moved) { n.cache.view.position = n.data.position; saveView(path); }
      else select(path);
    };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  }

  canvas.addEventListener('mousedown', (e) => {
    if (e.target.closest('.node')) return;
    const start = { mx: e.clientX, my: e.clientY, ox: view.x, oy: view.y };
    canvas.classList.add('panning');
    const kill = dragShield();
    const move = (ev) => { view.x = start.ox + (ev.clientX - start.mx); view.y = start.oy + (ev.clientY - start.my); applyTransform(); };
    const up = () => { kill(); canvas.classList.remove('panning'); document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const nz = Math.min(2, Math.max(0.05, view.z * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    const r = canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const w = screenToWorld(sx, sy);
    view.z = nz; view.x = sx - w.x * nz; view.y = sy - w.y * nz;
    applyTransform();
  }, { passive: false });

  function flyTo(path) {
    const n = nodes.get(path);
    const r = canvas.getBoundingClientRect();
    const z = Math.min(0.9, (r.width * 0.8) / FRAME_W);
    view.z = z;
    view.x = r.width / 2 - (n.data.position.x + FRAME_W / 2) * z;
    view.y = r.height / 2 - (n.data.position.y + (HEAD_H + FRAME_H) / 2) * z;
    applyTransform(); select(path);
  }

  function fit() {
    if (!nodes.size) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [, n] of nodes) {
      minX = Math.min(minX, n.data.position.x); minY = Math.min(minY, n.data.position.y);
      maxX = Math.max(maxX, n.data.position.x + FRAME_W); maxY = Math.max(maxY, n.data.position.y + HEAD_H + FRAME_H);
    }
    const r = canvas.getBoundingClientRect(), pad = 80;
    view.z = Math.max(0.05, Math.min((r.width - pad) / (maxX - minX), (r.height - pad) / (maxY - minY), 1));
    view.x = (r.width - (maxX - minX) * view.z) / 2 - minX * view.z;
    view.y = (r.height - (maxY - minY) * view.z) / 2 - minY * view.z;
    applyTransform();
  }

  // --- drag-to-link edges ---------------------------------------------------
  function startLinkDrag(e, fromPath) {
    e.preventDefault(); e.stopPropagation();
    const from = nodes.get(fromPath);
    const a = centerR(from);
    const temp = document.createElementNS(SVGNS, 'path');
    temp.setAttribute('class', 'temp'); temp.setAttribute('pointer-events', 'none');
    edgesSvg.append(temp);
    const kill = dragShield();
    let hover = null;
    const move = (ev) => {
      const w = canvasPoint(ev);
      temp.setAttribute('d', `M ${a.x} ${a.y} C ${a.x + 80} ${a.y}, ${w.x - 80} ${w.y}, ${w.x} ${w.y}`);
      const t = nodeAtWorld(w.x, w.y);
      if (t !== hover) {
        if (hover && nodes.get(hover)) nodes.get(hover).dom.classList.remove('link-target');
        hover = t;
        if (hover && hover !== fromPath) nodes.get(hover).dom.classList.add('link-target');
      }
    };
    const up = (ev) => {
      kill(); temp.remove();
      document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
      const w = canvasPoint(ev);
      const to = nodeAtWorld(w.x, w.y);
      if (to && nodes.get(to)) nodes.get(to).dom.classList.remove('link-target');
      if (to && to !== fromPath) {
        from.cache.view.links = from.cache.view.links || [];
        if (from.cache.view.links.some((l) => l.to === to)) { toast('Already linked'); return; }
        from.cache.view.links.push({ to, label: '' });
        saveView(fromPath).then(() => { drawEdges(); if (selected === fromPath) fillLinks(fromPath); toast('Linked'); });
      }
    };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  }

  // --- edge editor ----------------------------------------------------------
  let editingEdge = null;
  function openEdgePop(fromPath, linkIndex, clientX, clientY) {
    editingEdge = { fromPath, linkIndex };
    const link = nodes.get(fromPath).cache.view.links[linkIndex];
    const pop = $('edge-pop');
    pop.hidden = false;
    pop.style.left = clientX + 'px'; pop.style.top = clientY + 'px';
    $('edge-label').value = link.label || '';
    $('edge-label').focus();
  }
  $('edge-save').addEventListener('click', async () => {
    if (!editingEdge) return;
    const { fromPath, linkIndex } = editingEdge;
    nodes.get(fromPath).cache.view.links[linkIndex].label = $('edge-label').value;
    await saveView(fromPath); $('edge-pop').hidden = true; editingEdge = null;
    drawEdges();
  });
  $('edge-del').addEventListener('click', async () => {
    if (!editingEdge) return;
    const { fromPath, linkIndex } = editingEdge;
    nodes.get(fromPath).cache.view.links.splice(linkIndex, 1);
    await saveView(fromPath); $('edge-pop').hidden = true; editingEdge = null;
    drawEdges(); if (selected === fromPath) fillLinks(fromPath);
  });

  // --- comments: inline composer (no blocking prompts) ----------------------
  let pendingSelector = null;
  $('add-comment').addEventListener('click', () => {
    if (!selected) return;
    $('pin-hint').hidden = false;
    nodes.get(selected).dom.classList.add('pinning');
    armPinCapture(selected);
  });
  function armPinCapture(path) {
    const n = nodes.get(path);
    let doc;
    try { doc = n.iframe.contentDocument; } catch { return; }
    const onClick = (e) => {
      e.preventDefault(); e.stopPropagation();
      doc.removeEventListener('click', onClick, true);
      n.dom.classList.remove('pinning');
      $('pin-hint').hidden = true;
      pendingSelector = cssPath(e.target);
      $('composer-selector').textContent = pendingSelector;
      $('composer-text').value = '';
      $('composer').hidden = false;
      $('composer-text').focus();
    };
    doc.addEventListener('click', onClick, true);
  }
  $('composer-cancel').addEventListener('click', () => { $('composer').hidden = true; pendingSelector = null; });
  $('composer-save').addEventListener('click', async () => {
    const text = $('composer-text').value.trim();
    if (!text || !selected) { $('composer').hidden = true; return; }
    const n = nodes.get(selected);
    n.cache.comments.comments = n.cache.comments.comments || [];
    n.cache.comments.comments.push({ id: 'c' + Date.now(), selector: pendingSelector, text, status: 'open' });
    await saveComments(selected);
    $('composer').hidden = true; pendingSelector = null;
    fillComments(selected); renderPins(selected); render();
  });

  function cssPath(node) {
    if (!node || node.nodeType !== 1) return '';
    if (node.id) return '#' + CSS.escape(node.id);
    const parts = [];
    let eln = node;
    while (eln && eln.nodeType === 1 && eln.tagName.toLowerCase() !== 'html') {
      if (eln.id) { parts.unshift('#' + CSS.escape(eln.id)); break; }
      let sel = eln.tagName.toLowerCase();
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

  // --- copy Claude prompts --------------------------------------------------
  $('copy-prompt').addEventListener('click', () => {
    if (!selected) return;
    const n = nodes.get(selected);
    const open = (n.cache.comments.comments || []).filter((c) => c.status !== 'resolved');
    if (!open.length) { toast('No open comments on this view'); return; }
    copy(`Resolve the ${open.length} open Easel comment(s) on ${selected}. Follow the easel-resolve skill: edit design-canvas/modules/${selected}/index.html at each pinned selector to satisfy the comment text, then mark them resolved in comments.json.`);
  });
  $('copy-all').addEventListener('click', () => {
    let total = 0;
    for (const [, n] of nodes) total += (n.cache.comments.comments || []).filter((c) => c.status !== 'resolved').length;
    if (!total) { toast('No open comments anywhere'); return; }
    copy(`Resolve all ${total} open Easel canvas comments across design-canvas/modules/**. Follow the easel-resolve skill: for each open comment, edit that view's index.html at the pinned selector, then mark it resolved.`);
  });

  // --- rail actions: rename / duplicate / delete ---------------------------
  $('act-duplicate').addEventListener('click', async () => {
    if (!selected) return;
    const res = await post('/api/duplicate', { path: selected });
    if (res.ok) { await reloadTree(); if (nodes.has(res.path)) flyTo(res.path); toast('Duplicated'); }
    else toast(res.error || 'Duplicate failed');
  });
  $('act-delete').addEventListener('click', async () => {
    if (!selected) return;
    if (!deleteArmed) { deleteArmed = true; $('act-delete').textContent = 'click again to delete'; $('act-delete').classList.add('armed'); return; }
    const path = selected;
    const res = await post('/api/delete', { path });
    if (res.ok) { selected = null; await reloadTree(false); toast('Deleted'); } else toast(res.error || 'Delete failed');
  });
  $('act-rename').addEventListener('click', () => {
    if (!selected) return;
    const cur = selected.split('/')[1];
    const wrap = $('v-path').parentElement;
    wrap.innerHTML = '';
    const input = el('input', 'rename-input'); input.value = cur;
    const go = el('button', null, 'save');
    wrap.append(input, go);
    input.focus(); input.select();
    const commit = async () => {
      const res = await post('/api/rename', { path: selected, id: input.value });
      if (res.ok) { selected = res.path; await reloadTree(); if (nodes.has(res.path)) select(res.path); toast('Renamed'); }
      else { toast(res.error || 'Rename failed'); if (selected) select(selected); }
    };
    go.addEventListener('click', commit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') select(selected); });
  });

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

  $('add-view').addEventListener('click', () => { $('insert-form').hidden = false; $('insert-title').focus(); });
  $('insert-cancel').addEventListener('click', () => { $('insert-form').hidden = true; });
  $('insert-create').addEventListener('click', async () => {
    const module = $('insert-module').value.trim();
    const title = $('insert-title').value.trim();
    const parent = $('insert-parent').value.trim();
    if (!module || !title) { toast('Module and title required'); return; }
    const res = await post('/api/insert', { module, title, parent: parent || null });
    $('insert-form').hidden = true;
    $('insert-module').value = ''; $('insert-title').value = ''; $('insert-parent').value = '';
    if (res.ok) { await reloadTree(); if (nodes.has(res.path)) flyTo(res.path); toast('View created'); }
    else toast(res.error || 'Create failed');
  });

  // --- keyboard shortcuts ---------------------------------------------------
  document.addEventListener('keydown', (e) => {
    if (/input|textarea|select/i.test(e.target.tagName)) return;
    if (e.key === 'f') fit();
    if (e.key === 'Escape') { $('insert-form').hidden = true; $('edge-pop').hidden = true; $('composer').hidden = true; }
    if (e.key === '=' || e.key === '+') { view.z = Math.min(2, view.z * 1.2); applyTransform(); }
    if (e.key === '-') { view.z = Math.max(0.05, view.z / 1.2); applyTransform(); }
  });

  // --- live reload ----------------------------------------------------------
  try {
    const es = new EventSource('/__reload');
    let t;
    es.onmessage = () => { clearTimeout(t); t = setTimeout(() => reloadTree(true), 150); };
  } catch {}

  load();
})();
