/* Nook relay — a zero-knowledge WebSocket broadcaster.
 *
 * A device connects to  wss://<worker>/r/<roomId>  and every message it sends
 * is forwarded verbatim to the other sockets in the same room. The room id is
 * a high-entropy secret shared only between a user's own devices (via Firefox
 * Sync), and message payloads are end-to-end encrypted by the clients with a
 * key the relay never sees. This server therefore only ever handles opaque
 * ciphertext addressed to a random room — it cannot read anyone's tabs, and
 * stores nothing.
 *
 * Uses the Durable Objects WebSocket Hibernation API so idle rooms cost
 * nothing on Cloudflare's free plan.
 */

const MAX_SOCKETS = 16;      // per room; caps abuse
const MAX_MESSAGE = 32768;   // bytes; caps abuse

export class Room {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const sockets = this.state.getWebSockets();
    if (sockets.length >= MAX_SOCKETS) {
      return new Response('room full', { status: 429 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.state.acceptWebSocket(server); // hibernatable

    // Ask peers already here to re-broadcast their current state so this new
    // socket learns what's open elsewhere without the relay storing anything.
    for (const ws of sockets) {
      try { ws.send('{"t":"join"}'); } catch { /* dead socket */ }
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, message) {
    if (typeof message !== 'string' || message.length > MAX_MESSAGE) return;
    for (const peer of this.state.getWebSockets()) {
      if (peer !== ws) {
        try { peer.send(message); } catch { /* dead socket */ }
      }
    }
  }

  webSocketClose(ws) {
    try { ws.close(); } catch { /* already closed */ }
  }

  webSocketError(ws) {
    try { ws.close(); } catch { /* already closed */ }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/r\/([A-Za-z0-9_-]{16,64})$/);
    if (!m) return new Response('nook relay ok', { status: 200 });
    const stub = env.ROOMS.get(env.ROOMS.idFromName(m[1]));
    return stub.fetch(request);
  },
};
