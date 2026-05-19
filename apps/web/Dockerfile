# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

# NEW: Build-time heap cap for Next.js
ENV NODE_OPTIONS="--max-old-space-size=4096"

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile

COPY apps/web/ ./apps/web/

# NEW: Build Next.js standalone output
RUN pnpm --filter @permatrack/web build

# Stage 2: Production image
FROM node:20-alpine AS production
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# NEW: Copy standalone runtime
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
