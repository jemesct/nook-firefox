'use strict';

/* global browser, chrome */
const B = typeof browser !== 'undefined' ? browser : chrome;

/* ================= constants ================= */

// pastel themes follow the OS light/dark mode; themes with a `mode`
// force light or dark UI (white needs dark text, black needs light text)
const THEMES = {
  peach: ['#ffd8a8', '#ffc9c9'],
  sky:   ['#a5d8ff', '#d0bfff'],
  mint:  ['#b2f2bb', '#96f2d7'],
  lilac: ['#d0bfff', '#fcc2d7'],
  rose:  ['#fcc2d7', '#ffd8a8'],
  ocean: ['#99e9f2', '#b197fc'],
  lemon: ['#ffec99', '#b2f2bb'],
  slate: ['#ced4da', '#a5d8ff'],
  white: { colors: ['#ffffff', '#eef0f4'], mode: 'light' },
  black: { colors: ['#2a2a32', '#0f0f13'], mode: 'dark' },
  auto:  { colors: ['#9aa0ab', '#565c66'], mode: null, auto: true },
};

function themeOf(name) {
  const t = THEMES[name] || THEMES.peach;
  return Array.isArray(t) ? { colors: t, mode: null } : t;
}

const FOLDER_EMOJI = [
  '📁', '📌', '💼', '🏠', '🎨', '🎧', '📚', '🛠️', '🧪', '🛒', '✈️', '💬',
  '📰', '🎮', '💡', '🌱', '🔥', '⭐', '🍿', '🏦', '🧠', '🎓', '🗂️', '🌈',
];

const LETTER_COLORS = [
  '#e8590c', '#5f5aa2', '#2b8a3e', '#c2255c', '#1971c2',
  '#f08c00', '#6741d9', '#0c8599', '#a61e4d', '#495057',
];

/* ================= state ================= */

let root = { grid: [], list: [] };   // ordered ids; list holds tabs + folders
let items = {};                      // id -> {id,type:'tab'|'folder',...}
let space = { name: 'Personal', theme: 'peach' };
let expanded = {};                   // folderId -> true; session-only, so folders
                                     // start collapsed every time the sidebar opens
let favcache = {};                   // hostname -> data url  (local, per device)
let uiCompact = false;               // icon-rail layout      (local, per device)
let devices = {};                    // deviceId -> {name, ts, tabs:[{t,u}]}
let deviceId = null;
let deviceName = 'Device';
let lastPublished = null;
let openTabs = [];
let dragData = null;
let renameActive = false;
let selectedTabs = new Set();        // entry ids selected in Today (shift/cmd-click)
let dismissedRemote = new Set();     // remote-tab url keys hidden this session

/* ================= tiny helpers ================= */

const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)).slice(0, 8) + Date.now().toString(36);
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') || url; }
  catch { return url || '?'; }
}

function urlKey(url) {
  return (url || '').replace(/\/$/, '');
}

function letterColor(host) {
  let h = 0;
  for (const c of host) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return LETTER_COLORS[h % LETTER_COLORS.length];
}

/* ================= persistence ================= */

const saveRoot = () => B.storage.sync.set({ root });
const saveSpace = () => B.storage.sync.set({ space });
const saveItem = (it) => B.storage.sync.set({ ['item:' + it.id]: it });
const deleteItemKey = (id) => B.storage.sync.remove('item:' + id);
const saveFavcache = debounce(() => B.storage.local.set({ favcache }), 1500);

async function loadState() {
  const all = await B.storage.sync.get(null);
  root = all.root || { grid: [], list: [] };
  space = all.space || { name: 'Personal', theme: 'peach' };
  items = {};
  devices = {};
  const STALE = 1000 * 60 * 60 * 24 * 14;
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith('item:')) {
      items[k.slice(5)] = v;
    } else if (k.startsWith('device:')) {
      const id = k.slice(7);
      if (id === deviceId) continue;
      if (!v || !v.ts || !Array.isArray(v.tabs) || Date.now() - v.ts > STALE) {
        B.storage.sync.remove(k).catch(() => {});
        continue;
      }
      devices[id] = v;
    }
  }
  // drop dangling references (e.g. partial sync)
  const keep = (id) => !!items[id];
  root.grid = (root.grid || []).filter(keep);
  root.list = (root.list || []).filter(keep);
  for (const it of Object.values(items)) {
    if (it.type === 'folder') it.children = (it.children || []).filter(keep);
  }
}

