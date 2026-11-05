# The off-host backup job (Cloud Run Job "clor-backup"). Build context: deploy/backup
#
# The client must be at least as new as the server: production is PostgreSQL 18.
# age encrypts to the owner's public key; curl uploads with the job's own
# service account (metadata server token), so no gcloud SDK in the image.
FROM postgres:18-alpine
RUN apk add --no-cache age curl openssl tar \
 && age --version && pg_dump --version
COPY clor-backup-offsite.sh /usr/local/bin/clor-backup-offsite
RUN chmod 755 /usr/local/bin/clor-backup-offsite
# Never runs a server: the image is only the client tools and the script.
USER postgres
ENTRYPOINT ["/usr/local/bin/clor-backup-offsite"]
