# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app

# NEW: Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# NEW: Copy workspace files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/db/package.json ./packages/db/
COPY apps/api/package.json ./apps/api/

# NEW: Install dependencies
RUN pnpm install --frozen-lockfile

# NEW: Copy source
COPY packages/db/ ./packages/db/
COPY apps/api/ ./apps/api/

# NEW: Generate Prisma client
RUN pnpm --filter @permatrack/db generate

# NEW: Build NestJS
RUN pnpm --filter @permatrack/api build

# Stage 2: Production image
FROM node:20-alpine AS production
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

# NEW: Copy package manifests
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/db/package.json ./packages/db/
COPY apps/api/package.json ./apps/api/

# NEW: Install production dependencies
RUN pnpm install --frozen-lockfile --prod

# NEW: Copy build output + Prisma assets
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/packages/db/prisma ./packages/db/prisma
COPY --from=builder /app/node_modules/.pnpm ./node_modules/.pnpm
COPY --from=builder /app/packages/db/node_modules ./packages/db/node_modules

# NEW: Run from API folder
WORKDIR /app/apps/api

# NEW: Health check endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/health || exit 1

EXPOSE 3001
ENV NODE_ENV=production

CMD ["node", "dist/apps/api/src/main.js"]
