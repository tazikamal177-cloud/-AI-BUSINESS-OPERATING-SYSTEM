# AIBOS — Staging Deployment Runbook

This runbook covers the **staging** environment (single Linux VM running
Docker Compose). It is the operational reference for: bootstrap, deploys,
rollbacks, secrets, certificates, troubleshooting.

Production deployment is a separate runbook (to be written once the
infrastructure target is decided — see the Phase 11 questions).

---

## 1. Architecture overview

```
Internet
   │
   │ 80 / 443
   ▼
┌────────────────────────┐
│ nginx (reverse proxy)  │  public ports 80/443
└──────────┬─────────────┘
           │
   ┌───────┴───────┐
   ▼               ▼
┌────────┐    ┌──────────┐
│frontend│    │ backend  │  internal network "frontend"
│ :3000  │    │  :3001   │  internal network "backend"
└────────┘    └────┬─────┘
                  │
       ┌──────────┼──────────┐
       ▼          ▼          ▼
   ┌──────┐  ┌──────┐  ┌──────┐
   │redis │  │ pg+  │  │minio │  internal network "backend"
   │:6379 │  │vector│  │:9000 │
   └──────┘  └──────┘  └──────┘
```

**Public surface**:
- `https://staging.aibos.example.com/` — Next.js frontend
- `https://staging.aibos.example.com/api/*` — NestJS backend
- `https://staging.aibos.example.com/docs` — Swagger UI (open in staging only)
- `https://staging.aibos.example.com/api/health` — healthcheck

**Internal surface** (no public access):
- Postgres, Redis, MinIO — only reachable from the backend container

---

## 2. VM requirements

| Resource | Minimum | Recommended |
|---|---|---|
| OS | Ubuntu 22.04 LTS | Ubuntu 24.04 LTS |
| CPU | 2 vCPU | 4 vCPU |
| RAM | 4 GB | 8 GB |
| Disk | 40 GB SSD | 80 GB SSD |
| Network | 100 Mbps | 1 Gbps |

**Ports open on the VM**:
- `22` (SSH)
- `80`, `443` (HTTP/HTTPS)
- All other ports must be **firewalled off**.

The VM user is typically `ubuntu` (or `deploy` if you provision a dedicated user).
The runbook assumes user `deploy` with passwordless `sudo`.

---

## 3. Initial bootstrap (one-time)

Run these steps manually the first time the VM is created. After that,
all subsequent deploys are automated via GitHub Actions.

### 3.1. Install Docker

```bash
# As 'deploy' user
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
  sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Add the 'deploy' user to the docker group (so docker works without sudo)
sudo usermod -aG docker deploy
newgrp docker
docker --version  # should print Docker version >= 24
```

### 3.2. Prepare the deploy directory

```bash
sudo mkdir -p /opt/aibos
sudo chown deploy:deploy /opt/aibos
cd /opt/aibos

# Clone the repo (this is the canonical copy the CD workflow syncs into)
git clone https://github.com/<org>/<repo>.git .
git checkout main
```

### 3.3. Provision the `.env.staging` file

The `.env.staging` is **never** committed. It lives at
`/opt/aibos/backend/.env.staging` with `chmod 600`.

```bash
cp backend/.env.staging.example backend/.env.staging
chmod 600 backend/.env.staging
$EDITOR backend/.env.staging
```

**Generate the secrets**:

```bash
# JWT secrets
openssl rand -hex 64   # paste into JWT_SECRET
openssl rand -hex 64   # paste into JWT_REFRESH_SECRET

# Encryption key (32 bytes hex = 64 chars)
openssl rand -hex 32   # paste into ENCRYPTION_KEY

# Database password
openssl rand -base64 24 | tr -d '/=+' | cut -c1-32   # paste into DB_PASSWORD
                                                           # and the S3 secret too

# Redis password
openssl rand -hex 24   # paste into REDIS_PASSWORD
```

**API keys** (OpenAI, Anthropic, Google) come from the corresponding
vendor dashboards. SMTP credentials from Mailgun/SendGrid.

