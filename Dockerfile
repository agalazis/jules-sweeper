# Multi-stage build setup for jules-sweeper using Node.js 22 Alpine
FROM node:22-alpine AS builder

WORKDIR /app

# Install system dependencies
RUN apk add --no-cache git curl gcompat libc6-compat

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

# Install required system tools git, curl, and glibc compatibility libs for @google/jules CLI fallback
RUN apk add --no-cache git curl gcompat libc6-compat

# Global NPM installation of @google/jules inside container for CLI fallback
RUN npm install -g @google/jules

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
