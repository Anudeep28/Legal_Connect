# Ubuntu deployment

This is a native Ubuntu deployment for one server: the API runs under systemd, Caddy serves the Vite build and provides HTTPS, PostgreSQL remains on the host, and MinIO stores private consultation attachments. Only MinIO runs in Docker Compose. The web and API services do not require Docker.

## Requirements and DNS

- Ubuntu 22.04 or 24.04, a public server address, Node.js 24, pnpm 10, Caddy, Docker Engine with the Compose plugin, and MinIO Client (`mc`).
- Create DNS A records for `consultwithlawyer.in`, `www.consultwithlawyer.in`, and `files.consultwithlawyer.in` pointing to this server.
- Allow inbound TCP 80 and 443 for Caddy, plus SSH from trusted addresses. Do not expose PostgreSQL, the Node API, or MinIO's ports directly to the internet.
- This deployment expects the repository at `/opt/legal-connect`. If you use another path, update the service file and Caddyfile.

## 1. PostgreSQL

Create an application database and dedicated role. Keep PostgreSQL bound to loopback; the API runs directly on the host, so it does not need a public database listener. Back up any existing database before applying schema changes.

The code does not run schema DDL at startup. From the repository, with the production `DATABASE_URL` loaded into the shell, inspect and apply the schema using:

```sh
pnpm --filter @workspace/db run push
```

Do not use `push-force` as a routine deployment command. Review Drizzle's proposed changes and take a database backup first. If migrating from the Replit database, export and restore the data separately; copying this source repository does not move database rows or old uploaded files.

## 2. MinIO

Create a private data directory on a persistent disk and a private MinIO environment file:

```sh
sudo install -d -m 0750 -o root -g root /srv/minio/consultwithlawyer
sudo install -d -m 0750 /etc/consultwithlawyer
sudo cp deploy/ubuntu/minio.env.example /etc/consultwithlawyer/minio.env
sudo chmod 600 /etc/consultwithlawyer/minio.env
```

Set a verified, pinned release tag and strong unique root credentials in that file. Start MinIO with:

```sh
cd /opt/legal-connect
docker compose --env-file /etc/consultwithlawyer/minio.env \
  -f deploy/ubuntu/minio.compose.yml up -d
```

MinIO's S3 API and console bind only to `127.0.0.1`; Caddy exposes only the HTTPS S3 API on `files.consultwithlawyer.in`. The console on port 9001 is not routed publicly.
For administrative console access, use an SSH tunnel such as `ssh -L 9001:127.0.0.1:9001 your-user@your-server`, then open `http://127.0.0.1:9001` locally. The MinIO bucket has no anonymous-read policy.

Create the bucket and restricted application user with `mc`. Load the private admin values and app-user credentials into a root shell from the private configuration files, then run:

```sh
set -a
. /etc/consultwithlawyer/minio.env
. /etc/consultwithlawyer/app.env
set +a
export MINIO_APP_ACCESS_KEY="$MINIO_ACCESS_KEY"
export MINIO_APP_SECRET_KEY="$MINIO_SECRET_KEY"
sudo -E deploy/ubuntu/setup-minio-bucket.sh
```

The script installs a policy limited to the attachments bucket and applies CORS for the website's HTTPS origins. Use the app user's access key and secret—not the MinIO root credentials—in `app.env`.

Back up `/srv/minio/consultwithlawyer` separately from the server. A disk snapshot on the same machine is not an off-server backup.
This setup does not configure encryption at rest by itself. Use encrypted storage and an off-server backup appropriate to the sensitivity and retention requirements for consultation documents.

## 3. Application environment and build

Copy the templates to private files outside the repository:

```sh
sudo cp deploy/ubuntu/app.env.example /etc/consultwithlawyer/app.env
sudo cp deploy/ubuntu/frontend-build.env.example /etc/consultwithlawyer/frontend-build.env
sudo chmod 600 /etc/consultwithlawyer/*.env
```

Fill in the production PostgreSQL URL, production Clerk keys, and MinIO app-user credentials. Configure Clerk's production domain, sign-in redirects, and allowed origins for `consultwithlawyer.in`. Do not assume Replit preview accounts or credentials work as a production Clerk setup.

Build after loading the public Vite configuration:

```sh
set -a
. /etc/consultwithlawyer/frontend-build.env
set +a
cd /opt/legal-connect
deploy/ubuntu/build.sh
```

The Vite `VITE_` variables are embedded in the browser bundle and must not contain secrets. The API's private keys stay in `/etc/consultwithlawyer/app.env`.

## 4. API service and Caddy

Create a dedicated non-login `consultwithlawyer` OS user, ensure it can read the repository and built files, then install the service:

```sh
sudo cp deploy/ubuntu/consultwithlawyer-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now consultwithlawyer-api
```

Install the Caddyfile and validate/reload it:

```sh
sudo cp deploy/ubuntu/Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy serves the static SPA with an `index.html` fallback, proxies `/api/*` to the loopback-only API, and obtains certificates for the apex, `www`, and `files` hosts. Ensure Caddy can read the build directory.

## 5. Verify

```sh
systemctl --no-pager --full status consultwithlawyer-api
curl -fsS https://consultwithlawyer.in/api/healthz
curl -fsS https://consultwithlawyer.in/api/readyz
```

Then test sign-in with the production Clerk instance, create a test consultation, upload a small attachment, confirm it, open it as each participant, and verify an unrelated account is denied.

## Updating the app

Fetch and review the desired `main` commit, install with `pnpm install --frozen-lockfile`, rebuild with the same frontend build environment, and restart `consultwithlawyer-api`. Run schema changes separately after a database backup and review. Keep the previous code/build available until the new version passes smoke tests.

## Replit storage compatibility

`OBJECT_STORAGE_PROVIDER=replit` remains the default for the Replit deployment. On Ubuntu set it to `minio` and configure the `MINIO_*` variables above. Existing Replit objects are not copied to MinIO automatically; plan a separate export/copy and database path migration if existing attachment data must be preserved.
