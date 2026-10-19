# Accounting/platform API for Google Cloud Run. Build context: ./server
#
# Differs from api.Dockerfile (used by docker-compose for local dev):
#  - generates ALL FOUR Prisma clients (accounting, payroll, people, platform);
#  - copies scripts/ (the build and the DB-URL guard need it);
#  - starts with `npm run prisma:deploy`: the DB-URL guard first, then
#    `migrate deploy` for all four schemas. Never `db push --accept-data-loss`.
#  - listens on $PORT (Cloud Run sets 8080).
#  - serves the on-site connector from dist-agent/. A connector only updates
#    to a SIGNED build, and the signing key never enters the image or the
#    upload, so the signed dist-agent/ is built and signed on the deploying
#    machine (DEPLOY.md) and copied in as is. Only when no signature came with
#    the upload is the connector built here, unsigned (connectors in the field
#    then stay on the version they have).

FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl python3 make g++
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY prisma ./prisma
COPY scripts ./scripts
COPY src ./src
COPY agent ./agent
# dist-agent/ is optional in the context; package.json always matches, so the
# COPY never fails on "no source files". It is removed again just below.
COPY package.json dist-agen[t] ./dist-agent/
RUN rm -f dist-agent/package.json \
 && npm run prisma:generate && npm run build \
 && if [ -f dist-agent/clor-agent.cjs.sig ]; then echo "Using the signed connector from the upload"; else npm run agent:build; fi

FROM node:22-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-agent ./dist-agent
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY scripts ./scripts
RUN rm -f prisma/dev.db prisma/*/*.db
ENV PORT=8080
EXPOSE 8080
CMD ["sh", "scripts/cloudrun-start.sh"]