### 3.4. Provision ghcr.io credentials

The CD workflow logs into ghcr.io from the VM. Provision a GitHub PAT
with `read:packages` scope and save it to disk:

```bash
echo "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" > /opt/aibos/.ghcr-token
echo "<github-username>" > /opt/aibos/.ghcr-user
chmod 600 /opt/aibos/.ghcr-token /opt/aibos/.ghcr-user
```

### 3.5. TLS certificates (Let's Encrypt)

**Do not** commit certs. The first time, generate them with certbot:

```bash
# On the VM, with port 80 reachable from the internet
sudo apt install -y certbot
sudo certbot certonly --standalone \
  -d staging.aibos.example.com \
  --email [email protected] \
  --agree-tos --no-eff-email

# Copy the certs to the nginx mount point
sudo cp /etc/letsencrypt/live/staging.aibos.example.com/fullchain.pem \
        /opt/aibos/docker/nginx/certs/cert.pem
sudo cp /etc/letsencrypt/live/staging.aibos.example.com/privkey.pem \
        /opt/aibos/docker/nginx/certs/key.pem
sudo chown -R deploy:deploy /opt/aibos/docker/nginx/certs
sudo chmod 600 /opt/aibos/docker/nginx/certs/key.pem
```

Then uncomment the HTTPS server block in
`/opt/aibos/docker/nginx/conf.d/default.conf` and restart nginx:

```bash
docker compose -f /opt/aibos/docker/docker-compose.staging.yml \
  restart nginx
```

Set up a cron job for auto-renewal:

```bash
echo "0 3 * * * certbot renew --quiet --post-hook 'cp /etc/letsencrypt/live/staging.aibos.example.com/*.pem /opt/aibos/docker/nginx/certs/ && docker compose -f /opt/aibos/docker/docker-compose.staging.yml restart nginx'" | \
  sudo crontab -
```

### 3.6. First deploy

Once the bootstrap is done, the first deploy can be triggered either
manually (SSH into the VM and run `scripts/deploy-staging.sh` with the
right env vars) or by pushing a tag:

```bash
# Local repo
git tag v0.1.0-staging
git push origin v0.1.0-staging
```

The CD workflow will:
1. Build backend + frontend images
2. Push them to ghcr.io
3. SSH into the VM, run `scripts/deploy-staging.sh`
4. Run `scripts/smoke-tests.sh`

Watch the GitHub Actions tab for progress.

---

## 4. Day-to-day deploy

### 4.1. Deploy a release

```bash
# Locally
git tag v0.2.0
git push origin v0.2.0
```

That's it. The CD workflow handles the rest.

### 4.2. Hotfix without a tag

Use the GitHub Actions UI: **Actions → CD — Staging deploy → Run workflow**
→ fill the `ref` input with the branch or commit SHA you want to deploy.

### 4.3. Rollback

The previous image is still on the VM. To roll back:

```bash
ssh deploy@<vm>
cd /opt/aibos
export BACKEND_IMAGE=ghcr.io/<org>/aibos-backend
export FRONTEND_IMAGE=ghcr.io/<org>/aibos-frontend
export IMAGE_TAG=<previous-tag>      # e.g. v0.1.0
./scripts/deploy-staging.sh
```

If the rollback script itself is broken, you can fall back to
re-tagging the previous image:

```bash
docker pull ${BACKEND_IMAGE}:v0.1.0
docker tag ${BACKEND_IMAGE}:v0.1.0 ${BACKEND_IMAGE}:staging
docker compose -f docker/docker-compose.staging.yml up -d
```

### 4.4. Database migrations

Migrations run automatically on every deploy (`prisma migrate deploy`).
If a migration fails, the deploy aborts and the stack is left in its
previous state.

To apply migrations manually (without restarting):

```bash
docker compose -f /opt/aibos/docker/docker-compose.staging.yml \
  --env-file /opt/aibos/backend/.env.staging \
  run --rm backend npx prisma migrate deploy
```

To create a new migration (in dev):

