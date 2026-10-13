# Accounting/platform API for Google Cloud Run. Build context: ./server
#
# Differs from api.Dockerfile (used by docker-compose for local dev):
#  - generates ALL FOUR Prisma clients (accounting, payroll, people, platform);
#  - copies scripts/ (the build and the DB-URL guard need it);
#  - starts with `npm run prisma:deploy`: the DB-URL guard first, then
#    `migrate deploy` for all four schemas. Never `db push --accept-data-loss`.
#  - listens on $PORT (Cloud Run sets 8080).

FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl python3 make g++
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY prisma ./prisma
COPY scripts ./scripts
COPY src ./src
RUN npm run prisma:generate && npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY scripts ./scripts
RUN rm -f prisma/dev.db prisma/*/*.db
ENV PORT=8080
EXPOSE 8080
CMD ["sh", "scripts/cloudrun-start.sh"]
