# ---------- Build stage ----------
FROM docker.arvancloud.ir/node:20 AS builder

WORKDIR /app

RUN npm install -g pnpm@9
COPY package.json pnpm-lock.yaml ./
RUN pnpm config set registry https://package-mirror.liara.ir/repository/npm/ --global
RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm prisma generate
RUN pnpm build

# ---------- Runtime stage ----------
FROM docker.arvancloud.ir/node:20 AS runner

WORKDIR /app
ENV NODE_ENV=production

RUN npm install -g pnpm@9

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /app/node_modules ./node_modules

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000
# Run migrations at container startup, then launch the app
CMD ["sh", "-c", "pnpm db:push && pnpm start"]