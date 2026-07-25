# Multi-stage build setup for jules-sweeper using Node.js 22 Alpine
FROM node:22-alpine AS builder

WORKDIR /app

# Install system dependencies
RUN apk add --no-cache git curl

# Install devDependencies for type checking
COPY package.json tsconfig.json ./
RUN npm install

# Copy source
COPY src/ ./src

# Typecheck source code
RUN npm run typecheck

# Production stage
FROM node:22-alpine AS runner

WORKDIR /app

# Install required system tools git and curl
RUN apk add --no-cache git curl

# Global NPM installation of @google/jules inside container
RUN npm install -g @google/jules

# Copy application files
COPY --from=builder /app/package.json /app/tsconfig.json ./
COPY --from=builder /app/src ./src

# Ensure global npm binaries and current working directory are in PATH
ENV PATH="/usr/local/bin:/usr/local/share/npm-global/bin:${PATH}"
ENV NODE_ENV=production

# Native TypeScript execution using Node.js 22 type-stripping (--experimental-strip-types)
ENTRYPOINT ["node", "--experimental-strip-types", "src/index.ts"]
