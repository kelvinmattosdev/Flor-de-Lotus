# Snapshot Node26 verificado na INFRA008; nenhum Docker build foi executado.
FROM node:26.13.1-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1 AS base
WORKDIR /opt/fdl

FROM base AS builder
COPY package.json package-lock.json ./
RUN npm ci --include=dev --include=optional --ignore-scripts --no-audit --no-fund
COPY vite.config.js ./
COPY scripts/ ./scripts/
COPY index.html produto.html conta.html operador.html ./
COPY src/ ./src/
# Apenas os 53 ativos aprovados entram, antes do envio ao builder.
COPY public/ ./public/
RUN node scripts/build.mjs --container

FROM base AS production-deps
COPY package.json package-lock.json ./
# Instalacao nativa da plataforma Linux alvo, nao modulos Windows/prune do host.
RUN npm ci --omit=dev --include=optional --ignore-scripts --no-audit --no-fund

FROM base AS runtime
ENV NODE_ENV=production \
    FDL_BIND_HOST=0.0.0.0 \
    FDL_PORT=8080 \
    FDL_STATIC_DIR=/opt/fdl/static \
    FDL_DATA_DIR=/data
COPY package.json ./
COPY --from=production-deps /opt/fdl/node_modules/ ./node_modules/
COPY server/ ./server/
COPY src/data/catalog.js ./src/data/catalog.js
COPY scripts/safe-paths.mjs scripts/container-guard.mjs scripts/runtime-umask.mjs scripts/healthcheck.mjs ./scripts/
COPY --from=builder --chown=1000:1000 /opt/fdl/.fdl-build/export/ ./static/
# Volume EXTERNO exige provisionamento offline UID/GID1000, modo0700 + sentinel
# e banco bootstrapado. Nao incluir sentinel/banco vazio na imagem.
RUN mkdir /data && chown 1000:1000 /data && chmod 0700 /data
USER 1000:1000
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "scripts/healthcheck.mjs"]
STOPSIGNAL SIGTERM
ENTRYPOINT ["node"]
CMD ["--import", "./scripts/container-guard.mjs", "server/index.js"]
