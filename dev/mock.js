// Dev-only mock of the WebExtension API so sidebar.html can run in a plain
// browser tab. Not shipped: only referenced from dev/test.html.
'use strict';

(() => {
  const listeners = { tabs: {}, storage: [] };
  const mkEvent = (bucket, name) => {
    bucket[name] = bucket[name] || [];
    return {
      addListener: (fn) => bucket[name].push(fn),
      removeListener: () => {},
    };
  };
  const fire = (bucket, name, ...args) => (bucket[name] || []).forEach((fn) => fn(...args));

  const syncData = {};
  const localData = {};

  const storageArea = (data, areaName) => ({
    async get(keys) {
      if (keys === null || keys === undefined) return { ...data };
      const arr = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of arr) if (k in data) out[k] = structuredClone(data[k]);
      return out;
    },
    async set(obj) {
      const changes = {};
      for (const [k, v] of Object.entries(obj)) {
        changes[k] = { oldValue: data[k], newValue: v };
        data[k] = structuredClone(v);
      }
      listeners.storage.forEach((fn) => fn(changes, areaName));
    },
    async remove(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
      listeners.storage.forEach((fn) => fn({}, areaName));
    },
  });

  let nextTabId = 100;
  let tabs = [
    { id: 1, title: 'Hacker News — front page', url: 'https://news.ycombinator.com/', favIconUrl: 'https://news.ycombinator.com/favicon.ico', active: false, pinned: false },
    { id: 2, title: 'GitHub — jamesturner', url: 'https://github.com/', favIconUrl: 'https://github.com/favicon.ico', active: true, pinned: false },
    { id: 3, title: 'MDN Web Docs: sidebar_action', url: 'https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions', favIconUrl: 'https://developer.mozilla.org/favicon-48x48.png', active: false, pinned: false },
    { id: 4, title: 'Figma — design file', url: 'https://www.figma.com/files', favIconUrl: '', active: false, pinned: false },
    { id: 5, title: 'YouTube', url: 'https://www.youtube.com/', favIconUrl: 'https://www.youtube.com/s/desktop/6b2b8f5e/img/favicon_32x32.png', active: false, pinned: false },
  ];
  const notifyTabs = () => fire(listeners.tabs, 'onUpdated');

  const fakeShot = (() => {
    const cv = document.createElement('canvas');
    cv.width = 8; cv.height = 8;
    const cx = cv.getContext('2d');
    cx.fillStyle = '#1e3a5f'; // dark blue site — tests auto theme's dark mode
    cx.fillRect(0, 0, 8, 8);
    return cv.toDataURL('image/png');
  })();

  window.browser = {
    runtime: {
      async getPlatformInfo() { return { os: 'mac' }; },
    },
    permissions: {
      async request() { return true; },
      async contains() { return true; },
    },
    storage: {
      sync: storageArea(syncData, 'sync'),
      local: storageArea(localData, 'local'),
      onChanged: {
        addListener: (fn) => listeners.storage.push(fn),
        removeListener: () => {},
      },
    },
    tabs: {
      async query() { return tabs.map((t) => ({ ...t })); },
      async captureVisibleTab() { return fakeShot; },
      async create(opts = {}) {
        tabs.forEach((t) => (t.active = false));
        const t = { id: nextTabId++, title: opts.url || 'New Tab', url: opts.url || 'about:newtab', favIconUrl: '', active: true, pinned: false };
        tabs.push(t);
        notifyTabs();
        return t;
      },
      async update(id, opts) {
        if (opts.active) tabs.forEach((t) => (t.active = t.id === id));
        notifyTabs();
      },
      async remove(ids) {
        const arr = Array.isArray(ids) ? ids : [ids];
        tabs = tabs.filter((t) => !arr.includes(t.id));
        notifyTabs();
      },
      onCreated: mkEvent(listeners.tabs, 'onUpdated'),
      onRemoved: mkEvent(listeners.tabs, 'onUpdated'),
      onUpdated: mkEvent(listeners.tabs, 'onUpdated'),
      onActivated: mkEvent(listeners.tabs, 'onUpdated'),
      onMoved: mkEvent(listeners.tabs, 'onUpdated'),
      onAttached: mkEvent(listeners.tabs, 'onUpdated'),
      onDetached: mkEvent(listeners.tabs, 'onUpdated'),
    },
  };

  // Seed some saved state so the UI shows every section.
  const seed = {
    space: { name: 'Personal', theme: 'peach' },
    root: { grid: ['g1', 'g2', 'g3'], list: ['f1', 's1'] },
    'item:g1': { id: 'g1', type: 'tab', title: 'Gmail', url: 'https://mail.google.com/', fav: 'https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico' },
    'item:g2': { id: 'g2', type: 'tab', title: 'Calendar', url: 'https://calendar.google.com/', fav: '' },
    'item:g3': { id: 'g3', type: 'tab', title: 'GitHub', url: 'https://github.com/', fav: 'https://github.com/favicon.ico' },
    'item:f1': { id: 'f1', type: 'folder', name: 'Reading', emoji: '📚', children: ['c1', 'c2'] },
    'item:c1': { id: 'c1', type: 'tab', title: 'Hacker News — front page', url: 'https://news.ycombinator.com/', fav: 'https://news.ycombinator.com/favicon.ico' },
    'item:c2': { id: 'c2', type: 'tab', title: 'A long article title that should truncate nicely in the row', url: 'https://example.com/article', fav: '' },
    'item:s1': { id: 's1', type: 'tab', title: 'Linear', url: 'https://linear.app/', fav: '' },
    'device:otherdev': {
      name: 'Mac · b7f2',
      ts: Date.now() - 5 * 60 * 1000,
      tabs: [
        { t: 'Stripe Dashboard', u: 'https://dashboard.stripe.com/' },
        { t: 'AWS Console', u: 'https://console.aws.amazon.com/' },
        { t: 'Notion — planning doc', u: 'https://www.notion.so/plan' },
      ],
    },
  };
  Object.assign(syncData, structuredClone(seed));
})();
