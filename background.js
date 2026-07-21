'use strict';

/* global browser, chrome */
const B = typeof browser !== 'undefined' ? browser : chrome;

// Toolbar button toggles the sidebar.
B.action.onClicked.addListener(() => {
  B.sidebarAction.toggle().catch(() => {});
});

/* ================= cross-device tab presence =================
   Publish this device's open tabs to storage.sync so other Firefoxes
   running Nook can list them in Today. This lives in the background, not
   the sidebar, on purpose: the background runs continuously, so the
   published blob stays current even when the sidebar is closed. That way
   every Firefox Sync cycle (~10 min, or a manual "Sync Now") carries an
   up-to-date snapshot instead of whatever was open the last time the
   sidebar happened to be visible. ~10 min is Firefox's floor; we just make
   sure we never waste a tick on stale data. */

let deviceId = null;
let deviceName = 'Device';
let lastPublished = null;

function uid() {
  const r = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2);
  return r.replace(/-/g, '').slice(0, 8);
}

// deviceId is the single stable identity for this browser profile; the
// background is its sole author so the two contexts never generate rival ids.
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

let publishTimer = null;
function schedulePublish() {
  clearTimeout(publishTimer);
  publishTimer = setTimeout(publishNow, 3000);
}

async function publishNow() {
  if (!deviceId) await ensureDevice();
  let all;
  try {
    all = await B.tabs.query({});
  } catch {
    return;
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
  // storage.sync rejects keys over 8KB — trim until the payload fits
  while (tabs.length && JSON.stringify(tabs).length > 7000) tabs.pop();
  const flat = JSON.stringify(tabs);
  if (flat === lastPublished) return; // nothing changed; don't churn sync
  lastPublished = flat;
  B.storage.sync
    .set({ ['device:' + deviceId]: { name: deviceName, ts: Date.now(), tabs } })
    .catch(() => {});
}

(async () => {
  await ensureDevice();
  publishNow();
})();

for (const ev of ['onCreated', 'onRemoved', 'onUpdated', 'onMoved', 'onAttached', 'onDetached']) {
  if (B.tabs[ev]) B.tabs[ev].addListener(schedulePublish);
}
if (B.runtime.onStartup) {
  B.runtime.onStartup.addListener(() => ensureDevice().then(publishNow));
}
