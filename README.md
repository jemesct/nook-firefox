# Nook — Folders & Pinned Tabs for Firefox

An Arc-style sidebar for Firefox: a pinned favicon grid, folders of saved tabs,
a "Today" section for loose tabs, and pastel space themes. Saved state syncs
across all Firefox browsers where you're signed into your Firefox account.

## Features

- **Pinned grid** — Arc-style favicon tiles at the top for your daily apps.
- **Folders** — save tabs into folders with emoji icons; rename, collapse,
  "open all", per-folder context menus.
- **Pinned tabs come alive** — a saved tab that's currently open is
  highlighted and deduplicated out of Today; clicking it focuses the existing
  tab instead of opening a duplicate. Closing it keeps it saved (dimmed).
- **Today** — every open tab that isn't saved anywhere, with one-click
  **Clear** (closes everything except the active and natively-pinned tabs).
- **Drag & drop** — drag Today tabs into the grid or folders to save them,
  drag saved items between sections to reorder/move, drag a saved tab onto
  Today to unpin it.
- **Spaces look** — click the colored dot to pick from 8 pastel gradients;
  click the space name to rename it. Follows light/dark mode automatically.
- **Compact icon rail** — the « button in the header collapses Nook to an
  icon-only rail like Firefox's native vertical tabs: favicon tiles, emoji
  folders (click to expand), hover tooltips. Press » to go back. The choice
  is remembered per device. (Firefox owns the physical sidebar width —
  extensions can't resize the panel — so drag the splitter narrow once and
  use the button to switch layouts.)
- **Sync** — folders, pins, space name and theme live in `storage.sync`.
  Collapse state and favicon cache stay per-device in `storage.local`.

## Try it (temporary install)

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…** and pick `manifest.json` in this folder.
3. The sidebar opens automatically (or press **Alt+A**, or View → Sidebar → Nook).

Temporary add-ons are removed when Firefox restarts.

## Install permanently (and get sync)

Release Firefox only runs **signed** extensions, and Firefox Sync only syncs
extension data for the same signed add-on ID. Signing is free:

1. Zip the extension (from this directory):
   ```sh
   zip -r nook.zip manifest.json background.js sidebar icons
   ```
2. Go to <https://addons.mozilla.org/developers/>, sign in, and submit the
   zip under **"On your own"** (self-distribution / unlisted). Automatic
   review usually takes a few minutes.
3. Download the signed `.xpi` and open it in Firefox on each of your machines
   (File → Open, or drag into the window).
4. Make sure each Firefox is signed into your Firefox account with
   **Add-ons and Settings** syncing enabled — your folders and pins will
   follow you. (The add-on itself doesn't auto-install on other machines for
   self-distributed builds; install the same `.xpi` once per machine.)

The add-on ID is pinned in `manifest.json`
(`browser_specific_settings.gecko.id`), which is what makes `storage.sync`
data line up across installs.

## Backups

Each device keeps a rolling 7-snapshot local backup of the synced data
(taken daily when the sidebar opens; a wiped state is never archived over
real history). **Right-click the space name** for "Back up now" and
"Restore …" entries — restoring first snapshots the current state, so it's
always undoable, and the restore syncs out to your other devices.

## Make Nook the *only* tab UI (hide Firefox's own tabs)

Extensions can't remove browser chrome — the native tab strip, the sidebar's
"Nook ✕" header, and the new sidebar's icon rail are Firefox's, not ours.
The unofficial-but-standard fix (same as Sidebery / Tree Style Tab users) is
[userchrome/userChrome.css](userchrome/userChrome.css):

1. `about:config` → set `toolkit.legacyUserProfileCustomizations.stylesheets`
   to `true`
2. `about:support` → Profile Folder → **Open Folder**, create a `chrome`
   folder there, and copy `userchrome/userChrome.css` into it
3. Restart Firefox

That hides the horizontal tab strip, the sidebar header, and the Firefox
136+ sidebar launcher rail. Full install notes and a macOS caveat about
window buttons are in comments at the top of the file. It's user-editable
browser styling, so a Firefox update can occasionally rename a selector.

## Notes & limits

- `storage.sync` gives extensions ~100 KB. Nook stores ~300 bytes per saved
  tab, so roughly 300 saved tabs/folders — plenty for pins, not an archive.
- Favicons: Nook stores small favicon URLs with each item and keeps a local
  per-device cache; brand-new devices show letter avatars until you visit a
  site once.
- Keyboard: **Alt+A** toggles the sidebar (change under
  `about:addons` → gear icon → Manage Extension Shortcuts).

## Development

`dev/test.html` + `dev/mock.js` run the sidebar UI in a normal browser tab
with a mocked WebExtension API and seeded data:

```sh
python3 -m http.server 8642
# open http://localhost:8642/dev/test.html
```

Layout:

```
manifest.json        MV3 manifest (Firefox), sidebar_action + storage + tabs
background.js        toolbar button → toggle sidebar
sidebar/sidebar.html sidebar markup
sidebar/sidebar.css  Arc-style theming (light + dark)
sidebar/sidebar.js   state, sync storage, rendering, drag & drop
dev/                 browser dev harness (not shipped)
```
