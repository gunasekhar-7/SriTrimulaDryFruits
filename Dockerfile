# ==============================================================================
# Production Multi-Stage Hardened Dockerfile
# Sri Tirumala Dry Fruits - POS & E-Commerce Platform
# ==============================================================================

# ─── Stage 1: Build & Dependency Compilation ──────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

# Install native build toolchain required for better-sqlite3 compilation
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

# Copy dependency manifests first for maximum layer caching
COPY package*.json tsconfig.json ./

# Install full dependencies (including devDependencies needed for TypeScript compiler)
RUN npm ci --legacy-peer-deps

# Explicitly copy application source code and scripts for compilation
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY server.ts ./

# Compile TypeScript to dist/
RUN npm run build

# Remove development dependencies, retaining only production runtime packages
RUN npm prune --omit=dev --legacy-peer-deps

# ─── Stage 2: Hardened Production Runtime ─────────────────────────────────────
FROM node:20-slim AS runner

LABEL org.opencontainers.image.title="sri-tirumala-pos" \
      org.opencontainers.image.description="Sri Tirumala Dry Fruits Production POS & Storefront" \
      org.opencontainers.image.vendor="Sri Tirumala Dry Fruits"

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    TZ=Asia/Kolkata

# Setup isolated directories for SQLite database, backups, and audit logs with node user permissions
RUN mkdir -p /app/data /app/data/backups /app/logs && \
    chown -R node:node /app

# Copy production dependencies and compiled artifacts with non-root ownership
COPY --chown=node:node package*.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node views ./views
COPY --chown=node:node public ./public

# Ensure backup hook and shell scripts have executable permissions
RUN chmod +x /app/scripts/*.sh

# Run as non-root unprivileged user for security compliance
USER node

# Declare runtime mount points for stateful persistence
VOLUME ["/app/data", "/app/logs"]

# Expose HTTP port
EXPOSE 3000

# Native Node.js Healthcheck (no curl/wget package bloat required)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Start production server
CMD ["node", "dist/server.js"]
