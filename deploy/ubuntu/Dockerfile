FROM node:24-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/*

RUN npm install --global pnpm@10
WORKDIR /app
COPY . .

ARG VITE_CLERK_PUBLISHABLE_KEY
ARG VITE_CLERK_PROXY_URL
ENV NODE_ENV=production \
  BASE_PATH=/ \
  PORT=22833 \
  VITE_CLERK_PUBLISHABLE_KEY=${VITE_CLERK_PUBLISHABLE_KEY} \
  VITE_CLERK_PROXY_URL=${VITE_CLERK_PROXY_URL}

RUN pnpm install --frozen-lockfile --prod=false \
  && pnpm run typecheck \
  && pnpm --filter @workspace/api-server run build \
  && pnpm --filter @workspace/consult-lawyer run build

RUN groupadd --system --gid 10001 consultwithlawyer \
  && useradd --system --uid 10001 --gid 10001 --home-dir /nonexistent --shell /usr/sbin/nologin consultwithlawyer \
  && mkdir -p /var/lib/legal-connect/objects \
  && chown -R 10001:10001 /var/lib/legal-connect

ENV PORT=8080 \
  HOST=127.0.0.1 \
  OBJECT_STORAGE_PROVIDER=local \
  LOCAL_OBJECT_STORAGE_DIR=/var/lib/legal-connect/objects \
  SERVE_FRONTEND=true \
  FRONTEND_DIST_DIR=/app/artifacts/consult-lawyer/dist/public \
  TMPDIR=/tmp

EXPOSE 8080
USER 10001:10001
CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
