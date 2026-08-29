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
  // Clipboard with a legacy fallback: navigator.clipboard needs a secure
  // context + focus and silently fails in some setups, so fall back to a
  // hidden textarea + execCommand before giving up.
  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); return true; } catch { /* fall through */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) { toast('Copied to clipboard'); return true; }
    } catch { /* fall through */ }
    toast('Copy failed — select the text and press ⌘/Ctrl+C');
    return false;
  };
  // transparent overlay so mouse events keep firing while dragging over iframes
  const dragShield = () => { const s = document.createElement('div'); s.style.cssText = 'position:fixed;inset:0;z-index:9999'; document.body.append(s); return () => s.remove(); };

  const view = { x: 40, y: 40, z: 0.35 };
  const nodes = new Map();          // path -> { data, cache:{view,comments}, dom, iframe }
  let selected = null;
  let deleteArmed = false;
  let labels = [];                  // canvas text labels (headings / post-its), from labels.json
  let activeModule = null;          // module isolation: null = show all modules
  let pendingLabel = null;          // 'heading' | 'note' while waiting for a placement click
  let pendingSketch = false;        // waiting for a click to place a new sketch frame
  let sketchEdit = null;            // { path, value, sel } while a sketch is being edited in place (survives re-render)
  const inActiveModule = (n) => !activeModule || n.data._module.id === activeModule;

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
    const [tree, labelData] = await Promise.all([api('/api/tree'), api('/api/labels')]);
    if (my !== reloadSeq) return;                 // superseded while fetching the tree
    labels = labelData.labels || [];
    fillModuleFilter(tree);
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
      node.classList.add('st-' + (d.status || 'idea'));
      if (!inActiveModule(n)) node.classList.add('mod-hidden');

      const head = el('div', 'node-head');
      const dot = el('span', 'node-dot'); dot.style.background = statusColor(d.status);
      head.append(dot, el('span', 'node-title', d.title));
      const right = el('div', 'node-head-right');
      const stChip = el('span', 'node-status', d.status);
      stChip.title = 'Change status';
      stChip.addEventListener('mousedown', (e) => e.stopPropagation());
      stChip.addEventListener('click', (e) => { e.stopPropagation(); openStatusMenu(path, e.clientX, e.clientY); });
      right.append(stChip);
      const open = (n.cache.comments.comments || []).filter((c) => c.status !== 'resolved').length;
      if (open) right.append(el('span', 'node-badge', open + '💬'));
      const isSketch = d.kind === 'sketch';
      const expand = el('span', 'node-expand', isSketch ? '✎' : '⛶'); expand.title = isSketch ? 'Edit sketch' : 'Open full screen';
      expand.addEventListener('mousedown', (e) => { e.stopPropagation(); if (isSketch) editSketch(path); else openFocus(path); });
      right.append(expand);
      head.append(right);
      node.append(head);

      let frame = null;
      if (isSketch) {
        // a sketch has no HTML: render its notes natively in the same footprint
        node.classList.add('sketch');
        const body = el('div', 'sketch-body');
        renderSketchBody(path, body);
        node.append(body);
      } else {
        frame = el('div', 'node-frame');
        const ph = el('div', 'placeholder');
        ph.append(el('div', 'ph-title', d.title));
        frame.append(ph);
        const catchEl = el('div', 'node-catch');
        catchEl.addEventListener('click', (e) => onCatchClick(e, path, frame));
        frame.append(catchEl);
        node.append(frame);
      }

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
    // don't rebuild the labels layer out from under an active label editor
    if (!document.querySelector('.label-edit')) renderLabels();
    drawMinimap();
    updateOverviewCount();
    applyTransform();   // also runs updateViewports()
  }

  // --- iframe virtualization: only mount prototypes near the viewport --------
  function mountIframe(n) {
    if (n.mounted || !n.frame) return;   // sketches have no frame to mount
    const iframe = document.createElement('iframe');
    iframe.src = n.data.url;
    iframe.addEventListener('load', () => { renderPins(n.data.id); armHotspotFlash(iframe); });
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
      if (!inActiveModule(n)) { unmountIframe(n); continue; }
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
      if (!inActiveModule(n)) continue;
      // merge author-drawn edges (view.json) with real-navigation edges derived from the markup
      const edges = [];
      (n.cache.view.links || []).forEach((l, li) => edges.push({ to: l.to, label: l.label || '', wired: !!l.wired, li }));
      for (const l of (n.data.derivedLinks || [])) if (!edges.some((e) => e.to === l.to)) edges.push({ to: l.to, label: '', wired: true, li: -1 });
      for (const link of edges) {
        const target = nodes.get(link.to);
        if (!target || !inActiveModule(target)) continue;
        const a = centerR(n), b = centerL(target);
        const dx = Math.max(80, Math.abs(b.x - a.x) * 0.4);
        const dpath = `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
        const pth = document.createElementNS(SVGNS, 'path');
        pth.setAttribute('d', dpath); pth.setAttribute('pointer-events', 'none');
        if (link.wired) pth.setAttribute('class', 'wired');
        edgesSvg.append(pth);
        const hit = document.createElementNS(SVGNS, 'path');
        hit.setAttribute('d', dpath); hit.setAttribute('class', 'hit');
        hit.addEventListener('mousedown', (e) => e.stopPropagation());
        if (link.li >= 0) hit.addEventListener('click', (e) => { e.stopPropagation(); openEdgePop(from, link.li, e.clientX, e.clientY); });
        else hit.addEventListener('click', (e) => { e.stopPropagation(); toast('This link is wired in the prototype markup — edit the HTML to change it'); });
        edgesSvg.append(hit);
        if (link.label) {
          const t = document.createElementNS(SVGNS, 'text');
          t.setAttribute('class', 'edge-label');
          t.setAttribute('x', (a.x + b.x) / 2); t.setAttribute('y', (a.y + b.y) / 2 - 8);
          t.setAttribute('text-anchor', 'middle');
          t.textContent = link.label;
          edgesSvg.append(t);
        }
      }
    }
  }

  // --- module group backdrops ----------------------------------------------
  function moduleBounds() {
    const byMod = new Map();
    for (const [, n] of nodes) {
      const m = n.data._module;
      if (!byMod.has(m.id)) byMod.set(m.id, { mod: m, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
      const g = byMod.get(m.id), d = n.data.position;
      g.minX = Math.min(g.minX, d.x); g.minY = Math.min(g.minY, d.y);
      g.maxX = Math.max(g.maxX, d.x + FRAME_W); g.maxY = Math.max(g.maxY, d.y + HEAD_H + FRAME_H);
    }
    return byMod;
  }
  function drawGroups() {
    const groups = $('groups');
    groups.innerHTML = '';
    const byMod = moduleBounds();
    const PAD = 60;
    for (const [id, g] of byMod) {
      if (activeModule && id !== activeModule) continue;
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

  // --- status: click the chip on a frame's title bar to flip it -------------
  const STATUSES = ['idea', 'in-progress', 'in-review', 'approved'];
  function closeStatusMenu() { const m = $('status-menu'); if (m) m.remove(); }
  function openStatusMenu(path, x, y) {
    closeStatusMenu();
    const n = nodes.get(path);
    const menu = el('div'); menu.id = 'status-menu';
    for (const s of STATUSES) {
      const b = el('button', s === n.data.status ? 'cur' : null);
      const dot = el('span', 'node-dot'); dot.style.background = statusColor(s);
      b.append(dot, document.createTextNode(s));
      b.addEventListener('click', async () => {
        closeStatusMenu();
        n.data.status = s; n.cache.view.status = s;
        await saveView(path); render();
        if (selected === path) select(path);
      });
      menu.append(b);
    }
    menu.style.left = Math.min(x, window.innerWidth - 160) + 'px';
    menu.style.top = Math.min(y + 8, window.innerHeight - 150) + 'px';
    document.body.append(menu);
  }
  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('#status-menu') && !e.target.closest('.node-status')) closeStatusMenu();
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
      if (!inActiveModule(n)) continue;
      const d = n.data.position;
      minX = Math.min(minX, d.x); minY = Math.min(minY, d.y);
      maxX = Math.max(maxX, d.x + FRAME_W); maxY = Math.max(maxY, d.y + HEAD_H + FRAME_H);
    }
    if (minX === Infinity) return;
    mmScale = Math.min((MM_W - MM_PAD) / (maxX - minX), (MM_H - MM_PAD) / (maxY - minY));
    mmOff = { x: minX, y: minY };
    for (const [, n] of nodes) {
      if (!inActiveModule(n)) continue;
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
    // sketches edit in place and promote instead of opening full screen / prompting;
    // they have no elements to pin comments to
    const isSketch = n.data.kind === 'sketch';
    $('act-focus').textContent = isSketch ? '✎ Edit sketch' : '⛶ Open full screen';
    $('open-prompt').textContent = isSketch ? '⇧ Promote to design' : '⧉ Prompt for Claude';
    $('open-prompt').title = isSketch ? 'Scaffold the HTML for this sketch and open a Claude prompt seeded with its notes' : 'Open an editable Claude prompt for this view (design context + open comments)';
    $('add-comment').hidden = isSketch;
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
    // preventDefault so the click's default focus shift can't blur the label
    // editor that placeLabel is about to open
    if (pendingSketch) { e.preventDefault(); placeSketch(e); return; }
    if (pendingLabel) { e.preventDefault(); placeLabel(e); return; }
    if (e.target.closest('.node') || e.target.closest('.label')) return;
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
      if (!inActiveModule(n)) continue;
      minX = Math.min(minX, n.data.position.x); minY = Math.min(minY, n.data.position.y);
      maxX = Math.max(maxX, n.data.position.x + FRAME_W); maxY = Math.max(maxY, n.data.position.y + HEAD_H + FRAME_H);
    }
    if (minX === Infinity) return;
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
  // Per-view prompt: full design context + any open comments + a free-text
  // area, all in one editable modal (see composePrompt / openPrompt below).
  $('open-prompt').addEventListener('click', () => {
    if (!selected) return;
    if (nodes.get(selected).data.kind === 'sketch') { promoteSketch(selected); return; }
    openPrompt(composePrompt(selected), nodes.get(selected).data.title);
  });
  $('copy-all').addEventListener('click', () => {
    const p = buildPrompt([...nodes.keys()]);
    if (!p) { toast('No open comments anywhere'); return; }
    openPrompt(p, 'all open comments');
  });

  // --- full-page focus mode (view + contextual commenting) ------------------
  let focusPath = null;
  let focusPending = null;
  function openFocus(path) {
    const n = nodes.get(path);
    if (!n) return;
    if (n.data.kind === 'sketch') { editSketch(path); return; }   // sketches edit in place instead
    select(path);
    focusPath = path;
    $('focus-title').textContent = `${n.data.title}  ·  ${path}`;
    $('focus-composer').hidden = true; $('focus-hint').hidden = true;
    $('focus').classList.remove('commenting');
    const fr = $('focus-frame');
    fr.onload = () => {
      renderFocusPins();
      armHotspotFlash(fr);
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
    openPrompt(composePrompt(focusPath), nodes.get(focusPath).data.title);
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

  // --- tool modes (pointer / comment) : drop comments on any view ----------
  let tool = 'pointer';
  let dropContext = null, dropPath = null;
  function setTool(t) {
    tool = t;
    document.body.classList.toggle('mode-comment', t === 'comment');
    document.body.classList.toggle('mode-link', t === 'link');
    $('tool-pointer').classList.toggle('on', t === 'pointer');
    $('tool-comment').classList.toggle('on', t === 'comment');
    $('tool-link').classList.toggle('on', t === 'link');
    if (t !== 'comment') { $('drop').hidden = true; dropContext = null; }
    if (t !== 'link') { $('link-picker').hidden = true; clearLinkSrc(); }
  }
  $('tool-pointer').addEventListener('click', () => setTool('pointer'));
  $('tool-comment').addEventListener('click', () => setTool('comment'));
  $('tool-link').addEventListener('click', () => setTool('link'));

  function onCatchClick(e, path, frame) {
    const n = nodes.get(path);
    if (!n || !n.mounted || !n.iframe) { toast('Zoom in a little to interact with this view'); return; }
    let doc; try { doc = n.iframe.contentDocument; } catch { return; }
    if (!doc) return;
    const rect = frame.getBoundingClientRect();
    const elm = doc.elementFromPoint((e.clientX - rect.left) / view.z, (e.clientY - rect.top) / view.z);
    if (!elm) return;
    if (tool === 'link') { startLink(path, elm, e.clientX, e.clientY); return; }
    select(path);
    dropPath = path;
    dropContext = captureContext(elm);
    $('drop-sel').textContent = dropContext.selector;
    $('drop-text').value = '';
    const d = $('drop');
    d.hidden = false;
    const w = 300, h = d.offsetHeight || 150;
    d.style.left = Math.max(8, Math.min(e.clientX, window.innerWidth - w - 12)) + 'px';
    d.style.top = Math.min(e.clientY + 8, window.innerHeight - h - 12) + 'px';
    $('drop-text').focus();
  }

  // --- link mode (B): wire an element's click to another view --------------
  let linkSource = null;
  function clearLinkSrc() {
    if (linkSource && nodes.get(linkSource.path) && nodes.get(linkSource.path).dom) nodes.get(linkSource.path).dom.classList.remove('link-src');
    linkSource = null;
  }
  const relHref = (fromPath, toPath) => {
    const [fm, fv] = fromPath.split('/'), [tm, tv] = toPath.split('/');
    return fm === tm ? `../${tv}/index.html` : `../../${tm}/${tv}/index.html`;
  };
  function startLink(path, elm, x, y) {
    clearLinkSrc();
    linkSource = { path, elm, selector: cssPath(elm) };
    nodes.get(path).dom.classList.add('link-src');
    const list = $('lp-list'); list.innerHTML = '';
    for (const [p, n] of nodes) {
      if (p === path) continue;
      const b = el('button');
      b.append(document.createTextNode(n.data.title + '  '), el('span', 'lp-mod', n.data._module.title));
      b.addEventListener('click', () => wireLink(p));
      list.append(b);
    }
    const lp = $('link-picker');
    lp.hidden = false;
    lp.style.left = Math.max(8, Math.min(x, window.innerWidth - 312)) + 'px';
    lp.style.top = Math.min(y + 8, window.innerHeight - 320) + 'px';
  }
  $('lp-cancel').addEventListener('click', () => { $('link-picker').hidden = true; clearLinkSrc(); });
  async function wireLink(to) {
    const src = linkSource;
    if (!src) return;
    let before, after;
    try {
      before = src.elm.outerHTML;
      src.elm.setAttribute('data-easel-nav', relHref(src.path, to));
      src.elm.setAttribute('data-easel-view', to);
      after = src.elm.outerHTML;
    } catch { /* */ }
    const label = (src.elm.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const res = await post('/api/wire', { path: src.path, selector: src.selector, to, label, before, after });
    $('link-picker').hidden = true; clearLinkSrc();
    if (res.ok) { toast(res.wired ? 'Wired — clicking it now navigates' : 'Edge added (give the element an id to wire the click)'); await reloadTree(); }
    else toast(res.error || 'Wire failed');
  }

  // navigation from a prototype: fly to the target on the canvas, or follow it in focus
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.easel !== 'nav' || !d.target || !nodes.has(d.target)) return;
    if (!$('focus').hidden && e.source === $('focus-frame').contentWindow) openFocus(d.target);
    else flyTo(d.target);
  });

  // --- dead-click hotspot flash (Figma-style) --------------------------------
  // Clicking anything on a prototype that has no wired action briefly flashes
  // every element that DOES (data-easel-nav / links to other views), so you can
  // see at a glance where the prototype is functional and where it isn't.
  const HOTSPOT_SEL = '[data-easel-nav], a[href*="index.html"]';
  function armHotspotFlash(iframe) {
    let doc;
    try { doc = iframe.contentDocument; } catch { return; }
    if (!doc || doc.__easelFlashArmed) return;
    doc.__easelFlashArmed = true;
    doc.addEventListener('click', (e) => {
      if (tool !== 'pointer') return;
      if (!e.target.closest) return;
      if (e.target.closest(HOTSPOT_SEL)) return;                       // click did something — no flash
      if (e.target.closest('input, textarea, select, label')) return;  // typing/toggling is a real interaction
      flashHotspots(doc);
    });
  }
  function flashHotspots(doc) {
    if (!doc.getElementById('__easel-flash-style')) {
      const st = doc.createElement('style');
      st.id = '__easel-flash-style';
      st.textContent = '.__easel-flash{animation:__easel-flash .7s ease-out}' +
        '@keyframes __easel-flash{0%,55%{outline:3px solid rgba(59,130,246,.95);outline-offset:2px;box-shadow:0 0 0 5px rgba(59,130,246,.22)}' +
        '100%{outline:3px solid rgba(59,130,246,0);outline-offset:2px;box-shadow:0 0 0 5px rgba(59,130,246,0)}}';
      (doc.head || doc.documentElement).append(st);
    }
    doc.querySelectorAll(HOTSPOT_SEL).forEach((h) => {
      h.classList.remove('__easel-flash');
      void h.offsetWidth;   // restart the animation if it's mid-flight
      h.classList.add('__easel-flash');
      setTimeout(() => h.classList.remove('__easel-flash'), 750);
    });
  }
  $('drop-cancel').addEventListener('click', () => { $('drop').hidden = true; dropContext = null; });
  $('drop-save').addEventListener('click', async () => {
    const text = $('drop-text').value.trim();
    if (!text || !dropPath) { $('drop').hidden = true; return; }
    const n = nodes.get(dropPath);
    n.cache.comments.comments = n.cache.comments.comments || [];
    n.cache.comments.comments.push({ id: 'c' + Date.now(), text, status: 'open', ...dropContext });
    await saveComments(dropPath);
    $('drop').hidden = true; dropContext = null;
    fillComments(dropPath); renderPins(dropPath); render();
  });

  // --- canvas labels: big headings + post-it notes ---------------------------
  // Free-floating text objects: section headings to organize the canvas, and
  // post-it notes to annotate screens for engineers. Persisted in labels.json
  // at the canvas root; each label remembers which module backdrop it sits in
  // so it follows that module when the canvas is isolated to one module.
  const saveLabels = () => post('/api/labels', { labels });
  function moduleAt(wx, wy) {
    const PAD = 60;
    for (const [id, g] of moduleBounds())
      if (wx >= g.minX - PAD && wx <= g.maxX + PAD && wy >= g.minY - PAD && wy <= g.maxY + PAD) return id;
    return null;
  }
  function renderLabels() {
    const layer = $('labels');
    layer.innerHTML = '';
    for (const lb of labels) {
      if (activeModule && lb.module && lb.module !== activeModule) continue;
      const div = el('div', 'label ' + (lb.kind === 'heading' ? 'label-heading' : 'label-note'));
      div.style.left = lb.x + 'px'; div.style.top = lb.y + 'px';
      div.append(el('div', 'label-text', lb.text));
      const del = el('button', 'label-del', '×'); del.title = 'Delete';
      del.addEventListener('mousedown', (e) => e.stopPropagation());
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        labels = labels.filter((l) => l.id !== lb.id);
        await saveLabels(); renderLabels();
      });
      div.append(del);
      div.addEventListener('mousedown', (e) => startLabelDrag(e, lb, div));
      div.addEventListener('dblclick', (e) => { e.stopPropagation(); editLabel(lb, div); });
      layer.append(div);
    }
  }
  function startLabelDrag(e, lb, div) {
    if (e.target.closest('.label-edit')) return;
    e.preventDefault(); e.stopPropagation();
    const start = { mx: e.clientX, my: e.clientY, ox: lb.x, oy: lb.y };
    let moved = false;
    const kill = dragShield();
    const move = (ev) => {
      const dx = (ev.clientX - start.mx) / view.z, dy = (ev.clientY - start.my) / view.z;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      lb.x = start.ox + dx; lb.y = start.oy + dy;
      div.style.left = lb.x + 'px'; div.style.top = lb.y + 'px';
    };
    const up = () => {
      kill(); document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
      if (moved) { lb.module = moduleAt(lb.x, lb.y); saveLabels(); }
      else editLabel(lb, div);
    };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  }
  function editLabel(lb, div) {
    const txt = div.querySelector('.label-text');
    if (!txt) return;
    const ta = document.createElement('textarea');
    ta.className = 'label-edit';
    ta.value = lb.text || '';
    ta.rows = lb.kind === 'heading' ? 1 : 4;
    txt.replaceWith(ta);
    // focus after the triggering event's default handling so it can't be
    // immediately blurred (a blur commits — and deletes an empty label)
    setTimeout(() => { ta.focus(); ta.select(); }, 0);
    let done = false;
    const commit = async (cancel) => {
      if (done) return; done = true;
      if (!cancel) lb.text = ta.value.trim();
      if (!lb.text) labels = labels.filter((l) => l.id !== lb.id);   // empty label = delete
      await saveLabels();
      renderLabels();
    };
    ta.addEventListener('mousedown', (e) => e.stopPropagation());
    ta.addEventListener('blur', () => commit(false));
    ta.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Escape') commit(true);
      if (ev.key === 'Enter' && (lb.kind === 'heading' || ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); commit(false); }
    });
  }
  function armLabel(kind) {
    pendingLabel = kind;
    document.body.classList.add('mode-place-label');
    toast(kind === 'heading' ? 'Click the canvas to place the heading' : 'Click the canvas to place the note');
  }
  function placeLabel(e) {
    const w = canvasPoint(e);
    const kind = pendingLabel;
    pendingLabel = null;
    document.body.classList.remove('mode-place-label');
    const lb = { id: 'l' + Date.now(), kind, text: '', x: w.x, y: w.y, module: moduleAt(w.x, w.y) };
    labels.push(lb);
    renderLabels();
    const div = $('labels').lastElementChild;
    if (div) editLabel(lb, div);
  }
  $('add-heading').addEventListener('click', () => armLabel('heading'));
  $('add-note').addEventListener('click', () => armLabel('note'));

  // --- sketch mode: rough frames with no HTML, edited right on the canvas ----
  // A sketch is a view whose notes live in view.json (`sketch.text`) and which
  // has no index.html yet. The text is markdown-ish: a leading paragraph is the
  // blurb, "## Title" opens a region of the screen, "- item" lists what lives
  // there, "? question" is an open scoping question. Promoting the sketch
  // scaffolds index.html and hands the notes to the Claude prompt as the brief.
  function parseSketch(text) {
    const out = { blurb: [], regions: [], questions: [] };
    let cur = null;
    for (const raw of String(text || '').split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      let m;
      if ((m = line.match(/^#{1,3}\s+(.*)$/))) { cur = { title: m[1], items: [] }; out.regions.push(cur); }
      else if ((m = line.match(/^\?\s*(.*)$/))) out.questions.push(m[1]);
      else if ((m = line.match(/^[-*•]\s+(.*)$/))) { if (!cur) { cur = { title: '', items: [] }; out.regions.push(cur); } cur.items.push(m[1]); }
      else if (cur) cur.items.push(line);
      else out.blurb.push(line);
    }
    return out;
  }
  function renderSketchBody(path, body) {
    const n = nodes.get(path);
    body.className = 'sketch-body';
    body.innerHTML = '';
    if (sketchEdit && sketchEdit.path === path) { mountSketchEditor(path, body); return; }
    const text = (n.cache.view.sketch && n.cache.view.sketch.text) || '';
    const s = parseSketch(text);
    if (!text.trim()) body.append(el('div', 'sketch-empty', 'Click to jot down what this screen is: a line about it, then "## Region" headings with "- what lives there" bullets and "? open questions".'));
    for (const b of s.blurb) body.append(el('p', 'sketch-blurb', b));
    if (s.regions.length) {
      const grid = el('div', 'sketch-grid');
      for (const r of s.regions) {
        const box = el('section', 'sketch-region');
        if (r.items.length >= 5 || s.regions.length === 1) box.classList.add('wide');
        if (r.title) box.append(el('h4', null, r.title));
        const ul = el('ul');
        for (const it of r.items) ul.append(el('li', null, it));
        box.append(ul);
        grid.append(box);
      }
      body.append(grid);
    }
    if (s.questions.length) {
      const q = el('div', 'sketch-q');
      q.append(el('h4', null, 'Open questions'));
      const ul = el('ul');
      for (const it of s.questions) ul.append(el('li', null, it));
      q.append(ul);
      body.append(q);
    }
    body.onclick = () => {
      if (tool !== 'pointer') { toast('Sketches have no elements to pin — promote it to a design first'); return; }
      editSketch(path);
    };
    // long sketches scroll inside the frame; short ones let the wheel zoom the canvas
    body.onwheel = (e) => { if (body.scrollHeight > body.clientHeight + 2) e.stopPropagation(); };
  }
  function mountSketchEditor(path, body) {
    body.classList.add('editing');
    const ta = el('textarea', 'sketch-edit');
    ta.value = sketchEdit.value;
    ta.placeholder = 'One line about this screen\n\n## Region\n- what lives here\n\n? open question';
    body.append(ta, el('div', 'sketch-hint', '⌘/Ctrl+Enter or click away to save · Esc to cancel'));
    const sel = sketchEdit.sel;
    // focus after the triggering click's default handling so it can't be blurred at once
    setTimeout(() => { ta.focus(); if (sel != null) ta.setSelectionRange(sel, sel); }, 0);
    let done = false;
    const commit = async (cancel) => {
      if (done) return; done = true;
      const n = nodes.get(path);
      sketchEdit = null;
      if (!cancel && n) {
        n.cache.view.sketch = { text: ta.value.replace(/\s+$/, '') };
        await saveView(path);
      }
      if (n && n.dom) { const b = n.dom.querySelector('.sketch-body'); if (b) renderSketchBody(path, b); }
    };
    ta.addEventListener('input', () => { if (sketchEdit) { sketchEdit.value = ta.value; sketchEdit.sel = ta.selectionStart; } });
    ta.addEventListener('mousedown', (e) => e.stopPropagation());
    ta.addEventListener('wheel', (e) => e.stopPropagation());
    ta.addEventListener('blur', () => commit(false));
    ta.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Escape') { ev.preventDefault(); commit(true); }
      if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); commit(false); }
    });
  }
  function editSketch(path) {
    const n = nodes.get(path);
    if (!n || !n.dom || n.data.kind !== 'sketch') return;
    if (sketchEdit && sketchEdit.path === path) return;
    select(path);
    sketchEdit = { path, value: (n.cache.view.sketch && n.cache.view.sketch.text) || '', sel: null };
    const body = n.dom.querySelector('.sketch-body');
    if (body) renderSketchBody(path, body);
  }
  // Promote: scaffold the HTML, then open the Claude prompt seeded with the notes.
  async function promoteSketch(path) {
    const n = nodes.get(path);
    if (!n) return;
    const title = n.data.title;
    const res = await post('/api/promote', { path });
    if (!res.ok) { toast(res.error || 'Promote failed'); return; }
    await reloadTree();
    if (nodes.has(path)) { select(path); openPrompt(composePrompt(path, 'Build this screen from the sketch notes above.'), title); }
    toast('Promoted to a design — paste the prompt into Claude Code');
  }
  // Quick-add: click the canvas where the sketch goes, name it, start typing.
  function armSketch() {
    pendingSketch = true; pendingLabel = null;
    document.body.classList.add('mode-place-label');
    toast('Click the canvas where the sketch should go');
  }
  function closeSketchForm() { $('sketch-form').hidden = true; }
  function placeSketch(e) {
    const w = canvasPoint(e);
    pendingSketch = false;
    document.body.classList.remove('mode-place-label');
    const form = $('sketch-form');
    form.style.left = Math.min(e.clientX, window.innerWidth - 320) + 'px';
    form.style.top = Math.min(e.clientY, window.innerHeight - 190) + 'px';
    form._pos = { x: w.x, y: w.y };
    $('sketch-module').value = activeModule || moduleAt(w.x, w.y) || '';
    $('sketch-title').value = '';
    form.hidden = false;
    ($('sketch-module').value ? $('sketch-title') : $('sketch-module')).focus();
  }
  async function createSketch() {
    const module = $('sketch-module').value.trim(), title = $('sketch-title').value.trim();
    if (!module || !title) { toast('Module and title required'); return; }
    const position = $('sketch-form')._pos || { x: 80, y: 80 };
    closeSketchForm();
    const res = await post('/api/insert', { module, title, sketch: true, position });
    if (!res.ok) { toast(res.error || 'Create failed'); return; }
    await reloadTree();
    if (nodes.has(res.path)) editSketch(res.path);
  }
  $('add-sketch').addEventListener('click', armSketch);
  $('sketch-create').addEventListener('click', createSketch);
  $('sketch-cancel').addEventListener('click', closeSketchForm);
  for (const id of ['sketch-module', 'sketch-title']) {
    $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') createSketch(); if (e.key === 'Escape') closeSketchForm(); });
  }

  // --- module switcher: view one module at a time ----------------------------
  function fillModuleFilter(tree) {
    const sel = $('module-filter');
    const cur = sel.value;
    sel.innerHTML = '';
    const all = el('option', null, 'all modules'); all.value = '';
    sel.append(all);
    for (const m of tree.modules) { const o = el('option', null, m.title); o.value = m.id; sel.append(o); }
    // the same module ids feed the quick-sketch form's autocomplete
    const dl = $('module-list');
    if (dl) { dl.innerHTML = ''; for (const m of tree.modules) { const o = el('option'); o.value = m.id; dl.append(o); } }
    sel.value = [...sel.options].some((o) => o.value === cur) ? cur : '';
    activeModule = sel.value || null;
  }
  $('module-filter').addEventListener('change', () => {
    activeModule = $('module-filter').value || null;
    render(); fit();
  });

  // --- toolbar --------------------------------------------------------------
  // zoom about the viewport centre so keyboard/toolbar zoom stays anchored
  function zoomBy(f) {
    const r = canvas.getBoundingClientRect();
    const sx = r.width / 2, sy = r.height / 2;
    const w = screenToWorld(sx, sy);
    view.z = Math.min(2, Math.max(0.05, view.z * f));
    view.x = sx - w.x * view.z; view.y = sy - w.y * view.z;
    applyTransform();
  }
  $('fit').addEventListener('click', fit);
  $('zoom-in').addEventListener('click', () => zoomBy(1.2));
  $('zoom-out').addEventListener('click', () => zoomBy(1 / 1.2));
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
    const desc = $('insert-desc').value.trim();
    if (!module || !title) { toast('Module and title required'); return; }
    // drop a parentless view where the user is currently looking (viewport center)
    const r = canvas.getBoundingClientRect();
    const position = { x: (r.width / 2 - view.x) / view.z - FRAME_W / 2, y: (r.height / 2 - view.y) / view.z - (HEAD_H + FRAME_H) / 2 };
    const res = await post('/api/insert', { module, title, parent: parent || null, position });
    $('insert-form').hidden = true;
    $('insert-module').value = ''; $('insert-title').value = ''; $('insert-parent').value = ''; $('insert-desc').value = '';
    if (res.ok) {
      await reloadTree();
      if (nodes.has(res.path)) flyTo(res.path);
      if (desc && nodes.has(res.path)) openPrompt(composePrompt(res.path, desc), res.path.split('/').pop());
      else toast('View created');
    } else toast(res.error || 'Create failed');
  });

  // --- one editable Claude prompt per view ---------------------------------
  // Merges the design context (file, shared classes, links, siblings) with any
  // open comments and a blank "Additional instructions" area, so a single
  // prompt covers both "design this screen" and "apply this feedback".
  function composePrompt(path, seed) {
    const n = nodes.get(path);
    const links = (n.cache.view.links || []).map((l) => l.to);
    const sibs = [...nodes.keys()].filter((p) => p !== path && nodes.get(p).data._module.id === n.data._module.id).map((p) => nodes.get(p).data.title);
    const open = (n.cache.comments.comments || []).filter((c) => c.status !== 'resolved');
    const L = [];
    L.push(`Work on the "${n.data.title}" screen (${n.data._module.title} module).`);
    L.push(`File: design-canvas/modules/${path}/index.html — a complete, standalone HTML page.`);
    L.push('');
    L.push('Design system:');
    L.push('- Keep <script src="../../../shared/ds.js"></script> in <head> (it provides the shared design system).');
    L.push('- Build with the shared classes: .page (wrapper), .card, .btn (+ .secondary/.danger/.ghost), .badge (+ .gray/.blue/.green/.amber/.red), .field (label+input), table, .row/.between/.muted. Do not invent a parallel style system.');
    L.push('- Give buttons and links stable ids so they can be wired to other screens.');
    if (links.length) L.push(`- This view links to: ${links.join(', ')} (wire buttons with data-easel-nav where relevant).`);
    if (sibs.length) L.push(`- Sibling screens in this module (match their visual language): ${sibs.join(', ')}.`);
    // a promoted sketch carries its notes as the brief — that's the spec for the screen
    const brief = n.cache.view.brief;
    if (brief && String(brief).trim()) {
      L.push('');
      L.push('Sketch notes — this screen was scoped as a rough sketch; build it from these notes ("##" = a region of the screen, "-" = what lives in it, "?" = an open question: pick the sensible answer and say what you chose):');
      String(brief).split('\n').forEach((ln) => L.push('  ' + ln));
    }
    if (open.length) {
      L.push('');
      L.push(`Open feedback to address (${open.length}) — edit the element at each selector, then set that comment's "status" to "resolved" in design-canvas/modules/${path}/comments.json:`);
      open.forEach((c, i) => {
        L.push(`${i + 1}. ${JSON.stringify(c.text)}`);
        if (c.selector) L.push(`   • selector: ${c.selector}`);
        if (c.tag) L.push(`   • element: <${c.tag}>` + (c.elementText ? ` text=${JSON.stringify(c.elementText)}` : ''));
        if (c.snippet) L.push(`   • current markup: ${c.snippet}`);
      });
    }
    L.push('');
    L.push('Additional instructions:');
    L.push(seed ? seed.trim() : '');
    return L.join('\n');
  }
  function openPrompt(text, title) {
    if (!text) { toast('Nothing to prompt about yet'); return; }
    $('prompt-title').textContent = title || '';
    $('prompt-text').value = text;
    $('prompt-panel').hidden = false;
    const ta = $('prompt-text');
    ta.focus();
    // put the cursor at the end (the blank "Additional instructions" line)
    ta.setSelectionRange(text.length, text.length);
    ta.scrollTop = ta.scrollHeight;
  }
  $('prompt-close').addEventListener('click', () => { $('prompt-panel').hidden = true; });
  $('prompt-copy').addEventListener('click', () => {
    // Copy from the visible, selected textarea — most reliable under a real
    // click's user activation. Leave it selected so ⌘/Ctrl+C works if both
    // programmatic paths are blocked.
    const ta = $('prompt-text');
    ta.focus(); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* fall through */ }
    if (ok) { toast('Copied to clipboard'); return; }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(ta.value).then(
        () => toast('Copied to clipboard'),
        () => toast('Press ⌘/Ctrl+C to copy the selected text'),
      );
      return;
    }
    toast('Press ⌘/Ctrl+C to copy the selected text');
  });

  // --- keyboard shortcuts ---------------------------------------------------
  document.addEventListener('keydown', (e) => {
    // ⌘/Ctrl +/-/0 zoom the canvas, not the browser chrome — even from inputs
    if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0')) {
      e.preventDefault();
      if (e.key === '0') fit();
      else zoomBy(e.key === '-' ? 1 / 1.2 : 1.2);
      return;
    }
    if (/input|textarea|select/i.test(e.target.tagName)) return;
    // hold space = pan from anywhere, Figma-style: nodes/labels stop catching
    // the mouse (CSS) so a drag pans even when it starts over a design
    if (e.code === 'Space') {
      e.preventDefault();
      if (document.activeElement && document.activeElement.tagName === 'BUTTON') document.activeElement.blur();
      document.body.classList.add('space-pan');
      return;
    }
    if (e.key === 'f') fit();
    if (e.key === 'v' || e.key === 'V') setTool('pointer');
    if (e.key === 'c' || e.key === 'C') setTool('comment');
    if (e.key === 'l' || e.key === 'L') setTool('link');
    if (e.key === 's' || e.key === 'S') armSketch();
    if (e.key === 'Escape') { $('insert-form').hidden = true; $('prompt-panel').hidden = true; $('edge-pop').hidden = true; $('composer').hidden = true; $('drop').hidden = true; pendingLabel = null; pendingSketch = false; closeSketchForm(); document.body.classList.remove('mode-place-label'); closeFocus(); setTool('pointer'); }
    if (e.key === '=' || e.key === '+') zoomBy(1.2);
    if (e.key === '-') zoomBy(1 / 1.2);
  });
  document.addEventListener('keyup', (e) => {
    if (e.code === 'Space') document.body.classList.remove('space-pan');
  });
  window.addEventListener('blur', () => document.body.classList.remove('space-pan'));

  // --- live reload ----------------------------------------------------------
  // A file change (e.g. Claude Code editing a view) pings this; we rebuild the
  // canvas (which remounts iframes from disk) and, if a view is open
  // full-screen, refresh that frame too — but not while its comment composer is
  // open, so we don't yank the page out from under an in-progress annotation.
  try {
    const es = new EventSource('/__reload');
    let t;
    es.onmessage = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        reloadTree(true);
        if (focusPath && $('focus-composer').hidden) {
          const fr = $('focus-frame');
          if (fr.src && fr.src !== 'about:blank') fr.contentWindow.location.reload();
        }
      }, 150);
    };
  } catch {}

  load();
})();