async function loadLocal() {
  const loc = await B.storage.local.get(['favcache', 'uiCompact', 'deviceId']);
  favcache = loc.favcache || {};
  uiCompact = !!loc.uiCompact;
  deviceId = loc.deviceId;
  if (!deviceId) {
    deviceId = uid().slice(0, 8);
    B.storage.local.set({ deviceId });
  }
}

/* ---------- rolling local backups ----------
   A daily snapshot of the synced data (folders, pins, space) is kept in
   storage.local on each device, so a bad sync can always be rolled back.
   Right-click the space name for "Back up now" / "Restore…". */

const BACKUP_KEEP = 7;

function snapshotFromState() {
  return JSON.parse(JSON.stringify({ ts: Date.now(), root, space, items }));
}

function backupCounts(b) {
  const vals = Object.values(b.items || {});
  return {
    folders: vals.filter((i) => i.type === 'folder').length,
    tabs: vals.filter((i) => i.type === 'tab').length,
  };
}

function backupLabel(b) {
  const { folders, tabs } = backupCounts(b);
  const d = new Date(b.ts);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${hm} — ${folders} folders, ${tabs} tabs`;
}

async function backupNow() {
  const { backups = [] } = await B.storage.local.get('backups');
  backups.unshift(snapshotFromState());
  backups.length = Math.min(backups.length, BACKUP_KEEP);
  await B.storage.local.set({ backups });
  return backups;
}

async function maybeDailyBackup() {
  const { backups = [] } = await B.storage.local.get('backups');
  const last = backups[0];
  if (last && Date.now() - last.ts < 20 * 60 * 60 * 1000) return;
  // never archive a wipe over real history: if the current state is empty
  // but the last snapshot wasn't, skip — the good snapshot must survive
  if (last && !Object.keys(items).length && backupCounts(last).tabs > 0) return;
  await backupNow();
}

async function restoreBackup(b) {
  const { folders, tabs } = backupCounts(b);
  const d = new Date(b.ts).toLocaleString();
  if (!confirm(`Replace the current folders & pins with the backup from ${d} (${folders} folders, ${tabs} tabs)?`)) return;
  await backupNow(); // snapshot the pre-restore state so this is undoable
  const all = await B.storage.sync.get(null);
  const stale = Object.keys(all).filter((k) => k.startsWith('item:'));
  if (stale.length) await B.storage.sync.remove(stale);
  const payload = { root: b.root, space: b.space };
  for (const [id, it] of Object.entries(b.items || {})) payload['item:' + id] = it;
  await B.storage.sync.set(payload);
  // the storage.onChanged listener reloads and re-renders from here
}

async function openBackupMenu(x, y) {
  const { backups = [] } = await B.storage.local.get('backups');
  const entries = [{ label: 'Back up now', fn: () => backupNow() }];
  if (backups.length) {
    entries.push('-');
    for (const b of backups) {
      entries.push({ label: 'Restore ' + backupLabel(b), fn: () => restoreBackup(b) });
    }
  }
  openMenu(x, y, entries);
}

function applyCompact() {
  // manual toggle, or forced when the panel is genuinely rail-sized
  const compact = uiCompact || window.innerWidth < 140;
  document.body.classList.toggle('compact', compact);
  const btn = $('railBtn');
  if (btn) btn.title = compact ? 'Expand sidebar layout' : 'Collapse to icon rail';
}

const reloadFromStorage = debounce(async () => {
  await loadState();
  applyTheme();
  render();
}, 150);

/* ================= favicons ================= */

function safeFav(fav) {
  if (fav && /^https?:/.test(fav) && fav.length < 500) return fav;
  return null;
}

function cacheFavicon(url, fav) {
  if (!fav || !fav.startsWith('data:') || fav.length > 20000) return;
  const host = hostOf(url);
  if (favcache[host] !== fav) {
    favcache[host] = fav;
    saveFavcache();
  }
}

function favEl(url, fav) {
  const wrap = el('span', 'fav-wrap');
  const host = hostOf(url);
  const src = fav || favcache[host] || null;
  const letter = () => {
    wrap.textContent = '';
    const l = el('span', 'fav-letter', (host[0] || '?'));
    l.style.background = letterColor(host);
    wrap.appendChild(l);
  };
  if (src) {
    const img = el('img');
    img.src = src;
    img.alt = '';
    img.addEventListener('error', letter);
    wrap.appendChild(img);
  } else {
    letter();
  }
  return wrap;
}

// If an open tab matches a saved item, keep the saved favicon fresh.
const persistFavUpdates = debounce(() => {
  const updates = {};
  for (const it of Object.values(items)) {
    if (it._favDirty) {
      delete it._favDirty;
      updates['item:' + it.id] = it;
    }
  }
  if (Object.keys(updates).length) B.storage.sync.set(updates);
}, 2000);

function refreshSavedFavicon(item, tab) {
  if (!tab.favIconUrl) return;
  cacheFavicon(tab.url, tab.favIconUrl);
  const clean = safeFav(tab.favIconUrl);
  if (clean && clean !== item.fav) {
    item.fav = clean;
    item._favDirty = true;
    persistFavUpdates();
  }
}

/* ================= mutations ================= */

function newSavedFromTab(d) {
  const it = {
    id: uid(),
    type: 'tab',
    title: d.title || hostOf(d.url),
    url: d.url,
    fav: safeFav(d.fav),
  };
  cacheFavicon(d.url, d.fav);
  items[it.id] = it;
  saveItem(it);
  return it.id;
}

// Remove id from whichever container holds it. Returns the array it was in.
function removeRefEverywhere(id) {
  let i = root.grid.indexOf(id);
  if (i > -1) { root.grid.splice(i, 1); saveRoot(); return root.grid; }
  i = root.list.indexOf(id);
  if (i > -1) { root.list.splice(i, 1); saveRoot(); return root.list; }
  for (const f of Object.values(items)) {
    if (f.type !== 'folder') continue;
    const j = (f.children || []).indexOf(id);
    if (j > -1) { f.children.splice(j, 1); saveItem(f); return f.children; }
  }
  return null;
}

function placeInto(arr, save, index, data, { tabsOnly = false } = {}) {
  if (data.kind === 'tabs') {
    const ids = data.tabs.map((d) => newSavedFromTab(d));
    index = Math.max(0, Math.min(index, arr.length));
    arr.splice(index, 0, ...ids);
    selectedTabs.clear();
    save();
    render();
    return;
  }
  let id;
  if (data.kind === 'tab') {
    id = newSavedFromTab(data);
  } else {
    id = data.id;
    const it = items[id];
    if (!it) return;
    if (tabsOnly && it.type === 'folder') return;
    const cur = arr.indexOf(id);
    removeRefEverywhere(id);
    if (cur > -1 && cur < index) index--;
  }
  index = Math.max(0, Math.min(index, arr.length));
  arr.splice(index, 0, id);
  save();
  render();
}

function unsave(id) {
  const it = items[id];
  removeRefEverywhere(id);
  if (it && it.type === 'folder') {
    for (const c of it.children || []) {
      delete items[c];
      deleteItemKey(c);
    }
  }
  delete items[id];
  deleteItemKey(id);
  render();
}

function createFolder() {
  const it = { id: uid(), type: 'folder', name: 'New Folder', emoji: '📁', children: [] };
  items[it.id] = it;
  saveItem(it);
  root.list.unshift(it.id);
  saveRoot();
  expanded[it.id] = true;
  render();
  // immediately start rename
  const head = document.querySelector(`[data-id="${it.id}"] .title`);
  if (head) startRename(head, it.name, (v) => { it.name = v; saveItem(it); render(); });
}

/* ================= tab actions ================= */

function findOpenTab(url) {
  const k = urlKey(url);
  return openTabs.find((t) => urlKey(t.url) === k);
}

async function openSaved(item) {
  const tab = findOpenTab(item.url);
  if (tab) {
    await B.tabs.update(tab.id, { active: true });
  } else {
    await B.tabs.create({ url: item.url });
  }
}

async function clearToday(todayTabs) {
  const ids = todayTabs.filter((t) => !t.active && !t.pinned).map((t) => t.id);
  if (ids.length) await B.tabs.remove(ids);
}

// One seamless Today list: this window's loose tabs first (in tab order),
// then tabs open on other synced devices — deduped by URL, no grouping.
function buildTodayList() {
  const savedKeys = new Set(Object.values(items).filter((i) => i.type === 'tab').map((i) => urlKey(i.url)));
  const list = [];
  const seen = new Set();
  for (const t of openTabs) {
    const k = urlKey(t.url);
    if (savedKeys.has(k)) continue;
    seen.add(k);
    list.push({ id: t.id, local: true, tab: t, title: t.title || t.url, url: t.url, fav: t.favIconUrl, active: t.active });
  }
  for (const [, d] of Object.entries(devices).sort((a, b) => b[1].ts - a[1].ts)) {
    for (const t of d.tabs || []) {
      const k = urlKey(t.u);
      if (savedKeys.has(k) || seen.has(k) || dismissedRemote.has(k)) continue;
      seen.add(k);
      list.push({ id: 'r:' + k, local: false, device: d.name, title: t.t || t.u, url: t.u, fav: null });
    }
  }
  return list;
}

// Reorder a real browser tab to match a drop position in the Today list.
async function reorderToday(tabId, index) {
  const list = buildTodayList();
  const entry = list.find((e) => e.local && e.tab.id === tabId);
  if (!entry) return;
  const after = list.slice(index).find((e) => e.local && e.tab.id !== tabId);
  let to;
  if (after) {
    to = after.tab.index;
    if (entry.tab.index < after.tab.index) to--;
  } else {
    to = -1; // end of the window
  }
  await B.tabs.move(tabId, { index: to });
}

const refreshTabs = debounce(async () => {
  openTabs = await B.tabs.query({ currentWindow: true });
  render();
  if (themeOf(space.theme).auto) sampleSoon();
  publishTabs();
}, 60);

// Mirror this device's open tabs to storage.sync so other browsers can show
// them. Delivery cadence is Firefox Sync's schedule — we just keep it fresh.
const publishTabs = debounce(() => {
  if (!deviceId) return;
  const tabs = openTabs
    .filter((t) => /^https?:/.test(t.url))
    .slice(0, 40)
    .map((t) => ({ t: (t.title || '').slice(0, 80), u: (t.url || '').slice(0, 250) }));
  // storage.sync rejects keys over 8KB — trim until the payload fits
  while (tabs.length && JSON.stringify(tabs).length > 7000) tabs.pop();
  const flat = JSON.stringify(tabs);
  if (flat === lastPublished) return;
  lastPublished = flat;
  B.storage.sync.set({ ['device:' + deviceId]: { name: deviceName, ts: Date.now(), tabs } }).catch(() => {});
}, 4000);

/* ================= drag & drop ================= */

function makeDraggable(node, data) {
  node.draggable = true;
  node.addEventListener('dragstart', (e) => {
    dragData = typeof data === 'function' ? data() : data;
    e.dataTransfer.setData('text/plain', dragData.url || '');
    e.dataTransfer.effectAllowed = 'move';
    requestAnimationFrame(() => document.body.classList.add('dragging'));
  });
  node.addEventListener('dragend', () => {
    dragData = null;
    document.body.classList.remove('dragging');
    clearDropMarkers();
  });
}

function clearDropMarkers() {
  document.querySelectorAll('.drop-bar').forEach((n) => n.remove());
  document.querySelectorAll('.drop-target').forEach((n) => n.classList.remove('drop-target'));
  document.querySelectorAll('.drop-into').forEach((n) => n.classList.remove('drop-into'));
}

function insertionIndex(container, e, isGrid) {
  const kids = [...container.children].filter((n) => !n.classList.contains('drop-bar') && !n.classList.contains('hint'));
  if (!kids.length) return 0;
  if (isGrid) {
    for (let i = 0; i < kids.length; i++) {
      const r = kids[i].getBoundingClientRect();
      if (e.clientY < r.bottom && e.clientX < r.left + r.width / 2) return i;
      if (e.clientY < r.top) return i;
    }
    return kids.length;
  }
  for (let i = 0; i < kids.length; i++) {
    const r = kids[i].getBoundingClientRect();
    if (e.clientY < r.top + r.height / 2) return i;
  }
  return kids.length;
}

function showMarker(container, index, isGrid) {
  clearDropMarkers();
  if (isGrid) {
    container.classList.add('drop-target');
    return;
  }
  const kids = [...container.children].filter((n) => !n.classList.contains('drop-bar') && !n.classList.contains('hint'));
  const bar = el('div', 'drop-bar');
  if (index >= kids.length) container.appendChild(bar);
  else container.insertBefore(bar, kids[index]);
}

function dropZone(container, { accept, onDrop, isGrid = false }) {
  container.addEventListener('dragover', (e) => {
    if (!dragData || !accept(dragData)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    showMarker(container, insertionIndex(container, e, isGrid), isGrid);
  });
  container.addEventListener('dragleave', (e) => {
    if (!container.contains(e.relatedTarget)) clearDropMarkers();
  });
  container.addEventListener('drop', (e) => {
    if (!dragData || !accept(dragData)) return;
    e.preventDefault();
    e.stopPropagation();
    const index = insertionIndex(container, e, isGrid);
    clearDropMarkers();
    onDrop(index, dragData);
  });
}

/* ================= popovers / menus ================= */

function closePopovers() {
  document.querySelectorAll('.popover, #overlay').forEach((n) => n.remove());
}

function openPopover(x, y, content) {
  closePopovers();
  const overlay = el('div');
  overlay.id = 'overlay';
  overlay.addEventListener('mousedown', closePopovers);
  overlay.addEventListener('contextmenu', (e) => { e.preventDefault(); closePopovers(); });
  document.body.appendChild(overlay);

  const pop = el('div', 'popover');
  pop.appendChild(content);
  document.body.appendChild(pop);
  const r = pop.getBoundingClientRect();
  pop.style.left = Math.max(6, Math.min(x, window.innerWidth - r.width - 6)) + 'px';
  pop.style.top = Math.max(6, Math.min(y, window.innerHeight - r.height - 6)) + 'px';
  return pop;
}

function openMenu(x, y, entries) {
  const menu = el('div', 'menu');
  for (const en of entries) {
    if (en === '-') { menu.appendChild(el('div', 'sep')); continue; }
    const b = el('button', en.danger ? 'danger' : '', en.label);
    b.addEventListener('click', () => { closePopovers(); en.fn(); });
    menu.appendChild(b);
  }
  openPopover(x, y, menu);
}

function openThemePicker(x, y) {
  const grid = el('div', 'swatches');
  for (const name of Object.keys(THEMES)) {
    const [c1, c2] = themeOf(name).colors;
    const b = el('button', 'swatch');
    if (themeOf(name).auto) {
      b.classList.add('auto');
      b.title = 'auto — match the website colour';
    } else {
      b.title = name;
      b.style.background = `linear-gradient(135deg, ${c1}, ${c2})`;
    }
    b.addEventListener('click', async () => {
      if (themeOf(name).auto && B.permissions) {
        // capturing the page needs site access — one-time grant
        let ok = false;
        try { ok = await B.permissions.request({ origins: ['<all_urls>'] }); } catch { /* denied */ }
        if (!ok) return;
      }
      space.theme = name;
      saveSpace();
      applyTheme();
      closePopovers();
    });
    grid.appendChild(b);
  }
  openPopover(x, y, grid);
}

function openEmojiPicker(x, y, folder) {
  const grid = el('div', 'emojis');
  for (const em of FOLDER_EMOJI) {
    const b = el('button', '', em);
    b.addEventListener('click', () => {
      folder.emoji = em;
      saveItem(folder);
      closePopovers();
      render();
    });
    grid.appendChild(b);
  }
  openPopover(x, y, grid);
}

function startRename(span, current, commit) {
  if (renameActive) return;
  renameActive = true;
  const input = el('input', 'rename');
  input.value = current;
  // nest the input instead of replacing the node so static elements
  // (e.g. #spaceName) survive the rename; render() restores the text
  span.textContent = '';
  span.appendChild(input);
  for (const ev of ['click', 'dblclick', 'mousedown', 'contextmenu']) {
    input.addEventListener(ev, (e) => e.stopPropagation());
  }
  input.focus();
  input.select();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    renameActive = false;
    const v = input.value.trim();
    if (save && v) commit(v);
    else render();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

/* ================= rendering ================= */

function applyTheme() {
  const t = themeOf(space.theme);
  if (t.auto) {
    // colours come from the active site; sample now, keep current until done
    sampleSiteColor();
    return;
  }
  const html = document.documentElement;
  html.style.setProperty('--g1', t.colors[0]);
  html.style.setProperty('--g2', t.colors[1]);
  if (t.mode) html.dataset.mode = t.mode;
  else delete html.dataset.mode;
}

/* auto theme: screenshot the active tab, average its colour, tint the
   sidebar to match, and pick light/dark text from the luminance */
async function sampleSiteColor() {
  if (!themeOf(space.theme).auto || !B.tabs.captureVisibleTab) return;
  try {
    const shot = await B.tabs.captureVisibleTab(undefined, { format: 'jpeg', quality: 40 });
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = shot; });
    const cv = document.createElement('canvas');
    cv.width = 24;
    cv.height = 24;
    const cx = cv.getContext('2d');
    cx.drawImage(img, 0, 0, 24, 24);
    const d = cx.getImageData(0, 0, 24, 24).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const mode = lum < 130 ? 'dark' : 'light';
    const f = mode === 'dark' ? 1.45 : 0.88;
    const c2 = [r, g, b].map((v) => Math.min(255, Math.round(v * f)));
    const html = document.documentElement;
    html.style.setProperty('--g1', `rgb(${r} ${g} ${b})`);
    html.style.setProperty('--g2', `rgb(${c2[0]} ${c2[1]} ${c2[2]})`);
    html.dataset.mode = mode;
  } catch {
    /* capture unavailable (about: pages etc.) — keep current colours */
  }
}
const sampleSoon = debounce(sampleSiteColor, 250);

function savedContextMenu(e, item) {
  e.preventDefault();
  openMenu(e.clientX, e.clientY, [
    { label: 'Open in new tab', fn: () => B.tabs.create({ url: item.url }) },
    { label: 'Copy link', fn: () => navigator.clipboard.writeText(item.url) },
    '-',
    { label: 'Remove', danger: true, fn: () => unsave(item.id) },
  ]);
}

function renderSavedTile(item) {
  const tile = el('div', 'tile');
  tile.dataset.id = item.id;
  tile.title = item.title + '\n' + item.url;
  const tab = findOpenTab(item.url);
  if (tab) {
    refreshSavedFavicon(item, tab);
    if (tab.active) tile.classList.add('active');
  }
  tile.appendChild(favEl(item.url, item.fav));
  tile.addEventListener('click', () => openSaved(item));
  tile.addEventListener('contextmenu', (e) => savedContextMenu(e, item));
  makeDraggable(tile, { kind: 'saved', id: item.id });
  return tile;
}

function renderSavedRow(item) {
  const row = el('div', 'row');
  row.dataset.id = item.id;
  row.title = item.title + '\n' + item.url;
  const tab = findOpenTab(item.url);
  if (tab) {
    refreshSavedFavicon(item, tab);
    if (tab.active) row.classList.add('active');
  } else {
    row.classList.add('saved-closed');
  }
  row.appendChild(favEl(item.url, item.fav));
  row.appendChild(el('span', 'title', item.title));

  const close = el('button', 'close', '×');
  if (tab) {
    close.title = 'Close tab (stays saved)';
    close.addEventListener('click', (e) => { e.stopPropagation(); B.tabs.remove(tab.id); });
  } else {
    close.title = 'Remove from folder';
    close.addEventListener('click', (e) => { e.stopPropagation(); unsave(item.id); });
  }
  row.appendChild(close);

  row.addEventListener('click', () => openSaved(item));
  row.addEventListener('contextmenu', (e) => savedContextMenu(e, item));
  makeDraggable(row, { kind: 'saved', id: item.id });
  return row;
}

function renderFolder(folder) {
  const wrap = el('div', 'folder');
  const isOpen = !!expanded[folder.id];

  const head = el('div', 'row folder-head' + (isOpen ? ' open' : ''));
  head.dataset.id = folder.id;
  head.title = folder.name;

  const chev = el('span', 'chev');
  chev.innerHTML =
    '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M3 1.5 7 5 3 8.5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  head.appendChild(chev);

  const emoji = el('span', 'emoji', folder.emoji || '📁');
  emoji.title = 'Change icon';
  emoji.addEventListener('click', (e) => {
    // in the compact rail the emoji IS the folder row — let the click
    // bubble to the head and toggle collapse instead of picking an icon
    if (document.body.classList.contains('compact')) return;
    e.stopPropagation();
    openEmojiPicker(e.clientX, e.clientY, folder);
  });
  head.appendChild(emoji);

  const title = el('span', 'title', folder.name);
  head.appendChild(title);
  head.appendChild(el('span', 'count', String((folder.children || []).length)));

  head.addEventListener('click', () => {
    expanded[folder.id] = !isOpen;
    render();
  });
  head.addEventListener('dblclick', () => {
    startRename(title, folder.name, (v) => { folder.name = v; saveItem(folder); render(); });
  });
  head.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openMenu(e.clientX, e.clientY, [
      { label: 'Rename', fn: () => startRename(title, folder.name, (v) => { folder.name = v; saveItem(folder); render(); }) },
      { label: 'Change icon', fn: () => openEmojiPicker(e.clientX, e.clientY, folder) },
      { label: 'Open all tabs', fn: () => (folder.children || []).forEach((c) => items[c] && B.tabs.create({ url: items[c].url })) },
      '-',
      {
        label: 'Delete folder', danger: true,
        fn: () => {
          const n = (folder.children || []).length;
          if (!n || confirm(`Delete "${folder.name}" and its ${n} saved tab${n === 1 ? '' : 's'}?`)) unsave(folder.id);
        },
      },
    ]);
  });

  makeDraggable(head, { kind: 'saved', id: folder.id });

  // allow dropping directly onto the folder header (append to folder)
  head.addEventListener('dragover', (e) => {
    if (!dragData) return;
    if (dragData.kind === 'saved' && (dragData.id === folder.id || items[dragData.id]?.type === 'folder')) return;
    e.preventDefault();
    e.stopPropagation();
    clearDropMarkers();
    head.classList.add('drop-into');
  });
  head.addEventListener('dragleave', () => head.classList.remove('drop-into'));
  head.addEventListener('drop', (e) => {
    if (!dragData) return;
    if (dragData.kind === 'saved' && (dragData.id === folder.id || items[dragData.id]?.type === 'folder')) return;
    e.preventDefault();
    e.stopPropagation();
    head.classList.remove('drop-into');
    placeInto(folder.children, () => saveItem(folder), folder.children.length, dragData, { tabsOnly: true });
  });

  wrap.appendChild(head);

  if (isOpen) {
    const kidsBox = el('div', 'folder-children');
    for (const cid of folder.children || []) {
      const it = items[cid];
      if (it) kidsBox.appendChild(renderSavedRow(it));
    }
    dropZone(kidsBox, {
      accept: (d) => d.kind === 'tab' || d.kind === 'tabs' || (d.kind === 'saved' && items[d.id]?.type === 'tab'),
      onDrop: (i, d) => placeInto(folder.children, () => saveItem(folder), i, d, { tabsOnly: true }),
    });
    wrap.appendChild(kidsBox);
  }
  return wrap;
}

function renderTodayRow(entry, todayList) {
  const row = el('div', 'row');
  row.title = entry.local ? entry.title : `${entry.title}\nOpen on ${entry.device}`;
  if (entry.active) row.classList.add('active');
  if (selectedTabs.has(entry.id)) row.classList.add('selected');
  if (entry.local) cacheFavicon(entry.url, entry.fav);
  row.appendChild(favEl(entry.url, entry.fav));
  row.appendChild(el('span', 'title', entry.title));

  const close = el('button', 'close', '×');
  if (entry.local) {
    close.title = 'Close tab';
    close.addEventListener('click', (e) => { e.stopPropagation(); B.tabs.remove(entry.tab.id); });
  } else {
    close.title = `Hide (open on ${entry.device})`;
    close.addEventListener('click', (e) => { e.stopPropagation(); dismissedRemote.add(urlKey(entry.url)); render(); });
  }
  row.appendChild(close);

  row.addEventListener('click', (e) => {
    if (e.shiftKey) {
      // select the range between the active tab and the clicked one
      const activeIdx = todayList.findIndex((t) => t.active);
      const anchorIdx = activeIdx >= 0 ? activeIdx : 0;
      const myIdx = todayList.indexOf(entry);
      const [a, b] = [Math.min(anchorIdx, myIdx), Math.max(anchorIdx, myIdx)];
      selectedTabs = new Set(todayList.slice(a, b + 1).map((t) => t.id));
      render();
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      if (selectedTabs.has(entry.id)) selectedTabs.delete(entry.id);
      else selectedTabs.add(entry.id);
      render();
      return;
    }
    selectedTabs.clear();
    if (entry.local) B.tabs.update(entry.tab.id, { active: true });
    else B.tabs.create({ url: entry.url });
  });
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openMenu(e.clientX, e.clientY, [
      { label: 'Pin to top grid', fn: () => placeInto(root.grid, saveRoot, root.grid.length, entryToDrag(entry)) },
      { label: 'Save below grid', fn: () => placeInto(root.list, saveRoot, root.list.length, entryToDrag(entry)) },
      { label: 'Copy link', fn: () => navigator.clipboard.writeText(entry.url) },
      '-',
      entry.local
        ? { label: 'Close tab', danger: true, fn: () => B.tabs.remove(entry.tab.id) }
        : { label: 'Hide from list', danger: true, fn: () => { dismissedRemote.add(urlKey(entry.url)); render(); } },
    ]);
  });
  // dragging a selected row drags the whole selection
  makeDraggable(row, () => {
    if (selectedTabs.has(entry.id) && selectedTabs.size > 1) {
      return {
        kind: 'tabs',
        tabs: todayList.filter((t) => selectedTabs.has(t.id)).map(entryToDrag),
      };
    }
    return entryToDrag(entry);
  });
  return row;
}

function entryToDrag(e) {
  return { kind: 'tab', tabId: e.local ? e.tab.id : undefined, url: e.url, title: e.title, fav: e.fav };
}

function render() {
  if (renameActive) return;

  // ----- header -----
  $('spaceName').textContent = space.name;

  // ----- pinned grid -----
  const grid = $('grid');
  grid.textContent = '';
  for (const id of root.grid) {
    const it = items[id];
    if (it && it.type === 'tab') grid.appendChild(renderSavedTile(it));
  }

  // ----- saved list (folders + pinned tabs) -----
  const list = $('list');
  list.textContent = '';
  for (const id of root.list) {
    const it = items[id];
    if (!it) continue;
    list.appendChild(it.type === 'folder' ? renderFolder(it) : renderSavedRow(it));
  }
  if (!root.list.length && !root.grid.length) {
    list.appendChild(el('div', 'hint', 'Drag tabs up here from Today to keep them, or make a folder with the ＋ button.'));
  }

  // ----- today: local tabs + other devices' tabs, one seamless list -----
  const todayList = buildTodayList();
  selectedTabs = new Set([...selectedTabs].filter((id) => todayList.some((e) => e.id === id)));
  const today = $('today');
  today.textContent = '';
  for (const entry of todayList) today.appendChild(renderTodayRow(entry, todayList));
  if (!todayList.length) {
    today.appendChild(el('div', 'hint', 'No loose tabs — everything is filed away. ✨'));
  }

  $('clearBtn').onclick = () => clearToday(todayList.filter((e) => e.local).map((e) => e.tab));

  layoutGrid();
}


// Balance the pinned grid into even rows (5 tiles in a 4-wide panel → 3 + 2)
// at a FIXED tile size — resizing changes how many fit per row, never the size.
function layoutGrid() {
  const grid = $('grid');
  const n = root.grid.length;
  if (!n || document.body.classList.contains('compact')) {
    grid.style.gridTemplateColumns = '';
    return;
  }
  const GAP = 8;
  const TILE = 54;
  const w = grid.clientWidth || 0;
  const maxCols = Math.max(1, Math.floor((w + GAP) / (TILE + GAP)));
  const rows = Math.ceil(n / maxCols);
  const cols = Math.max(1, Math.ceil(n / rows));
  grid.style.gridTemplateColumns = `repeat(${cols}, ${TILE}px)`;
}

/* ================= wire up static UI ================= */

function setupStatic() {
  $('spaceDot').addEventListener('click', (e) => openThemePicker(e.clientX, e.clientY + 10));

  $('spaceName').addEventListener('click', () => {
    startRename($('spaceName'), space.name, (v) => {
      space.name = v;
      saveSpace();
      render();
    });
  });

  $('spaceName').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openBackupMenu(e.clientX, e.clientY);
  });

  $('addBtn').addEventListener('click', createFolder);
  $('newTab').addEventListener('click', () => B.tabs.create({}));

  $('railBtn').addEventListener('click', () => {
    uiCompact = !uiCompact;
    B.storage.local.set({ uiCompact });
    applyCompact();
  });
  window.addEventListener('resize', () => {
    applyCompact();
    layoutGrid();
  });

  dropZone($('grid'), {
    accept: (d) => d.kind === 'tab' || d.kind === 'tabs' || (d.kind === 'saved' && items[d.id]?.type === 'tab'),
    onDrop: (i, d) => placeInto(root.grid, saveRoot, i, d, { tabsOnly: true }),
    isGrid: true,
  });

  dropZone($('list'), {
    accept: () => true,
    onDrop: (i, d) => placeInto(root.list, saveRoot, i, d),
  });

  // Today accepts: saved items (unpin) and local today tabs (reorder)
  dropZone($('today'), {
    accept: (d) =>
      (d.kind === 'saved' && items[d.id]?.type === 'tab') ||
      (d.kind === 'tab' && d.tabId != null),
    onDrop: (i, d) => {
      if (d.kind === 'tab') {
        reorderToday(d.tabId, i);
        return;
      }
      const it = items[d.id];
      if (!it) return;
      const wasOpen = findOpenTab(it.url);
      unsave(d.id);
      if (!wasOpen) B.tabs.create({ url: it.url });
    },
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closePopovers();
      if (selectedTabs.size) {
        selectedTabs.clear();
        render();
      }
    }
  });
}

/* ================= init ================= */

async function init() {
  setupStatic();
  await loadLocal();
  try {
    const p = await B.runtime.getPlatformInfo();
    const os = { mac: 'Mac', win: 'Windows', linux: 'Linux', android: 'Android' }[p.os] || p.os;
    deviceName = `${os} · ${deviceId.slice(0, 4)}`;
  } catch { /* keep default name */ }
  await loadState();
  applyTheme();
  applyCompact();
  render();

  openTabs = await B.tabs.query({ currentWindow: true });
  render();
  publishTabs();
  if (themeOf(space.theme).auto) sampleSoon();
  setTimeout(maybeDailyBackup, 3000);

  B.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') reloadFromStorage();
  });

  for (const ev of ['onCreated', 'onRemoved', 'onUpdated', 'onActivated', 'onMoved', 'onAttached', 'onDetached']) {
    if (B.tabs[ev]) B.tabs[ev].addListener(() => refreshTabs());
  }
}

init();
