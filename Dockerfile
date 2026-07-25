# Multi-stage build setup for jules-sweeper using Node.js 22 Alpine (Pure SDK Engine)
FROM node:22-alpine AS builder

WORKDIR /app

# Install all dependencies for type checking
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

# Copy source
COPY src/ ./src

# Typecheck source code
RUN npm run typecheck

# Production stage
FROM node:22-alpine AS runner

WORKDIR /app

# Install production dependencies (@google/jules-sdk)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy application source files
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/src ./src

# Set production environment
ENV NODE_ENV=production

# Native TypeScript execution using Node.js 22 type-stripping (--experimental-strip-types)
ENTRYPOINT ["node", "--experimental-strip-types", "src/index.ts"]
