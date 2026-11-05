# The off-host backup job (Cloud Run Job "clor-backup"). Build context: deploy/backup
#
# Pinned so a rebuild cannot quietly change what makes the backups:
#   base   postgres 18.6 on Alpine 3.24.3, by digest (the client must be at
#          least as new as the server: production is PostgreSQL 18);
#   tools  exact Alpine package versions. Alpine keeps only the newest build of
#          each package in a branch, so when one is replaced this build FAILS
#          rather than picking up something new: bump the version, rebuild,
#          run deploy/backup/test-local.sh and the drill.
# age encrypts to the owner's public keys, ssh-keygen signs the archive, curl
# uploads with the job's own service account (no gcloud SDK in the image).
FROM postgres:18.6-alpine3.24@sha256:10a5c69a83035ab5239f5620d708520e8b28f5aa1f2b20143e6024532edadfb5
RUN apk add --no-cache \
      age=1.3.2-r1 \
      curl=8.23.0-r0 \
      openssh-keygen=10.3_p1-r1 \
      openssl=3.5.9-r0 \
      tar=1.35-r5 \
 && age --version && pg_dump --version
COPY clor-backup-offsite.sh /usr/local/bin/clor-backup-offsite
COPY clor-restore-offsite.sh /usr/local/bin/clor-restore-offsite
RUN chmod 755 /usr/local/bin/clor-backup-offsite /usr/local/bin/clor-restore-offsite
# Never runs a server: the image is only the client tools and the scripts.
USER postgres
ENTRYPOINT ["/usr/local/bin/clor-backup-offsite"]
