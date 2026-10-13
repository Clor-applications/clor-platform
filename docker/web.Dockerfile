# React/Vite frontend, served by nginx. Build context: repo root.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.js tailwind.config.js postcss.config.js eslint.config.js ./
COPY public ./public
COPY src ./src

# Empty VITE_API_BASE keeps the app on same-origin /api, which nginx proxies
# to the api service. Override at build time to point at a separate API host.
ARG VITE_API_BASE=""
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build

FROM nginx:1.27-alpine AS runtime
RUN apk add --no-cache curl
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1/ >/dev/null || exit 1
