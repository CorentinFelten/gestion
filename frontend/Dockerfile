# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:24.18.0-slim AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Runtime stage (nginx serves the static SPA) ──────────────────────────────
FROM nginx:1.31.2-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