```bash
# Local
cd backend
npx prisma migrate dev --name <descriptive-name>
# Commit the new migration file in prisma/migrations/
```

---

## 5. Observability

### 5.0. Health endpoint paths (Phase 11.5)

| Endpoint | Mounted at | Use |
|---|---|---|
| Liveness  | `/api/health`        | Docker `HEALTHCHECK` (cheap, no DB query) |
| Readiness | `/api/health/ready`  | Orchestrator (probes DB + Redis + S3 + AI) |

Both endpoints are mounted with `VERSION_NEUTRAL` so they are not
versioned. The `app.setGlobalPrefix('api')` is still applied, hence
the `/api/...` prefix. This avoids the Docker healthcheck breaking if
the API version ever changes.

Health endpoints are **excluded from request logs** (`pino-http`
`autoLogging.ignore`) to avoid log spam from k8s/Docker probes.

### 5.1. Logs

All services log to stdout in JSON format (Pino). View with:

```bash
# All services
docker compose -f /opt/aibos/docker/docker-compose.staging.yml logs -f

# One service, last 100 lines
docker compose -f /opt/aibos/docker/docker-compose.staging.yml logs --tail=100 -f backend
```

To export to a central log aggregator (Loki, CloudWatch, Datadog), point
a log shiper at `/var/lib/docker/containers/*/*.log`.

**Log schema (backend JSON lines, one per request):**

```json
{
  "level": 30,
  "time": 1756923456789,
  "pid": 17,
  "hostname": "aibos-backend-staging",
  "service": "aibos-backend",
  "req": { "method": "POST", "url": "/api/auth/login", "remoteAddress": "10.0.0.42" },
  "res": { "statusCode": 200 },
  "responseTime": 87,
  "msg": "request completed"
}
```

Field reference:

| Field | Type | Notes |
|---|---|---|
| `level` | int | Pino: 10=trace, 20=debug, 30=info, 40=warn, 50=error, 60=fatal |
| `time` | int | Unix ms (multiply by 1000 for seconds) |
| `pid` | int | Container PID |
| `hostname` | str | Container name |
| `service` | str | Always `aibos-backend` (set via `customProps`) |
| `req.method` | str | HTTP method |
| `req.url` | str | Request path (no query string) |
| `req.remoteAddress` | str | Client IP (X-Forwarded-For NOT used here — see Nginx) |
| `res.statusCode` | int | HTTP response code |
| `responseTime` | int | Milliseconds |
| `msg` | str | Human-readable summary |

**Redacted fields** (replaced with `[REDACTED]`):
- `req.headers.authorization` (Bearer tokens)
- `req.headers.cookie`
- `req.body.password`
- `req.body.credentials`

**Excluded from logging** (to avoid probe noise):
- `GET /api/health`
- `GET /api/health/ready`

To switch the log level temporarily, set `LOG_LEVEL=debug` in
`.env.staging` and restart the backend:

```bash
docker compose -f /opt/aibos/docker/docker-compose.staging.yml \
  --env-file /opt/aibos/backend/.env.staging \
  up -d backend
```

### 5.2. Healthchecks

| Endpoint | Purpose | Frequency |
|---|---|---|
| `/api/health` | Liveness — backend is up | every 30s (Docker) |
| `/api/health/ready` | Readiness — DB + Redis + storage + AI | every 30s (Docker compose `condition: service_healthy`) |

A failing `/api/health/ready` means the backend is up but a dependency
is down. Check the relevant container's logs.

### 5.3. Resource monitoring

```bash
docker stats
```

For long-term metrics, install Node Exporter + Prometheus on the VM.
This is out of scope for the MVP staging runbook.

---

## 6. Backups

### 6.1. Postgres

Daily logical dump via `pg_dump` (run via cron on the VM):

```bash
# /opt/aibos/scripts/backup-postgres.sh
docker compose -f /opt/aibos/docker/docker-compose.staging.yml \
  exec -T postgres pg_dump -U aibos aibos | \
  gzip > /opt/aibos/backups/postgres-$(date +%F-%H%M).sql.gz

# Keep last 30 days
find /opt/aibos/backups -name 'postgres-*.sql.gz' -mtime +30 -delete
```

