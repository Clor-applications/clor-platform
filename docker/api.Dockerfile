# Accounting API (Express + Prisma). Build context: ./server

FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl python3 make g++
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
RUN npx prisma generate && npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache openssl curl
ENV NODE_ENV=production

# Reuse the build stage's node_modules: bcrypt is a native module, so it must
# be the copy compiled inside this image, not one from the host.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json package-lock.json ./
COPY prisma ./prisma

# server/.dockerignore already keeps the dev DB out of the build context; this
# is a cheap guard in case someone builds with an older or missing ignore file.
RUN rm -f prisma/dev.db

EXPOSE 4001
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=5 \
  CMD curl -fsS http://127.0.0.1:4001/health || exit 1

# `migrate deploy` with no migrations directory EXITS 0 ("No pending
# migrations"), so an `||` fallback never fires and a fresh volume boots with
# an empty database — every request then dies on "table does not exist".
# Choose explicitly: real migrations when they exist, otherwise push the
# schema so a fresh container comes up usable.
CMD ["sh", "-c", "if [ -d prisma/migrations ] && [ \"$(ls -A prisma/migrations 2>/dev/null)\" ]; then npx prisma migrate deploy; else npx prisma db push --accept-data-loss; fi; exec node dist/index.js"]
