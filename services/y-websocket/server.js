// Atlas Yjs sync sidecar — Phase 8 (notes + whiteboards collaboration).
//
// On every WebSocket upgrade it parses `?token=<yToken>` and the room name
// (the docKey, e.g. "note:<id>") from the URL, then calls the Atlas backend
// POST /internal/yjs/authorize (HMAC-signed) and only completes the upgrade
// when the response permits. Document state is loaded from the backend the
// first time a room opens (bindState) and pushed back, debounced, on edits
// and on the last client leaving (writeState).
//
// Auth to the backend uses YJS_INTERNAL_AUTH_SECRET: each call sends
//   x-yjs-timestamp: <ms epoch>
//   x-yjs-signature: hex(HMAC-SHA256(secret, `${docKey}.${timestamp}`))
// When either the secret or the backend URL is missing the sidecar denies
// every connection (fail-closed) rather than serving unauthenticated docs.

import http from 'node:http';
import { createHmac } from 'node:crypto';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import { setupWSConnection, setPersistence, getYDoc } from 'y-websocket/bin/utils';

const PORT = Number(process.env.PORT ?? 1234);
const BACKEND = (process.env.ATLAS_BACKEND_BASE_URL ?? '').replace(/\/+$/, '');
const SECRET = process.env.YJS_INTERNAL_AUTH_SECRET ?? '';
// Default lowered from 30s to 5s as part of the PMO save-safety fix.
// The original 30s window was big enough that a user could lose
// 20+ seconds of work by closing the tab in a multi-user room (where
// writeState only fires when the LAST client disconnects).
const SNAPSHOT_DEBOUNCE_MS = Number(process.env.YJS_SNAPSHOT_DEBOUNCE_MS ?? 5000);
// On any client disconnect, schedule a near-immediate flush so a 2+
// user room still persists when one of them leaves. Independent from
// the regular SNAPSHOT_DEBOUNCE_MS so it can be tuned aggressively.
const DISCONNECT_FLUSH_MS = Number(process.env.YJS_DISCONNECT_FLUSH_MS ?? 250);

const configured = Boolean(BACKEND && SECRET);
if (!configured) {
  console.warn('[atlas-y-websocket] BACKEND/SECRET unset — every connection will be denied.');
}

function sign(docKey) {
  const ts = Date.now().toString();
  const signature = createHmac('sha256', SECRET).update(`${docKey}.${ts}`).digest('hex');
  return { ts, signature };
}

async function authorize(docKey, token) {
  if (!configured) return { allow: false };
  const { ts, signature } = sign(docKey);
  try {
    const res = await fetch(`${BACKEND}/internal/yjs/authorize`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-yjs-timestamp': ts,
        'x-yjs-signature': signature,
      },
      body: JSON.stringify({ docKey, token }),
    });
    if (!res.ok) return { allow: false };
    return await res.json();
  } catch (err) {
    console.error('[atlas-y-websocket] authorize error:', err.message);
    return { allow: false };
  }
}

async function loadState(docKey) {
  if (!configured) return null;
  const { ts, signature } = sign(docKey);
  try {
    const res = await fetch(
      `${BACKEND}/internal/yjs/snapshot?docKey=${encodeURIComponent(docKey)}`,
      { headers: { 'x-yjs-timestamp': ts, 'x-yjs-signature': signature } },
    );
    if (!res.ok) return null;
    const json = await res.json();
    return json.state ? Buffer.from(json.state, 'base64') : null;
  } catch (err) {
    console.error('[atlas-y-websocket] loadState error:', err.message);
    return null;
  }
}

async function saveState(docKey, ydoc) {
  if (!configured) return;
  const update = Y.encodeStateAsUpdate(ydoc);
  const { ts, signature } = sign(docKey);
  try {
    await fetch(`${BACKEND}/internal/yjs/snapshot`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-yjs-timestamp': ts,
        'x-yjs-signature': signature,
      },
      body: JSON.stringify({
        docKey,
        state: Buffer.from(update).toString('base64'),
        size: update.length,
      }),
    });
  } catch (err) {
    console.error('[atlas-y-websocket] saveState error:', err.message);
  }
}

// One pending snapshot timer per open doc.
const timers = new Map();
function scheduleSnapshot(docKey, ydoc, delayMs = SNAPSHOT_DEBOUNCE_MS) {
  // If a quicker flush is already pending (e.g. someone just
  // disconnected) we keep that one — never *delay* a flush we already
  // promised. We do replace the timer if the new delay is shorter.
  const pending = timers.get(docKey);
  if (pending) {
    if (pending.delayMs <= delayMs) return;
    clearTimeout(pending.handle);
  }
  const handle = setTimeout(() => {
    timers.delete(docKey);
    void saveState(docKey, ydoc);
  }, delayMs);
  timers.set(docKey, { handle, delayMs });
}

setPersistence({
  provider: null,
  bindState: async (docName, ydoc) => {
    const state = await loadState(docName);
    if (state && state.length) Y.applyUpdate(ydoc, state);
    // Attach AFTER the initial load so seeding doesn't trigger a redundant save.
    ydoc.on('update', () => scheduleSnapshot(docName, ydoc));
  },
  writeState: async (docName, ydoc) => {
    const pending = timers.get(docName);
    if (pending) clearTimeout(pending.handle);
    timers.delete(docName);
    await saveState(docName, ydoc);
  },
});

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', phase: 8, configured }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  void (async () => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const docName = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      const token = url.searchParams.get('token') ?? '';
      if (!docName) {
        socket.destroy();
        return;
      }
      const result = await authorize(docName, token);
      if (!result.allow) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request, docName);
      });
    } catch (err) {
      console.error('[atlas-y-websocket] upgrade error:', err.message);
      socket.destroy();
    }
  })();
});

wss.on('connection', (ws, request, docName) => {
  setupWSConnection(ws, request, { docName, gc: true });
  // Critical for the save-safety fix: when ANY client of a doc
  // disconnects (not only the last one — `writeState` already handles
  // that), schedule a near-immediate flush. Without this, User A
  // closing their tab in a 2-user room would leave their last few
  // seconds of edits unpersisted until either the regular debounce
  // fired or User B also left.
  ws.on('close', () => {
    const ydoc = getYDoc(docName, true);
    scheduleSnapshot(docName, ydoc, DISCONNECT_FLUSH_MS);
  });
});

server.listen(PORT, () => {
  console.log(`[atlas-y-websocket] listening on :${PORT} (phase 8, configured=${configured})`);
});
