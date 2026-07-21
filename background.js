'use strict';

/* global browser, chrome */
const B = typeof browser !== 'undefined' ? browser : chrome;

// ── Relay endpoint ───────────────────────────────────────────────────────
// Deploy relay/worker.js to Cloudflare (see relay/README.md) and put its
// wss:// URL here. Leave as-is to disable live sync entirely.
const RELAY_URL = 'wss://nook-relay.turner-james.workers.dev';
// ─────────────────────────────────────────────────────────────────────────

// Toolbar button toggles the sidebar.
B.action.onClicked.addListener(() => {
  B.sidebarAction.toggle().catch(() => {});
});

/* ================= cross-device tab presence =================
   This device's open tabs are shared two ways, both from the background so
   they stay current with the sidebar closed:

   1. storage.sync — Firefox Sync's own channel. Always on, but slow
      (~10 min) and best-effort. The reliable floor.
   2. Live relay — an optional, end-to-end-encrypted WebSocket to a
      Cloudflare relay (opt-in). Near-instant when both devices are online.

   The sidebar merges whatever's fresher. */

let deviceId = null;
let deviceName = 'Device';
let lastPublished = null;

function uid() {
  const r = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2);
  return r.replace(/-/g, '').slice(0, 8);
}

async function ensureDevice() {
  const got = await B.storage.local.get('deviceId');
  deviceId = got.deviceId;
  if (!deviceId) {
    deviceId = uid();
    await B.storage.local.set({ deviceId });
  }
  try {
    const p = await B.runtime.getPlatformInfo();
    const os = { mac: 'Mac', win: 'Windows', linux: 'Linux', android: 'Android' }[p.os] || p.os;
    deviceName = `${os} · ${deviceId.slice(0, 4)}`;
  } catch {
    /* keep default name */
  }
}

// Current open tabs as a compact, deduped, size-capped list.
async function computeTabs() {
  let all;
  try {
    all = await B.tabs.query({});
  } catch {
    return null;
  }
  const seen = new Set();
  const tabs = [];
  for (const t of all) {
    if (!/^https?:/.test(t.url || '')) continue;
    const u = t.url.slice(0, 250);
    if (seen.has(u)) continue; // one row per URL, even across windows
    seen.add(u);
    tabs.push({ t: (t.title || '').slice(0, 80), u });
    if (tabs.length >= 40) break;
  }
  while (tabs.length && JSON.stringify(tabs).length > 7000) tabs.pop();
  return tabs;
}

let publishTimer = null;
function schedulePublish() {
  clearTimeout(publishTimer);
  publishTimer = setTimeout(publishNow, 3000);
}

async function publishNow() {
  if (!deviceId) await ensureDevice();
  const tabs = await computeTabs();
  if (!tabs) return;
  const payload = { deviceId, name: deviceName, ts: Date.now(), tabs };

  // 1) slow, reliable channel
  const flat = JSON.stringify(tabs);
  if (flat !== lastPublished) {
    lastPublished = flat;
    B.storage.sync
      .set({ ['device:' + deviceId]: { name: deviceName, ts: payload.ts, tabs } })
      .catch(() => {});
  }

  // 2) fast channel (if connected)
  relaySend(payload);
}

/* ================= live relay (end-to-end encrypted) ================= */

let relayCfg = null;      // { enabled, roomId, keyB64 } from storage.sync
let relayKey = null;      // imported CryptoKey
let ws = null;
let wsReconnect = null;
let wsPing = null;
let relayBackoff = 1000;

function b64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function ub64(s) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function encrypt(obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, relayKey, data));
  return JSON.stringify({ t: 'tabs', iv: b64(iv), ct: b64(ct) });
}
async function decrypt(msg) {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ub64(msg.iv) },
    relayKey,
    ub64(msg.ct),
  );
  return JSON.parse(new TextDecoder().decode(pt));
}

async function loadRelayConfig() {
  const got = await B.storage.sync.get('relay');
  relayCfg = got.relay || null;
  const usable =
    relayCfg && relayCfg.enabled && relayCfg.roomId && relayCfg.keyB64 &&
    /^wss:\/\//.test(RELAY_URL) && !RELAY_URL.includes('CHANGE-ME');
  if (usable) {
    try {
      relayKey = await crypto.subtle.importKey(
        'raw', ub64(relayCfg.keyB64), 'AES-GCM', false, ['encrypt', 'decrypt'],
      );
      connectRelay();
    } catch {
      relayKey = null;
    }
  } else {
    disconnectRelay();
  }
}

function connectRelay() {
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
  if (!relayCfg || !relayKey) return;
  clearTimeout(wsReconnect);
  try {
    ws = new WebSocket(`${RELAY_URL}/r/${relayCfg.roomId}`);
  } catch {
    scheduleReconnect();
    return;
  }
  ws.addEventListener('open', () => {
    relayBackoff = 1000;
    clearInterval(wsPing);
    wsPing = setInterval(() => { try { ws.send('{"t":"ping"}'); } catch { /* */ } }, 25000);
    publishNow(); // announce our current tabs
  });
  ws.addEventListener('message', onRelayMessage);
  ws.addEventListener('close', scheduleReconnect);
  ws.addEventListener('error', () => { try { ws.close(); } catch { /* */ } });
}

function disconnectRelay() {
  clearTimeout(wsReconnect);
  clearInterval(wsPing);
  if (ws) { try { ws.close(); } catch { /* */ } ws = null; }
}

function scheduleReconnect() {
  clearInterval(wsPing);
  if (!relayCfg || !relayCfg.enabled) return;
  clearTimeout(wsReconnect);
  wsReconnect = setTimeout(connectRelay, relayBackoff);
  relayBackoff = Math.min(relayBackoff * 2, 30000);
}

async function relaySend(payload) {
  if (!ws || ws.readyState !== 1 || !relayKey) return;
  try {
    ws.send(await encrypt(payload));
  } catch {
    /* transient */
  }
}

async function onRelayMessage(ev) {
  let msg;
  try {
    msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
  } catch {
    return;
  }
  if (msg.t === 'join') {
    publishNow(); // a peer just joined — resend so they see us
    return;
  }
  if (msg.t !== 'tabs' || !msg.iv || !msg.ct) return;
  let data;
  try {
    data = await decrypt(msg);
  } catch {
    return; // not our key / corrupt
  }
  if (!data || !data.deviceId || data.deviceId === deviceId) return;
  const store = await B.storage.local.get('relayDevices');
  const map = store.relayDevices || {};
  map[data.deviceId] = { name: data.name, ts: data.ts || Date.now(), tabs: data.tabs || [] };
  // drop peers we haven't heard from in 5 min — relay presence is live
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [k, v] of Object.entries(map)) if (!v.ts || v.ts < cutoff) delete map[k];
  await B.storage.local.set({ relayDevices: map });
}

/* ================= wiring ================= */

(async () => {
  await ensureDevice();
  await loadRelayConfig();
  publishNow();
})();

for (const ev of ['onCreated', 'onRemoved', 'onUpdated', 'onMoved', 'onAttached', 'onDetached']) {
  if (B.tabs[ev]) B.tabs[ev].addListener(schedulePublish);
}
if (B.runtime.onStartup) {
  B.runtime.onStartup.addListener(() => ensureDevice().then(loadRelayConfig).then(publishNow));
}
// react when the relay is toggled on/off (config rides storage.sync between devices)
B.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.relay) loadRelayConfig();
});
