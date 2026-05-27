// Atlas Yjs sync sidecar — Phase 0 stub.
//
// In Phase 0 this container simply runs the upstream y-websocket server
// unchanged so the docker-compose stack is complete. The auth callback
// (POST /internal/yjs/authorize against the Atlas backend) and snapshot
// callback (POST /internal/yjs/snapshot) wiring lands in Phase 8 when
// notes go live. Until then this stub accepts no connections from the
// public internet — the docker-compose service is on the internal
// network only.
//
// To enable in Phase 8: replace this file with the real handler that
// (1) parses the JWT yToken from the connection URL, (2) calls the Atlas
// backend authorize endpoint with the docKey + sessionId, (3) joins the
// y.Doc room only if the response permits, (4) debounces snapshots and
// POSTs them back to /internal/yjs/snapshot.

import http from 'node:http';
import { WebSocketServer } from 'ws';
import { setupWSConnection } from 'y-websocket/bin/utils';

const port = Number(process.env.PORT ?? 1234);

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', phase: 'stub' }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  // Phase 0: open to anything on the internal network. Phase 8 swaps in
  // the auth callback before completing the upgrade.
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

wss.on('connection', (ws, request) => {
  setupWSConnection(ws, request);
});

server.listen(port, () => {
  console.log(`[atlas-y-websocket] listening on :${port} (phase 0 stub)`);
});
