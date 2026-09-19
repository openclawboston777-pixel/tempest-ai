# Deploying Tempest AI (Ema) — Slice 1

Slice 1 is **stateless compute only** (no DB). One Docker container serves
both the API and the built widget. Persistent data (RDS/S3) arrives in later
slices and will live in AWS. This stack is fully isolated: its own Compose
project (`tempest`), its own network (`tempest-net`), and its own host port
(`8090`).

## 1. Get the repo onto the VPS

```bash
git clone <REPO_URL> tempest
cd tempest
# or, if it already exists:
git pull
```

## 2. Configure secrets

```bash
cd deploy
cp .env.example .env
# edit .env and fill in:
#   XAI_API_KEY
#   SHOPIFY_STOREFRONT_TOKEN
#   (adjust CORS_ORIGIN / model / domain if needed)
```

## 3. Build and start

```bash
docker compose up -d --build
```

This builds the multi-stage image (widget + backend), producing a single
container `tempest-ema` that serves the API and the widget bundle.

## 4. Verify

```bash
curl http://localhost:8090/health
```

You should get a healthy response. The widget bundle is available at
`http://localhost:8090/embed.js`.

## 5. Put it behind HTTPS (reverse proxy)

Use Caddy (automatic HTTPS) or Nginx to expose a public HTTPS URL that
forwards to port `8090`.

Minimal `Caddyfile`:

```
yourdomain.com {
    reverse_proxy localhost:8090
}
```

Then:

```bash
caddy run --config ./Caddyfile
# or run Caddy as a service
```

## 6. Embed on Shopify

Add via a theme app embed or a script tag in `theme.liquid`, just before
`</body>`:

```html
<script>window.TempestConfig={backendUrl:"https://YOURDOMAIN",assistantName:"Ema"};</script>
<script src="https://YOURDOMAIN/embed.js" defer></script>
```

Replace `YOURDOMAIN` with the HTTPS domain from step 5.

---

## Notes

- **Compute on the VPS, DATA in AWS** (RDS/S3) in later slices. Slice 1 is
  stateless — no database, nothing to persist.
- **Isolation**: this stack uses its own Compose project (`tempest`), its own
  network (`tempest-net`), and host port `8090`, so it will not collide with
  other stacks on the same VPS.
- **Migrating to a dedicated VPS later**: copy the repo + `deploy/.env` to the
  new host and run `docker compose up -d --build`. That's it.
