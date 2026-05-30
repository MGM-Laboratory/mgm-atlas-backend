# Atlas Yjs sync sidecar.
# Thin Node 20 Alpine image running the y-websocket package. The Phase 0
# build just ships the upstream server so the compose stack is complete;
# Phase 8 replaces server.js with the auth-callback variant.

FROM node:20-alpine

WORKDIR /app

# Tini for proper signal handling.
RUN apk add --no-cache tini wget

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY server.js ./

ENV NODE_ENV=production
ENV PORT=1234

EXPOSE 1234

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
