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
    drawMinimapViewport();
    updateViewports();
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
    // don't rebuild the rail out from under an active inline editor (rename / composer)
    const editing = !$('composer').hidden || !!document.querySelector('.rename-input');
    if (keepSelection && selected && nodes.has(selected)) { if (!editing) select(selected); }
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
      const right = el('div', 'node-head-right');
      const open = (n.cache.comments.comments || []).filter((c) => c.status !== 'resolved').length;
      if (open) right.append(el('span', 'node-badge', open + '💬'));
      const expand = el('span', 'node-expand', '⛶'); expand.title = 'Open full screen';
      expand.addEventListener('mousedown', (e) => { e.stopPropagation(); openFocus(path); });
      right.append(expand);
      head.append(right);
      node.append(head);

      const frame = el('div', 'node-frame');
      const ph = el('div', 'placeholder');
      ph.append(el('div', 'ph-title', d.title));
      frame.append(ph);
      node.append(frame);

      const handle = el('div', 'link-handle', '↗');
      handle.title = 'Drag to another view to link';
      handle.addEventListener('mousedown', (e) => startLinkDrag(e, path));
      node.append(handle);

      nodesLayer.append(node);
      n.dom = node; n.frame = frame; n.iframe = null; n.mounted = false;

      head.addEventListener('mousedown', (e) => startNodeDrag(e, path));
      head.addEventListener('dblclick', () => openFocus(path));
    }
    if (selected && nodes.has(selected)) nodes.get(selected).dom.classList.add('selected');
    drawGroups();
    drawEdges();
    applyFilter();
    drawMinimap();
    updateOverviewCount();
    applyTransform();   // also runs updateViewports()
  }

  // --- iframe virtualization: only mount prototypes near the viewport --------
  function mountIframe(n) {
    if (n.mounted) return;
    const iframe = document.createElement('iframe');
    iframe.src = n.data.url;
    iframe.addEventListener('load', () => renderPins(n.data.id));
    n.frame.append(iframe);
    n.iframe = iframe; n.mounted = true;
  }
  function unmountIframe(n) {
    if (!n.mounted) return;
    if (n.iframe) n.iframe.remove();
    n.iframe = null; n.mounted = false;
    n.dom.querySelectorAll('.pin').forEach((p) => p.remove());
  }
  function updateViewports() {
    const r = canvas.getBoundingClientRect();
    const farOverview = view.z < 0.15;              // bird's-eye stays cheap: placeholders only
    const margin = Math.max(r.width, r.height) * 0.6;
    for (const [, n] of nodes) {
      if (!n.dom) continue;
      const d = n.data.position;
      const left = view.x + d.x * view.z, top = view.y + d.y * view.z;
      const w = FRAME_W * view.z, h = (HEAD_H + FRAME_H) * view.z;
      const visible = !farOverview && left < r.width + margin && left + w > -margin && top < r.height + margin && top + h > -margin;
      if (visible || n.data.id === selected) mountIframe(n); else unmountIframe(n);
    }
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

  // --- module group backdrops ----------------------------------------------
  function drawGroups() {
    const groups = $('groups');
    groups.innerHTML = '';
    const byMod = new Map();
    for (const [, n] of nodes) {
      const m = n.data._module;
      if (!byMod.has(m.id)) byMod.set(m.id, { mod: m, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
      const g = byMod.get(m.id), d = n.data.position;
      g.minX = Math.min(g.minX, d.x); g.minY = Math.min(g.minY, d.y);
      g.maxX = Math.max(g.maxX, d.x + FRAME_W); g.maxY = Math.max(g.maxY, d.y + HEAD_H + FRAME_H);
    }
    const PAD = 60;
    for (const [, g] of byMod) {
      const color = g.mod.color || '#94a3b8';
      const div = el('div', 'group');
      div.style.left = (g.minX - PAD) + 'px'; div.style.top = (g.minY - PAD) + 'px';
      div.style.width = (g.maxX - g.minX + PAD * 2) + 'px'; div.style.height = (g.maxY - g.minY + PAD * 2) + 'px';
      div.style.borderColor = color; div.style.background = color + '12';
      const label = el('div', 'group-label', g.mod.title); label.style.color = color;
      div.append(label);
      groups.append(div);
    }
  }

  // --- status filter --------------------------------------------------------
  const activeStatus = new Set(['idea', 'in-progress', 'in-review', 'approved']);
  function applyFilter() {
    for (const [, n] of nodes) n.dom && n.dom.classList.toggle('dim', !activeStatus.has(n.data.status));
  }
  [...document.querySelectorAll('.chip')].forEach((chip) => {
    chip.classList.add('on');
    chip.addEventListener('click', () => {
      const s = chip.dataset.status;
      if (activeStatus.has(s)) { activeStatus.delete(s); chip.classList.remove('on'); chip.classList.add('off'); }
      else { activeStatus.add(s); chip.classList.add('on'); chip.classList.remove('off'); }
      applyFilter();
    });
  });

  // --- comment overview drawer ---------------------------------------------
  function updateOverviewCount() {
    let t = 0;
    for (const [, n] of nodes) t += (n.cache.comments.comments || []).filter((c) => c.status !== 'resolved').length;
    $('overview-count').textContent = t || '';
    if (!$('overview').hidden) buildOverview();
  }
  function buildOverview() {
    const list = $('overview-list');
    list.innerHTML = '';
    let any = false;
    for (const [path, n] of nodes) {
      (n.cache.comments.comments || []).forEach((c, i) => {
        if (c.status === 'resolved') return;
        any = true;
        const item = el('div', 'ov-item');
        item.append(el('div', 'ov-view', n.data.title), el('div', 'ov-text', c.text));
        item.addEventListener('click', () => { flyTo(path); setTimeout(() => highlightComment(i), 60); });
        list.append(item);
      });
    }
    if (!any) list.append(el('div', 'ov-empty', 'No open comments. Nice.'));
  }
  $('overview-toggle').addEventListener('click', () => {
    const ov = $('overview');
    ov.hidden = !ov.hidden;
    if (!ov.hidden) buildOverview();
  });
  $('overview-close').addEventListener('click', () => { $('overview').hidden = true; });

  // --- minimap --------------------------------------------------------------
  const MM_W = 200, MM_H = 140, MM_PAD = 20;
  let mmScale = 1, mmOff = { x: 0, y: 0 };
  function drawMinimap() {
    const mm = $('minimap');
    mm.innerHTML = '';
    if (!nodes.size) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [, n] of nodes) {
      const d = n.data.position;
      minX = Math.min(minX, d.x); minY = Math.min(minY, d.y);
      maxX = Math.max(maxX, d.x + FRAME_W); maxY = Math.max(maxY, d.y + HEAD_H + FRAME_H);
    }
    mmScale = Math.min((MM_W - MM_PAD) / (maxX - minX), (MM_H - MM_PAD) / (maxY - minY));
    mmOff = { x: minX, y: minY };
    for (const [, n] of nodes) {
      const d = n.data.position;
      const r = document.createElementNS(SVGNS, 'rect');
      r.setAttribute('class', 'mm-node');
      r.setAttribute('x', (d.x - minX) * mmScale + MM_PAD / 2);
      r.setAttribute('y', (d.y - minY) * mmScale + MM_PAD / 2);
      r.setAttribute('width', FRAME_W * mmScale);
      r.setAttribute('height', (HEAD_H + FRAME_H) * mmScale);
      r.setAttribute('rx', 2);
      mm.append(r);
    }
    const vp = document.createElementNS(SVGNS, 'rect');
    vp.setAttribute('class', 'mm-view'); vp.id = 'mm-view';
    mm.append(vp);
    drawMinimapViewport();
  }
  function drawMinimapViewport() {
    const vp = document.getElementById('mm-view');
    if (!vp) return;
    const r = canvas.getBoundingClientRect();
    const wx = -view.x / view.z, wy = -view.y / view.z;
    vp.setAttribute('x', (wx - mmOff.x) * mmScale + MM_PAD / 2);
    vp.setAttribute('y', (wy - mmOff.y) * mmScale + MM_PAD / 2);
    vp.setAttribute('width', (r.width / view.z) * mmScale);
    vp.setAttribute('height', (r.height / view.z) * mmScale);
  }
  $('minimap').addEventListener('click', (e) => {
    const r = $('minimap').getBoundingClientRect();
    const wx = (e.clientX - r.left - MM_PAD / 2) / mmScale + mmOff.x;
    const wy = (e.clientY - r.top - MM_PAD / 2) / mmScale + mmOff.y;
    const cr = canvas.getBoundingClientRect();
    view.x = cr.width / 2 - wx * view.z; view.y = cr.height / 2 - wy * view.z;
    applyTransform();
  });

  function renderPins(path) {
    const n = nodes.get(path);
    if (!n || !n.dom || !n.iframe) return;
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
      pin.addEventListener('mousedown', (e) => { e.stopPropagation(); select(path); highlightComment(i); openCommentPop(path, i, e.clientX, e.clientY); });
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
    mountIframe(n);   // selected view is always live (needed for pinning/highlight)
    $('rail').classList.remove('empty');
    $('rail-body').hidden = false;
    $('rail-empty').style.display = 'none';
    $('v-title').value = n.data.title;
    $('v-status').value = n.data.status;
    $('v-module').textContent = n.data._module.title;
    // rebuild the id row fresh (the inline rename UI may have replaced its contents)
    const idWrap = document.querySelector('.v-id');
    if (idWrap) {
      idWrap.textContent = '';
      const code = document.createElement('code'); code.id = 'v-path'; code.textContent = path;
      idWrap.append(code);
    }
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

  // --- comment popover: click a pin to read / resolve / delete it -----------
  let commentPopRef = null;
  function openCommentPop(path, i, x, y) {
    const c = (nodes.get(path) && nodes.get(path).cache.comments.comments || [])[i];
    if (!c) return;
    commentPopRef = { path, i };
    $('cp-text').textContent = c.text;
    $('cp-meta').textContent = `${nodes.get(path).data.title} · ${c.status || 'open'}` + (c.selector ? `\n${c.selector}` : '');
    $('cp-resolve').textContent = c.status === 'resolved' ? 'Reopen' : 'Resolve';
    const pop = $('comment-pop');
    pop.hidden = false;
    const pw = 280, ph = pop.offsetHeight || 130;
    pop.style.left = Math.max(8, Math.min(x, window.innerWidth - pw - 12)) + 'px';
    pop.style.top = Math.min(y + 12, window.innerHeight - ph - 12) + 'px';
  }
  function closeCommentPop() { $('comment-pop').hidden = true; commentPopRef = null; }
  function refreshCommentViews(path) {
    fillComments(path); renderPins(path); render();
    if (focusPath === path) renderFocusPins();
  }
  $('cp-resolve').addEventListener('click', async () => {
    if (!commentPopRef) return;
    const { path, i } = commentPopRef;
    const c = nodes.get(path).cache.comments.comments[i];
    c.status = c.status === 'resolved' ? 'open' : 'resolved';
    await saveComments(path);
    closeCommentPop(); refreshCommentViews(path);
  });
  $('cp-delete').addEventListener('click', async () => {
    if (!commentPopRef) return;
    const { path, i } = commentPopRef;
    nodes.get(path).cache.comments.comments.splice(i, 1);
    await saveComments(path);
    closeCommentPop(); refreshCommentViews(path);
  });
  $('cp-close').addEventListener('click', closeCommentPop);
  document.addEventListener('mousedown', (e) => {
    if ($('comment-pop').hidden) return;
    if (e.target.closest('#comment-pop') || e.target.closest('.pin')) return;
    closeCommentPop();
  });

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

  // Capture everything Claude Code needs to act on a pinned element: a robust
  // selector, the tag, the element's current markup, its text, and its on-screen box.
  function captureContext(elm) {
    let snippet = '', rect = null;
    try { snippet = elm.outerHTML.replace(/\s+/g, ' ').trim().slice(0, 300); } catch { /* */ }
    try { const r = elm.getBoundingClientRect(); rect = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; } catch { /* */ }
    return {
      selector: cssPath(elm),
      tag: elm.tagName ? elm.tagName.toLowerCase() : '',
      elementText: (elm.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      snippet,
      rect,
    };
  }

  // --- comments: inline composer (no blocking prompts) ----------------------
  let pendingContext = null;
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
      pendingContext = captureContext(e.target);
      $('composer-selector').textContent = pendingContext.selector;
      $('composer-text').value = '';
      $('composer').hidden = false;
      $('composer-text').focus();
    };
    doc.addEventListener('click', onClick, true);
  }
  $('composer-cancel').addEventListener('click', () => { $('composer').hidden = true; pendingContext = null; });
  $('composer-save').addEventListener('click', async () => {
    const text = $('composer-text').value.trim();
    if (!text || !selected) { $('composer').hidden = true; return; }
    const n = nodes.get(selected);
    n.cache.comments.comments = n.cache.comments.comments || [];
    n.cache.comments.comments.push({ id: 'c' + Date.now(), text, status: 'open', ...pendingContext });
    await saveComments(selected);
    $('composer').hidden = true; pendingContext = null;
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
  // Build a rich, paste-ready Claude Code prompt from open comments + their context.
  function commentBlock(path, c, i) {
    let s = `${i}. [${path}] ${JSON.stringify(c.text)}`;
    if (c.selector) s += `\n   • target selector: ${c.selector}`;
    if (c.tag) s += `\n   • element: <${c.tag}>` + (c.elementText ? ` text=${JSON.stringify(c.elementText)}` : '');
    if (c.snippet) s += `\n   • current markup: ${c.snippet}`;
    if (c.rect) s += `\n   • on-screen box: x=${c.rect.x} y=${c.rect.y} ${c.rect.w}×${c.rect.h}px`;
    return s;
  }
  function buildPrompt(paths) {
    const blocks = []; let i = 1;
    for (const p of paths) {
      if (!nodes.has(p)) continue;
      for (const c of (nodes.get(p).cache.comments.comments || [])) {
        if (c.status === 'resolved') continue;
        blocks.push(commentBlock(p, c, i++));
      }
    }
    if (!blocks.length) return null;
    return `Resolve these ${blocks.length} open Easel design comment(s). For each: open the referenced view's index.html under design-canvas/modules/<path>/, edit the element at the target selector to satisfy the comment (use the shared classes in design-canvas/shared/ds.js), then set that comment's "status" to "resolved" in the same folder's comments.json.\n\n${blocks.join('\n\n')}`;
  }
  $('copy-prompt').addEventListener('click', () => {
    if (!selected) return;
    const p = buildPrompt([selected]);
    if (!p) { toast('No open comments on this view'); return; }
    copy(p);
  });
  $('copy-all').addEventListener('click', () => {
    const p = buildPrompt([...nodes.keys()]);
    if (!p) { toast('No open comments anywhere'); return; }
    copy(p);
  });

  // --- full-page focus mode (view + contextual commenting) ------------------
  let focusPath = null;
  let focusPending = null;
  function openFocus(path) {
    const n = nodes.get(path);
    if (!n) return;
    select(path);
    focusPath = path;
    $('focus-title').textContent = `${n.data.title}  ·  ${path}`;
    $('focus-composer').hidden = true; $('focus-hint').hidden = true;
    $('focus').classList.remove('commenting');
    const fr = $('focus-frame');
    fr.onload = () => {
      renderFocusPins();
      try { fr.contentWindow.addEventListener('scroll', renderFocusPins, { passive: true }); } catch { /* */ }
    };
    fr.src = n.data.url;
    $('focus').hidden = false;
  }
  function closeFocus() { $('focus').hidden = true; $('focus-frame').src = 'about:blank'; $('focus-pins').innerHTML = ''; focusPath = null; }
  $('focus-close').addEventListener('click', closeFocus);
  $('act-focus').addEventListener('click', () => { if (selected) openFocus(selected); });
  $('focus-copy').addEventListener('click', () => {
    if (!focusPath) return;
    const p = buildPrompt([focusPath]);
    if (!p) { toast('No open comments on this view'); return; }
    copy(p);
  });

  function renderFocusPins() {
    const layer = $('focus-pins');
    layer.innerHTML = '';
    if (!focusPath) return;
    let doc;
    try { doc = $('focus-frame').contentDocument; } catch { return; }
    if (!doc) return;
    (nodes.get(focusPath).cache.comments.comments || []).forEach((c, i) => {
      let target; try { target = c.selector && doc.querySelector(c.selector); } catch { target = null; }
      if (!target) return;
      const r = target.getBoundingClientRect();
      const pin = el('div', 'pin' + (c.status === 'resolved' ? ' resolved' : ''), String(i + 1));
      pin.style.left = (r.left + r.width / 2) + 'px';
      pin.style.top = r.top + 'px';
      pin.title = c.text;
      pin.addEventListener('click', (e) => { e.stopPropagation(); openCommentPop(focusPath, i, e.clientX, e.clientY); });
      layer.append(pin);
    });
  }

  $('focus-comment').addEventListener('click', () => {
    if (!focusPath) return;
    $('focus-hint').hidden = false;
    $('focus').classList.add('commenting');
    armFocusCapture();
  });
  function armFocusCapture() {
    let doc;
    try { doc = $('focus-frame').contentDocument; } catch { return; }
    const onClick = (e) => {
      e.preventDefault(); e.stopPropagation();
      doc.removeEventListener('click', onClick, true);
      $('focus-hint').hidden = true;
      $('focus').classList.remove('commenting');
      focusPending = captureContext(e.target);
      $('focus-composer-sel').textContent = focusPending.selector;
      $('focus-composer-text').value = '';
      $('focus-composer').hidden = false;
      $('focus-composer-text').focus();
    };
    doc.addEventListener('click', onClick, true);
  }
  $('focus-composer-cancel').addEventListener('click', () => { $('focus-composer').hidden = true; focusPending = null; });
  $('focus-composer-save').addEventListener('click', async () => {
    const text = $('focus-composer-text').value.trim();
    if (!text || !focusPath) { $('focus-composer').hidden = true; return; }
    const n = nodes.get(focusPath);
    n.cache.comments.comments = n.cache.comments.comments || [];
    n.cache.comments.comments.push({ id: 'c' + Date.now(), text, status: 'open', ...focusPending });
    await saveComments(focusPath);
    $('focus-composer').hidden = true; focusPending = null;
    renderFocusPins();
    renderPins(focusPath); fillComments(focusPath); render();
  });

  // --- auto-arrange: layered layout following the edges ---------------------
  function tidyLayout() {
    const ids = [...nodes.keys()];
    if (!ids.length) return;
    const out = new Map(ids.map((id) => [id, []]));
    const indeg = new Map(ids.map((id) => [id, 0]));
    for (const [from, n] of nodes) for (const l of (n.cache.view.links || [])) if (nodes.has(l.to)) { out.get(from).push(l.to); indeg.set(l.to, indeg.get(l.to) + 1); }
    const layer = new Map();
    let roots = ids.filter((id) => indeg.get(id) === 0);
    if (!roots.length) roots = [ids[0]];
    const cap = ids.length;                          // cycle guard bound
    const queue = roots.map((id) => [id, 0]);
    while (queue.length) {
      const [id, l] = queue.shift();
      if (l > cap) continue;
      if (layer.has(id) && layer.get(id) >= l) continue;
      layer.set(id, l);
      for (const to of out.get(id)) queue.push([to, l + 1]);
    }
    for (const id of ids) if (!layer.has(id)) layer.set(id, 0);
    const byLayer = new Map();
    for (const id of ids) { const l = layer.get(id); if (!byLayer.has(l)) byLayer.set(l, []); byLayer.get(l).push(id); }
    const COLW = FRAME_W + GAP_X, ROWH = FRAME_H + HEAD_H + GAP_Y;
    const changed = [];
    for (const [l, list] of byLayer) {
      list.sort((a, b) => (nodes.get(a).data._module.title + nodes.get(a).data.title).localeCompare(nodes.get(b).data._module.title + nodes.get(b).data.title));
      list.forEach((id, i) => {
        const pos = { x: 80 + l * COLW, y: 80 + i * ROWH };
        const n = nodes.get(id); n.data.position = pos; n.cache.view.position = pos; changed.push(id);
      });
    }
    Promise.all(changed.map((id) => saveView(id))).then(() => { render(); fit(); toast('Arranged'); });
  }
  $('arrange').addEventListener('click', tidyLayout);

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
    // drop a parentless view where the user is currently looking (viewport center)
    const r = canvas.getBoundingClientRect();
    const position = { x: (r.width / 2 - view.x) / view.z - FRAME_W / 2, y: (r.height / 2 - view.y) / view.z - (HEAD_H + FRAME_H) / 2 };
    const res = await post('/api/insert', { module, title, parent: parent || null, position });
    $('insert-form').hidden = true;
    $('insert-module').value = ''; $('insert-title').value = ''; $('insert-parent').value = '';
    if (res.ok) { await reloadTree(); if (nodes.has(res.path)) flyTo(res.path); toast('View created'); }
    else toast(res.error || 'Create failed');
  });

  // --- keyboard shortcuts ---------------------------------------------------
  document.addEventListener('keydown', (e) => {
    if (/input|textarea|select/i.test(e.target.tagName)) return;
    if (e.key === 'f') fit();
    if (e.key === 'Escape') { $('insert-form').hidden = true; $('edge-pop').hidden = true; $('composer').hidden = true; closeFocus(); }
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