Cron entry:

```bash
0 2 * * * /opt/aibos/scripts/backup-postgres.sh
```

### 6.2. MinIO

S3 client (e.g. `mc mirror` or `rclone`) to a remote bucket. The
minio-init container can be repurposed for periodic sync.

### 6.3. Redis

Redis is used as cache + BullMQ queue. **Not** backed up. Loss is
acceptable; the system is designed to recover from cold cache.

---

## 7. Troubleshooting

### 7.1. Stack is up but `/api/health/ready` returns 503

A dependency (DB, Redis, MinIO) is down.

```bash
docker compose -f /opt/aibos/docker/docker-compose.staging.yml ps
docker compose -f /opt/aibos/docker/docker-compose.staging.yml logs --tail=200 postgres
docker compose -f /opt/aibos/docker/docker-compose.staging.yml logs --tail=200 redis
```

### 7.2. Backend won't start after a deploy

Most common cause: a Prisma migration failed.

```bash
docker compose -f /opt/aibos/docker/docker-compose.staging.yml logs --tail=200 backend
```

Look for "P3009" or "migration failed". If so, run migrations manually
(see §4.4) or roll back (see §4.3).

### 7.3. Frontend shows "Network Error" on every page

The Next.js rewrite to `http://localhost:3001/api/v1/*` is failing.
Either the backend is down (check `/api/health`) or the rewrite is
misconfigured in `next.config.mjs`.

### 7.4. Out of disk space

```bash
df -h                              # check overall
docker system df                   # check docker usage
docker system prune -a --volumes   # DANGER: removes everything, only in emergencies
```

Regular cleanup: prune dangling images weekly via cron.

### 7.5. Locked out (nginx won't start, bad cert)

```bash
# Disable the HTTPS server block (comment it out)
docker compose -f /opt/aibos/docker/docker-compose.staging.yml restart nginx
# Or stop the stack entirely
docker compose -f /opt/aibos/docker/docker-compose.staging.yml down
# Now port 80 is unreachable too — SSH is still open
```

### 7.6. SSH access is gone

This is out of scope. The cloud provider's console (Hetzner Cloud
Console, DO Droplet Console, etc.) gives you out-of-band access. From
there, fix the firewall or restart the VM.

---

## 8. Security checklist

- [ ] `.env.staging` is `chmod 600` and owned by `deploy`
- [ ] TLS certificates are valid (not self-signed) and auto-renewing
- [ ] Ports 22, 80, 443 only are open on the VM
- [ ] No port mapping on postgres/redis/minio in docker-compose
- [ ] SSH key-only authentication (password auth disabled)
- [ ] Fail2ban installed (or equivalent)
- [ ] Automatic security updates enabled (`unattended-upgrades`)
- [ ] GitHub Actions secrets rotated every 90 days
- [ ] `.ghcr-token` on the VM has only `read:packages` scope
- [ ] Database backups encrypted at rest

---

## 9. Appendix: file map

| File | Purpose |
|---|---|
| `docker/docker-compose.staging.yml` | Stack definition |
| `docker/nginx/nginx.conf` | Nginx main config |
| `docker/nginx/conf.d/default.conf` | Server block, routing rules |
| `docker/nginx/certs/` | TLS certs (gitignored) |
| `backend/.env.staging` | Secrets (gitignored, chmod 600) |
| `backend/.env.staging.example` | Template (versioned) |
| `backend/Dockerfile` | Backend image |
| `frontend/Dockerfile` | Frontend image |
| `scripts/deploy-staging.sh` | Called by CD on every release |
| `scripts/smoke-tests.sh` | Called by CD after deploy |
| `scripts/backup-postgres.sh` | (To create) Daily pg_dump |
| `.github/workflows/ci.yml` | PR / main validation |
| `.github/workflows/cd.yml` | Release deploys |

---

**Last updated**: 2026-09-03
**Maintained by**: AIBOS team
