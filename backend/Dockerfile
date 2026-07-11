# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:24.18.0-slim AS build
WORKDIR /app

# Prisma needs OpenSSL at generate time.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM node:24.18.0-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

# Copy production artifacts.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json ./
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Uploads dir (backed by the `uploads` volume at runtime); owned by non-root user.
RUN mkdir -p /data/uploads && chown -R node:node /data /app
USER node

EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
