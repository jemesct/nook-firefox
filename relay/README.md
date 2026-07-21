# Nook relay

A tiny **zero-knowledge** WebSocket relay for Nook's optional Live Sync. It
forwards end-to-end-encrypted messages between a user's own devices in a
secret room. It **cannot read tab data** (payloads are AES-GCM encrypted by
the clients with a key it never sees) and it **stores nothing**.

Runs on Cloudflare Workers + Durable Objects. With the WebSocket Hibernation
API, idle rooms cost nothing — comfortably within the **free plan**
(100k requests/day) for personal use.

## Deploy (once)

You need a free [Cloudflare account](https://dash.cloudflare.com/sign-up) and
Node installed.

```sh
cd relay
npm install -g wrangler     # Cloudflare's CLI
wrangler login              # opens a browser to authorize
wrangler deploy             # deploys worker.js
```

`wrangler deploy` prints your Worker URL, e.g.:

```
https://nook-relay.your-subdomain.workers.dev
```

## Point Nook at it

Edit [`../background.js`](../background.js) and set `RELAY_URL` to that URL
with the `wss://` scheme:

```js
const RELAY_URL = 'wss://nook-relay.your-subdomain.workers.dev';
```

Rebuild/repackage the extension and install it. Then enable **Live sync**:
right-click the space name (e.g. "Personal") → **Live sync: Off… → On**.
Nook generates a random room id and encryption key, syncs them to your other
device once via Firefox Sync (~10 min the first time), and from then on your
devices exchange tabs over the relay in near-real-time.

## What the relay can and can't see

- **Can see:** that *some* socket in a random 32-char room sent an opaque
  ciphertext blob, and forwards it to the other socket(s) in that room.
- **Cannot see:** tab titles, URLs, which account, or which device — the room
  id is a shared secret and every payload is AES-GCM encrypted client-side.
- **Stores:** nothing. No database, no logs of content. Sockets are in-memory
  only and hibernate when idle.

## Abuse guards

`worker.js` caps each room at 16 sockets and each message at 32 KB. If you
ever publish Nook widely and want more, add Cloudflare rate limiting in the
dashboard — but at personal scale the free plan is plenty.

## Local testing

```sh
wrangler dev        # runs the relay at ws://localhost:8787
```
Temporarily point `RELAY_URL` at `ws://localhost:8787` to test end-to-end.
