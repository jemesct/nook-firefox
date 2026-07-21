# AMO listing copy — paste into the Developer Hub forms

## Name
Nook — Folders & Pinned Tabs

## Summary (250 chars max)
An Arc-style sidebar: pin daily apps to a favicon grid, file tabs into
folders, keep loose tabs in a tidy Today list. Syncs across your Firefox
browsers — with pastel themes, an auto colour mode, and a compact icon rail.

## Categories
Primary: Tabs · Secondary: Appearance

## Homepage / Support site
https://github.com/jemesct/nook-firefox

## License
MIT

## Description

Nook turns Firefox's sidebar into an Arc-style home for your tabs:

<b>Pinned grid</b> — your daily apps as favicon tiles at the top. A saved tab
that's open is highlighted and deduplicated; clicking focuses the existing
tab instead of opening another copy. Closing it keeps it saved.

<b>Folders</b> — file tabs into folders with emoji icons. Rename, collapse,
"open all", drag things between folders, the grid, and Today.

<b>Today</b> — every open tab that isn't saved anywhere, in one tidy list.
Drag to reorder your real tabs, shift-click to select a range and move tabs
in bulk, and hit Clear to close everything except the active tab. Tabs open
on your other synced Firefox browsers appear in the same list — click to
open them here.

<b>Sync</b> — folders, pins, and themes follow your Firefox account to every
Firefox where Nook is installed. No account, no server, no tracking: it all
rides on Firefox Sync.

<b>Looks</b> — eight pastel gradients plus white, black, and an auto mode
that tints the sidebar to match the site you're on. Follows your system
light/dark mode. Collapse the whole sidebar to a slim icon rail with one
click.

<b>Safety net</b> — a daily local backup of your folders and pins on each
device, restorable from a right-click on the space name.

<b>Pro tip — go full Arc:</b> Firefox can't let extensions remove its own
tab strip or the sidebar header, but a small userChrome.css file can hide
both, leaving Nook as your only tab UI. A ready-made file with step-by-step
instructions is here:
https://github.com/jemesct/nook-firefox/blob/master/userchrome/userChrome.css

Keyboard: Alt+A toggles the sidebar.

## Privacy policy
Nook stores your folders, pinned tabs, theme choice, and — for the
cross-device Today list — the titles and URLs of your open tabs in
Firefox's built-in extension sync storage (storage.sync). Firefox syncs
that data through your Firefox account like any other synced data. By
default nothing is sent to the developer or any third party. The optional
"auto colour" theme takes a screenshot of the active tab locally to compute
an average colour for the sidebar tint; the image is processed in memory on
your device and discarded immediately. Local backups never leave your
device.

Optional "Live sync" (off by default): if you turn it on, Nook sends your
open-tab titles and URLs, end-to-end encrypted, through a relay server so
your own devices update in near-real-time. The data is encrypted on your
device with AES-GCM using a key generated on your device and shared only
between your devices via Firefox Sync; the relay only ever receives opaque
ciphertext addressed to a random room identifier, cannot decrypt it, and
stores nothing. The relay is operated by the developer on Cloudflare. You
can turn Live sync off at any time, which stops all relay traffic. The
relay source code is public at
https://github.com/jemesct/nook-firefox/tree/master/relay

## Notes to reviewer
Plain hand-written JavaScript/CSS/HTML — no build step, no bundler, no
minification; the uploaded files are the source. Repository:
https://github.com/jemesct/nook-firefox (the dev/ folder there is a browser
test harness and is not part of this package).

Permission usage:
- "tabs": list/activate/move/close the user's tabs in the sidebar UI.
- "storage": storage.sync for folders/pins/theme; storage.local for
  per-device favicon cache, layout preference, and backups.
- "<all_urls>" (optional, runtime-requested): used solely by the opt-in
  "auto colour" theme, which calls tabs.captureVisibleTab to average the
  active page's colour for the sidebar tint. Requested only when the user
  picks that theme; the capture never leaves the device.
