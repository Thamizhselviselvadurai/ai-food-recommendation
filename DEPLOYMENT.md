# Deployment

This repository is an npm-workspaces monorepo with **two deployable parts**:

| Part | Path | What it is | Where it can run |
| --- | --- | --- | --- |
| Frontend | `client/` | Vite + React SPA (static files) | **Cloudflare Workers** (static assets) |
| Backend | `server/` | Node + Express + Mongoose, long-running | **Not Cloudflare** — any Node host |
| ML (optional) | `ml/` | Python crowd model service | Optional; app works without it |

## Why the backend cannot go on Cloudflare

This is the one thing that decides the whole deployment shape, so it is worth
being precise about:

- **Workers are not Node.** They run on V8 isolates. Express expects Node's
  `http` server and a persistent process; neither exists there.
- **Mongoose cannot connect.** The MongoDB driver speaks the binary wire
  protocol over raw TCP with SRV DNS lookups. Workers only offer outbound
  `connect()` from `cloudflare:sockets`, and Hyperdrive accelerates Postgres and
  MySQL — not MongoDB.
- **The Atlas Data API is gone.** The HTTPS-based escape hatch that used to make
  MongoDB reachable from edge runtimes was retired in 2025.

Porting the backend to Workers would mean replacing Express, replacing Mongoose,
and replacing MongoDB. That is a rewrite, not a deployment. So:

> **Cloudflare hosts the frontend as a static-asset Worker. The API is deployed
> separately to a Node host, and the frontend is pointed at it.**

---

## 1. Backend first (deploy this before the frontend)

The frontend needs the API's public URL at **build time**, so deploy the API first.

Any Node host works — Render, Railway, Fly.io, a VPS. Settings:

| Setting | Value |
| --- | --- |
| Root directory | `server` |
| Build command | `npm install` |
| Start command | `npm start` |
| Node version | 20.x (see `.node-version`) |

### Database

The app needs MongoDB. Create a free **MongoDB Atlas** cluster and allow access
from your host's IPs (or `0.0.0.0/0` if the host has no static egress).

After the first deploy, seed the demo catalogue once:

```bash
npm run seed --workspace server
```

### Backend environment variables

Required:

| Variable | Notes |
| --- | --- |
| `MONGODB_URI` | Atlas connection string |
| `JWT_SECRET` | Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `CLIENT_ORIGIN` | Your Worker URL. Comma-separated for several, e.g. `https://food-ai-platform.workers.dev,https://foodai.com` |
| `NODE_ENV` | `production` |

Optional — the app degrades gracefully without every one of these:

| Variable | Default behaviour when unset |
| --- | --- |
| `ANTHROPIC_API_KEY` | Falls back to the built-in rule-based NLU and template explanations. Everything still works. |
| `GOOGLE_MAPS_API_KEY` | Falls back to OpenStreetMap (keyless). No star ratings, price levels or venue photos — the UI labels them unavailable rather than inventing them. |
| `PLACES_PROVIDER` | `auto` |
| `PLACES_TIMEOUT_MS` | `12000` |
| `WEATHER_PROVIDER` | `open-meteo` (keyless) |
| `OPENWEATHER_API_KEY` | Only needed if `WEATHER_PROVIDER=openweather` |
| `FOOD_IMAGES_ENABLED` | `true` — real CC-licensed dish photos from Wikimedia |
| `ML_CROWD_SERVICE_URL` | Rule-based crowd engine is used |
| `DEFAULT_LAT` / `DEFAULT_LNG` / `DEFAULT_CITY` | Coimbatore — used when a visitor declines location |

`PORT` is usually injected by the host; the app reads it automatically.

---

## 2. Frontend on Cloudflare Workers

Connect the GitHub repository in the Cloudflare dashboard
(**Workers & Pages → Create → Workers → Connect to Git**) and use:

| Setting | Value |
| --- | --- |
| Project name | `food-ai-platform` |
| Root directory | `/` *(repository root)* |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

The root directory stays at the repository root on purpose: this is an
npm-workspaces monorepo, so the install must happen at the root for the
workspace links to resolve. The root `build` script delegates to the client
workspace.

Everything else lives in **`wrangler.jsonc` at the repository root** — the
Worker name, the `compatibility_date`, and the `assets.directory` pointing at
`./client/dist`. Keep the deploy command as a bare `npx wrangler deploy`: adding
`--assets ./client/dist` on the command line conflicts with the `assets` block
in the config file and wrangler will refuse to run.

Because the config declares no `main` entry point, this deploys as a pure
static-asset Worker — no JavaScript runs per request.

### Frontend environment variable

Set this in **the Worker → Settings → Variables**, for Production *and*
Preview. It is read at build time by Vite, so it must be set as a build
variable:

| Variable | Value |
| --- | --- |
| `VITE_API_BASE_URL` | Your deployed API origin, e.g. `https://foodai-api.onrender.com` — no trailing slash |

The frontend throws on startup if this is unset in a production build, rather
than silently issuing requests to its own origin and failing later.

Optional map overrides: `VITE_MAP_TILE_URL`, `VITE_MAP_ATTRIBUTION`.

> `VITE_*` values are compiled into the public browser bundle. Never put a
> secret in one. The Google Places key stays on the server, which proxies photo
> requests so the key is never exposed.

Because Vite inlines these at build time, changing `VITE_API_BASE_URL` requires a
redeploy, not just a restart.

### SPA routing

`wrangler.jsonc` sets `assets.not_found_handling` to `single-page-application`,
so deep links such as `/near-me` and `/restaurant/:id` serve `index.html`
instead of 404ing on refresh.

`client/public/_redirects` states the same intent with `/* /index.html 200`, but
that proxying rewrite is a Pages-only feature — Workers ignores it. The file is
kept as harmless documentation; the `not_found_handling` setting is what
actually takes effect.

---

## 3. Connect the two

1. Deploy the backend; note its URL.
2. Set `VITE_API_BASE_URL` on the Worker to that URL and deploy the frontend.
3. Set `CLIENT_ORIGIN` on the backend to the Worker URL and restart it.

Step 3 is what makes CORS pass. Skipping it is the usual cause of a deployed
frontend that loads but whose every request fails.

### Verifying

```bash
curl https://<your-api-host>/api/health
```

A healthy response reports database connectivity, whether the LLM is live or
using the rule-based fallback, and which crowd engine is active.

---

## Local development

```bash
npm install
cp server/.env.example server/.env   # then fill in JWT_SECRET and MONGODB_URI
npm run seed
npm run dev                          # client :5173, API :5000
```

The Vite dev server proxies `/api` to `http://127.0.0.1:5000`, so
`VITE_API_BASE_URL` is left empty locally and no CORS setup is needed.
