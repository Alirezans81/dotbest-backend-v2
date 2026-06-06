# ---------- Build stage ----------
FROM docker.arvancloud.ir/ghcr.io/pnpm/pnpm:9 AS builder

WORKDIR /app

# Optional: pass --build-arg HTTP_PROXY=http://... when behind a proxy
ARG HTTP_PROXY="http://host.docker.internal:10809"
ARG HTTPS_PROXY="http://host.docker.internal:10809"

COPY package.json pnpm-lock.yaml ./
RUN pnpm config set registry https://package-mirror.liara.ir/repository/npm/ --global
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .

RUN pnpm rebuild esbuild

RUN HTTP_PROXY=${HTTP_PROXY} \
    HTTPS_PROXY=${HTTPS_PROXY} \
    PRISMA_ENGINES_TIMEOUT=600000 \
    PRISMA_CLIENT_ENGINE_BINARY_DOWNLOAD_TIMEOUT=600000 \
    NO_PROXY=localhost,127.0.0.1 \
    pnpm prisma generate

RUN pnpm build

# ---------- Runtime stage ----------
FROM docker.arvancloud.ir/ghcr.io/pnpm/pnpm:9 AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /app/node_modules ./node_modules

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000
# Run migrations at container startup, then launch the app
CMD ["sh", "-c", "pnpm prisma migrate deploy && pnpm start"]
