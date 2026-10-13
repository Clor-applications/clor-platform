# The web app for Cloud Run (staging): the Vite build served by nginx, which
# also forwards /api to the API service so the browser sees one origin (no
# CORS, and the refresh cookie stays first-party).
#
#   gcloud builds submit --config cloudbuild.web.cloudrun.yaml \
#     --ignore-file .gcloudignore.web --substitutions=_TAG=<git-sha> .
#
# Run with API_ORIGIN set to the API service URL (https://...run.app).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
# The nginx image runs envsubst over /etc/nginx/templates/*.template at start.
COPY docker/nginx.cloudrun.conf.template /etc/nginx/templates/default.conf.template
ENV NGINX_ENVSUBST_FILTER=^API_ORIGIN$
EXPOSE 8080
