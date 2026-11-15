# Engineering Console: one-time setup

The Console's code is in `console/`. Nothing below has been done yet: no
GitHub App, no cloud resource, no DNS record exists. Until it is done the
Console runs only on a laptop, with canned answers (`npm run console:dev`,
then open http://127.0.0.1:5191 and go to `/api/auth/dev` to sign in).

Every step is done once, by the owner or with the owner watching. The
commands are written to be read before they are run. **None of them has been
run against production; try the Google Cloud ones on staging first.**

Order matters: 1 to 4 make the Console itself work (read-only screens, pull
requests, log, members). 5 to 7 switch on Release and Roll back.

## 0. Ways to sign in: all optional, at least one

No sign-in method is built in. Each is on when its own settings are present,
and the sign-in page shows only those. The service will not start unless
somebody can get in as an owner.

| Method | On when | Needs |
|---|---|---|
| Email address and password | `CONSOLE_OWNER_EMAILS` and `CONSOLE_OWNER_SETUP_CODE` (16+ characters) are set | Nothing outside the Console |
| GitHub | All five `CONSOLE_GITHUB_*` settings are set (step 1) | A GitHub App |
| CLOR staff login | `CONSOLE_CLOR_GRANT_PUBLIC_KEY` is set (step 8) | A release of the customer app |

Whichever is used, the Console asks for its own authenticator code before it
shows anything. A password is stored only as a salted scrypt hash.

**First owner by password:** open the Console, "I have a setup code", your
address from `CONSOLE_OWNER_EMAILS`, the code from `CONSOLE_OWNER_SETUP_CODE`,
a new password of 12 characters or more. The code stops working for you once
your password is set. Other people: Members → Add member → email address; the
Console shows a one-time setup code, once, to pass to them (good for three
days). Reset password does the same for someone who has forgotten theirs.

**Without GitHub** the Console still shows the cloud rows on Overview, the
Log and Members. Rows and actions that need GitHub (tests, pull requests,
release, roll back) say "Not connected". **Without the Cloudflare read
token** the Web app and Website rows say the same.

## 1. GitHub App (optional: GitHub sign-in, pull requests, releases)

**Done 15 Nov 2026**: the app is `clor-console` (App ID 5766527, installed on
`Clor-applications`), its private key and client secret are the secrets
`console-github-private-key` and `console-github-client-secret`, and the
Console is deployed with them:

```
CONSOLE_ENABLE_CLOR=1 CONSOLE_OWNER_GITHUB_IDS=<owner's numeric id> CONSOLE_GITHUB_APP_ID=5766527 \
  CONSOLE_GITHUB_INSTALLATION_ID=182120311 CONSOLE_GITHUB_CLIENT_ID=<the app's client id> \
  console/api/scripts/deploy.sh <owner address>
```

Every later deploy of the Console needs the same settings, or GitHub and the
CLOR login switch off again. How the app was made:

GitHub → the `Clor-applications` organisation → Settings → Developer settings
→ GitHub Apps → New GitHub App.

| Field | Value |
|---|---|
| Name | CLOR Console |
| Homepage URL | `https://console.clor.in` |
| Callback URL | `https://console.clor.in/api/auth/callback` |
| Expire user authorization tokens | On |
| Request user authorization during installation | Off |
| Webhook | Off |
| Where can it be installed | Only on this account |

Repository permissions:

| Permission | Access | Used for |
|---|---|---|
| Metadata | Read | Required by GitHub |
| Contents | Read | Commits, tags, what is waiting to release |
| Pull requests | Read and write | List, merge, close |
| Issues | Read and write | The `full-tests` label, the closing comment |
| Actions | Read and write | Read runs, start CI, release and rollback |
| Deployments | Read and write | Approve a waiting release run |

No organisation or account permissions. After creating it: generate a client
secret, generate a private key (a `.pem` file downloads), then Install App →
only the `clor-platform` repository. Note the App ID, the Client ID and the
installation id (the number at the end of the installation page's address).

Your own GitHub numeric id (not your username) is the first owner:
`gh api user --jq .id`.

## 2. Database

A new database on the existing instance, with two roles: one that owns the
tables and runs migrations, one the Console runs as.

```sql
-- as the instance's admin user, connected to the postgres database
CREATE ROLE clor_console_owner LOGIN PASSWORD '<generate>';
CREATE ROLE clor_console_app   LOGIN PASSWORD '<generate>';
CREATE DATABASE clor_console OWNER clor_console_owner;
REVOKE ALL ON DATABASE clor_console FROM PUBLIC;
GRANT CONNECT ON DATABASE clor_console TO clor_console_app;
```

Apply the migration as the owner (`console/api`, after `npm ci && npm run build`):
`CONSOLE_DATABASE_URL=<owner url> npm run migrate`. Then, as the owner, in
`clor_console`:

```sql
GRANT SELECT, INSERT, UPDATE ON console_member TO clor_console_app;
GRANT SELECT, INSERT ON console_audit_event TO clor_console_app;
GRANT USAGE ON SEQUENCE console_audit_event_id_seq TO clor_console_app;
```

The log is append-only twice over: the app role has no UPDATE or DELETE on
it, and a trigger refuses them for every role.

Check (spec, criterion 6): connected as `clor_console_app` to each customer
database, `SELECT 1 FROM "User" LIMIT 1` must fail with permission denied.

## 3. Console API on Cloud Run

```bash
PROJECT=clor-apps-511409; REGION=asia-south1

gcloud iam service-accounts create clor-console-run --project $PROJECT --display-name "Engineering Console (read only)"
SA=clor-console-run@$PROJECT.iam.gserviceaccount.com
for ROLE in roles/run.viewer roles/cloudsql.viewer roles/cloudsql.client; do
  gcloud projects add-iam-policy-binding $PROJECT --member "serviceAccount:$SA" --role $ROLE --condition None
done
```

`run.viewer` and `cloudsql.viewer` are the reads on Overview and Releases.
`cloudsql.client` lets it connect to the instance; which database it can
open is decided by step 2. It has no role that changes anything.

Secrets (Secret Manager, each readable by `clor-console-run` only):

| Secret | Value |
|---|---|
| `console-session-secret` | 48 random bytes: `openssl rand -base64 48` |
| `console-database-url` | `postgresql://clor_console_app:<password>@/clor_console?host=/cloudsql/clor-apps-511409:asia-south1:clor-pg` |
| `console-github-private-key` | The `.pem` file from step 1 |
| `console-github-client-secret` | From step 1 |
| `console-cf-read-token` | From step 4 |

Build and deploy (from the repository root):

```bash
gcloud builds submit console/api --project $PROJECT --tag $REGION-docker.pkg.dev/$PROJECT/clor/console-api:$(git rev-parse --short=7 HEAD)

gcloud run deploy clor-console --project $PROJECT --region $REGION \
  --image $REGION-docker.pkg.dev/$PROJECT/clor/console-api:$(git rev-parse --short=7 HEAD) \
  --service-account $SA --allow-unauthenticated --min-instances 0 --max-instances 2 \
  --add-cloudsql-instances $PROJECT:$REGION:clor-pg \
  --set-env-vars NODE_ENV=production,CONSOLE_WEB_ORIGIN=https://console.clor.in,CONSOLE_API_ORIGIN=https://console.clor.in,CONSOLE_OWNER_GITHUB_IDS=<your numeric id>,CONSOLE_GITHUB_APP_ID=<app id>,CONSOLE_GITHUB_INSTALLATION_ID=<installation id>,CONSOLE_GITHUB_CLIENT_ID=<client id>,CONSOLE_CF_ACCOUNT_ID=<cloudflare account id> \
  --set-secrets CONSOLE_SESSION_SECRET=console-session-secret:latest,CONSOLE_DATABASE_URL=console-database-url:latest,CONSOLE_GITHUB_PRIVATE_KEY=console-github-private-key:latest,CONSOLE_GITHUB_CLIENT_SECRET=console-github-client-secret:latest,CONSOLE_CF_READ_TOKEN=console-cf-read-token:latest
```

"Allow unauthenticated" means Google does not ask for a Google login; the
Console's own sign-in guards every route. The service refuses to start if a
setting is missing and names it in its log.

The API has no address of its own. `console.clor.in/api/*` is forwarded to it
by a Cloudflare Pages Function (`console/web/functions/api/[[path]].js`), the
same arrangement as `api.clor.in`. Two things tie them together:

- `ORIGIN` in `console/web/wrangler.toml`: the service's `run.app` address.
- An edge secret, so the `run.app` address answers nothing directly:
  `openssl rand -hex 32`, stored as the secret `console-edge-secret`, given to
  the service as `CONSOLE_EDGE_SECRET`, and to the page with
  `wrangler pages secret put CONSOLE_EDGE_SECRET --project-name clor-console`.

## 4. Console page on Cloudflare Pages

- Cloudflare → My Profile → API Tokens → Create Token → custom: **Account →
  Cloudflare Pages → Read**, this account only. That is `console-cf-read-token`.
- Workers & Pages → Create → Pages → project name `clor-console`, direct upload.
- Publish: `npm run console:build`, then from `console/web`: `wrangler pages deploy --branch main`
  (it reads `wrangler.toml` there and uploads the page and the forwarder).
- Custom domain `console.clor.in` on that project.

Done 15 Nov 2026: the project, the page and `console.clor.in` exist. `ORIGIN`
is still empty, so `/api` answers "The Console server is not set up yet."

Open https://console.clor.in, sign in with GitHub, set up your authenticator.
Overview, Pull requests, Log and Members work from here. Release and Roll
back answer "GitHub answered 404" until steps 5 to 7 are done.

## 5. Google Cloud access for GitHub Actions (no stored key)

**Done 15 Nov 2026** with `console/setup/release-access.sh` (safe to run again).
It makes:

- A workload identity pool `github` with provider `clor-platform`, which
  trusts only this repository and only `main`.
- One service account, `clor-release`, usable only by a job in the GitHub
  environment `production`. It may: back up Cloud SQL, submit a build as
  `clor-build`, run the migrate job, deploy and move traffic on Cloud Run as
  `clor-api-run`, read the image repository and read logs.

Two things learned doing it:

- **GitHub's job identity is not the plain repository name here.** With
  immutable subjects on, it is
  `repo:Clor-applications@<owner id>/clor-platform@<repository id>:environment:production`.
  The script asks GitHub for the prefix. A binding under the plain name is
  refused with "Permission iam.serviceAccounts.getAccessToken denied".
- **There is no traffic-only account.** A separate rollback account with no
  approval was tried. Cloud Run refuses a traffic move unless the caller may
  read the image and may act as the service's runtime account, and the second
  is the right to start any revision. So rolling back uses `clor-release` and
  the same approval as a release; the weaker account was deleted.

## 6. GitHub environment, variables and secrets

**Done 15 Nov 2026**, except the Cloudflare secrets.

| Environment | Deployment branches | Required reviewers | Prevent self-review |
|---|---|---|---|
| `production` | `main` only | The owner | Off (the owner starts and approves) |

Repository variables:

| Variable | Value |
|---|---|
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/398490688104/locations/global/workloadIdentityPools/github/providers/clor-platform` |
| `GCP_RELEASE_SERVICE_ACCOUNT` | `clor-release@clor-apps-511409.iam.gserviceaccount.com` |
| `WRANGLER_VERSION` | `4.149.0`, the version on the release Mac |

Secrets on the `production` environment only (never repository-wide):

| Secret | Value | State |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | A token with Account → Cloudflare Pages → Edit | **Not set.** Stage and Roll back work without it; Release (`go`) needs it to publish the web app |
| `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account id | **Not set** |
| `AGENT_SIGNING_KEY` | Optional: the contents of `~/.config/clor/agent-signing.key`. Left out, the connector is built unsigned, as on a Mac without the key | Not set, on purpose |

## 7. Branch rule: not switched on

`.github/CODEOWNERS` names the owner for `.github/`, the release scripts,
`deploy/` and `console/api/`. "Require review from Code Owners" is **off**:
every pull request is opened from the owner's own GitHub account, and GitHub
does not let an author approve their own pull request, so the rule would make
those paths unmergeable. Switch it on when a second GitHub account does the
reviewing or the authoring. Until then the guard is the Console itself, which
refuses to merge a pull request that touches those paths.

## 8. Sign-in with a CLOR login (optional; GitHub sign-in works without it)

The Console can also be opened with a CLOR staff login. The customer API makes
a one-minute pass; the Console checks it with a public key. The private key
lives only in the customer API, the public key only in the Console.

**Done 15 Nov 2026**: the key pair is in Secret Manager, the customer API
carries the private key (revision `clor-api-00135-fw2`), and the Console
carries the public key. Sign in with CLOR is live. What follows is how it was
switched on, and how to do it again:

| Secret | Holds | Goes to |
|---|---|---|
| `CONSOLE_GRANT_PRIVATE_KEY` | The private key | `clor-api` only |
| `console-clor-grant-public-key` | The public key | `clor-console` only |

To switch it on, in this order:

1. Merge this work and release the customer app (`scripts/release.sh --go`),
   so the pass route and the Ops confirm screen are live.
2. Give the customer API the private key (a new revision; move traffic to it
   as for any release):
   `gcloud run services update clor-api --project clor-apps-511409 --region asia-south1 --update-secrets CONSOLE_GRANT_PRIVATE_KEY=CONSOLE_GRANT_PRIVATE_KEY:latest --update-env-vars CONSOLE_API_ORIGIN=https://console.clor.in`
   and let `clor-api-run` read that secret.
3. Give the Console the public key: `CONSOLE_ENABLE_CLOR=1 console/api/scripts/deploy.sh <owner address>`.
   The same address becomes an owner by CLOR login, joined to the member it
   already has by password.

Doing 3 before 1 puts a "Sign in with CLOR" button on the Console that leads
to an Ops page which ignores it.

To make a new pair (rotation):

```bash
openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt | gcloud secrets versions add CONSOLE_GRANT_PRIVATE_KEY --data-file=-
gcloud secrets versions access latest --secret CONSOLE_GRANT_PRIVATE_KEY | openssl ec -pubout 2>/dev/null | gcloud secrets versions add console-clor-grant-public-key --data-file=-
```

How it then works:

- Only CLOR staff in Ops (with their Ops authenticator) can get a pass.
- The Console still decides who gets in, from its own Members list, and asks
  for **its own** authenticator code before it shows anything. A fault in the
  customer API does not open the Console by itself.
- Someone who came in with CLOR can read. To release, roll back, merge or
  close they connect their own GitHub account (Your sign-in), because those
  are done on GitHub in their name. The owner needs a GitHub account either
  way: GitHub only lets a GitHub user approve a release.
- You, the first owner: nothing to do. Your address is named in the
  Console's settings (`CONSOLE_OWNER_CLOR_EMAILS`), so your first CLOR sign-in
  makes you an owner on the member you already have.
- Others: Members → Add member, by GitHub username, CLOR login address, or both.

To switch it off: remove `CONSOLE_CLOR_GRANT_PUBLIC_KEY` from `clor-console`.

## Trying it

- **Roll back, changing nothing:** start Roll back with the revision that is
  already serving. It exercises the sign-in to Google Cloud, the approval,
  the permissions and the ready check, and moves no customer.
- **Stage:** Actions → Release → Run workflow → `stage`, with the head commit
  of `main`, after a full test run on it. Approve it. It builds, applies
  migrations and starts a revision with no traffic, the same as
  `scripts/release.sh --stage`.

The Mac path (`scripts/release.sh --stage`, `--go`, `--rollback <revision> --go`)
keeps working and is the way in when GitHub or the Console is down.

## Running it on a laptop

```bash
npm ci && npm ci --prefix console/api
npm run console:dev
```

Page on http://127.0.0.1:5191, API on 4010 with canned GitHub and cloud
answers and a memory store. Sign in at `/api/auth/dev` (owner, as if by
GitHub), `/api/auth/dev?via=clor` (owner, as if by CLOR login),
`/api/auth/dev?id=1002&login=dev-engineer` or `?id=1003&login=dev-viewer`.
The API refuses to start this way when `NODE_ENV=production`.

Tests: `npm test --prefix console/api` (add
`CONSOLE_TEST_POSTGRES_URL=postgresql://$(whoami)@localhost:5434/postgres` to
include the Postgres store), `npx vitest run console/web`, and
`node console/check-separation.mjs`.
