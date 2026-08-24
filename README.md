# 🍜 Food AI — what to eat, where to eat, and whether it's worth going

A full-stack platform that answers the questions a food-ordering app never does:

> **"I don't know what to eat."**
> **"I don't want to order online — show me good food near me."**
> **"Which nearby restaurant is affordable and not too crowded?"**
> **"Just decide for me based on my situation."**

It is not a delivery-app clone. The differentiator is a **deterministic
recommendation engine** that scores real menu data against your mood, hunger,
budget, diet, nutrition, spice, history, distance and crowd — combined with
**our own restaurant crowd-estimation system** and an LLM that *explains*
decisions it did not make.

---

## The one design rule

**The LLM never decides what to recommend.**

```
your sentence ──► [LLM #1] structured intent ──► recommendation engine ──► MongoDB
                                                          │
                  [LLM #2] plain-English reply ◄───────────┘  (grounded in the results)
```

The model turns a sentence into typed fields, and later turns the engine's
factor breakdown into a readable sentence. Between those two steps, a
deterministic scorer picks from dishes that actually exist in the database.
That is what stops it inventing restaurants, prices or wait times.

**Everything works with no API key.** Without `ANTHROPIC_API_KEY`, a rule-based
NLU parses the sentence and template explanations are generated from the same
factor breakdown. No feature disappears.

---

## Quick start

**Prerequisites:** Node 18.18+, and MongoDB (local, Atlas, or the zero-install
in-memory mode below).

```bash
git clone <your-repo> Ai_foodsuggest
cd Ai_foodsuggest
npm install                       # installs server + client (npm workspaces)

cp server/.env.example server/.env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
# paste the output into JWT_SECRET in server/.env

npm run seed                      # 14 restaurants · 171 dishes · 3 weeks of crowd history
npm run dev                       # API on :5000, app on :5173
```

Open **http://localhost:5173**.

**Demo accounts** (created by the seeder):

| Email | Password | Profile |
|---|---|---|
| `demo@foodai.app` | `Demo@12345` | Non-veg, medium spice, ₹300 budget, has order history and learned preferences |
| `priya@foodai.app` | `Priya@12345` | Vegetarian, mild spice, ₹200 budget, nut allergy, high-protein |

You do **not** need an account — recommendations, the assistant, nearby
discovery and crowd reporting all work as a guest. Signing in adds
personalisation, favourites and ordering.

### No MongoDB installed?

Set `USE_MEMORY_DB=true` in `server/.env` and just run `npm run dev`. The server
boots an in-process MongoDB and seeds it automatically on every start. The data
is ephemeral, and the first run downloads a ~600 MB MongoDB binary — a local
`mongod` or a free Atlas cluster is faster and more reliable.

### Verify it's alive

```bash
curl http://localhost:5000/api/health
```

Returns database counts, whether the AI is live or on fallback, and which crowd
engine is in use.

---

## What's in it

### 1 · AI food recommendation (`/decide`)

Pick a mood from twelve options (Happy, Tired, Stressed, Sad, Very Hungry,
Slightly Hungry, Something Light/Spicy/Healthy, Need Energy, Craving, Late-Night),
then hunger, diet, spice, budget, cuisine, calories, protein, allergies, foods
to avoid, and maximum wait. You get ranked dishes with a match percentage,
a full score breakdown, and **Add to cart / Order now / Find nearby / Show
alternatives**.

### 2 · "Ask AI what should I eat?" (`/ask`)

A chat that handles the messy real phrasings:

| You say | It extracts |
|---|---|
| "I'm very hungry and I have only ₹150." | hunger=very_hungry, budget=150 |
| "I am tired and want something light." | mood=tired, hunger=light |
| "I want something spicy but not more than ₹250." | spice=hot, budget=250 |
| "I don't want rice today." | avoid=[rice] |
| "I want something near me and I don't want to wait." | useLocation, maxWait=20, avoidWaiting |

Chips under each reply show exactly what was understood, so a misread is
visible instead of mysterious.

### 3 · Nearby discovery + crowd intelligence (`/near-me`)

Location-permission-gated, with a Leaflet/OpenStreetMap map, distance, rating,
price band, open/closed, available dishes, **estimated crowd level and wait**,
plus Order and Navigate. Filter by price, cuisine, distance, "only quiet
places", "open now"; sort by best / nearest / shortest wait / least crowded /
top rated / cheapest.

```
Sri Krishna Bhavan          Biryani House
1.6 km · ★ 4.6 · ₹ Low      1.7 km · ★ 4.6 · ₹₹ Medium
🟢 Low Crowd                🔴 High Crowd
Est. wait 5–10 min          Est. wait 25–45 min
[View food] [Navigate]      [View food] [Navigate]
```

### 4 · Smart decision

The headline flow, on the Near me screen:

> "I'm hungry, I want biryani, I have ₹250, I'm near restaurants, and I don't want to wait."

→ parsed into `food=biryani, hunger=high, budget=250, location=current,
waiting=low` → nearby restaurants ranked → 🥇 best pick with the reason, plus
runners-up.

### 5 · Explainable recommendations

Every card carries a **"Why this recommendation?"** panel built from the
engine's own arithmetic — never a story written after the fact:

```
✓ Budget   ✓ Hunger   ✓ Food preference   ✓ Spice   ✓ Distance   ✓ Crowd

Factor              Weight   Match
Hunger               20%      99%   ~640 kcal (estimated) — suits a regular-sized meal
Budget               15%     100%   ₹165 fits your ₹250 budget
Crowd                18%      69%   moderate crowd right now, about 5–15 min wait
…
Bonuses  +12 You asked for "biryani"   +4 Well rated (★ 4.5)
```

`GET /api/recommendations/weights` returns the exact weights the UI displays.

### 6 · Learning from feedback

"✕ Not for me" → pick reasons (too expensive, too spicy, not filling, don't like
this food/restaurant, ate it recently, too far, too much waiting) → the app
tells you **what it changed**: budget lowered, spice ceiling reduced, portion
drift up, cuisine affinity down. Every adjustment is bounded, auditable and
resettable from Profile → *Reset learning*.

### 7 · Ordering

Cart (single-restaurant, enforced both ends), quantities, address, **simulated**
payment, order confirmation, order history, and a live status timeline that
advances with time (placed → confirmed → preparing → out for delivery →
delivered). No gateway, no card data, clearly labelled throughout.

### 8 · Weather-aware context

Optional Open-Meteo (keyless) or OpenWeather signal, used as a **small nudge**
only: rain lifts soups and hot snacks, heat lifts juices and lighter plates. If
the lookup fails, recommendations proceed unchanged.

---

## How crowd estimation works

We do **not** use — or claim to use — any map provider's live popularity data.
We build our own estimate from signals this app collects, blended with weights
renormalised over whichever signals actually have data:

| Signal | Weight | Source |
|---|---|---|
| Venue baseline | 34% | Modelled 7×24 curve from the venue's service profile and opening hours |
| Historical pattern | 24% | Rolled-up check-ins + crowd reports for this same weekday and hour |
| Live check-ins | 27% | Anonymous "I'm here now" in the last 75 min, against seating capacity |
| Recent reports | 15% | Visitor reports in the last 2 hours, weighted toward the newest |

Plus small context adjustments (rain thins walk-ins, weekend dinners run
busier). Score 0–100 → 🟢 Low (<35) / 🟡 Moderate (<68) / 🔴 High, and a wait
band scaled by the venue's own service speed.

Confidence (low/medium/high) is derived from sample volume and shown in the UI,
so a venue with two reports never looks as certain as one with two hundred.
`GET /api/crowd/methodology` documents all of this in-product.

**Privacy:** check-ins store no identity, expire automatically via a TTL index,
and are rate-limited so one device cannot fake a crowd. Precise coordinates are
never persisted — anything stored is snapped to a ~1 km grid.

### Upgrading to ML

The architecture was built for the swap. `server/src/services/crowd/mlClient.js`
posts features to `ML_CROWD_SERVICE_URL` and uses the prediction if it arrives;
on timeout, error, or an unset URL it circuit-breaks for 60 seconds and the rule
engine answers. See [`ml/README.md`](ml/README.md) — export the training table,
train a gradient-boosted regressor, serve it with FastAPI. The trainer refuses
to recommend itself if it doesn't beat the rule-based baseline.

---

## Architecture

```
                              USER (React + Vite + Tailwind)
                                        │
              ┌─────────────────────────┼─────────────────────────┐
              ▼                         ▼                         ▼
        AI chat / wizard        Restaurant search           Location service
              │                         │                  (permission-gated)
              └─────────────────────────┼─────────────────────────┘
                                        ▼
                            Node.js + Express API
                                        │
        ┌───────────────┬───────────────┼───────────────┬────────────────┐
        ▼               ▼               ▼               ▼                ▼
  Intent extraction  Recommendation  Crowd engine   Personalisation   Weather
  (LLM + rule NLU)      engine       (rules → ML)     (feedback)      (optional)
        │               │               │               │                │
        └───────────────┴───────────────┼───────────────┴────────────────┘
                                        ▼
                                     MongoDB
                                        │
                                        ▼
                       AI explanation (grounded in the results)
                                        │
                                        ▼
                          Ranked, explained recommendation
                                        │
                          ┌─────────────┴─────────────┐
                          ▼                           ▼
                     ORDER ONLINE               VISIT RESTAURANT
```

### Project layout

```
server/src/
  domain/constants.js           single source of truth for the vocabulary + weights
  models/                       13 Mongoose models with indexes
  data/                         demo dataset (dish catalogue + restaurants)
  services/
    recommendation/
      context.js                request + saved prefs + weather + time -> scoring context
      matchers.js               one function per factor, each returns score + reason
      engine.js                 hard filters -> weighted score -> place layer -> ranking
    crowd/
      baseline.js               compact profile -> 7x24 baseline matrix
      crowdEngine.js            four-signal blend, wait bands, confidence
      aggregate.js              raw reports -> historical snapshots
      mlClient.js               optional ML service with circuit breaker
    ai/
      client.js                 SDK wrapper — every call has a fallback
      ruleNlu.js                deterministic parser (the no-API-key path)
      intent.js                 forced tool-use extraction + local re-validation
      explain.js                factor breakdown -> sentence (LLM or template)
      chat.js                   the full grounded pipeline
    personalization.js          load taste profile · apply feedback · reinforce
    weather/weatherService.js   Open-Meteo / OpenWeather / off
  api/                          controllers, routes, serializers
  scripts/                      seed · export crowd dataset

client/src/
  context/                      Auth · Location · Cart · Toast
  components/                   RecommendationCard · WhyPanel · CrowdBadge/Panel
                                CrowdChart · MapView · MatchRing · CrowdDialogs …
  pages/                        Dashboard · Decide · AskAI · NearMe · Search
                                RestaurantDetail · Cart · Checkout · Orders · Profile

ml/                             optional Python crowd model (train + FastAPI serve)
```

### Scoring weights

Dish score (sums to 100%), then blended into a place score:

| Dish factor | Weight | | Place factor | Weight |
|---|---|---|---|---|
| Hunger | 20% | | Dish match | 55% |
| Mood | 15% | | Crowd | 18% |
| Budget | 15% | | Distance | 15% |
| Dietary preference | 15% | | Rating | 12% |
| Nutrition | 10% | | | |
| Spice | 10% | | | |
| Your past choices | 10% | | | |
| Distance & time | 5% | | | |

Bounded bonuses/penalties are applied on top and shown separately: explicit
craving (+12), cuisine preference (+6), meal timing (+5), weather fit (±8),
well-rated (+4), course fit (−20 for a drink when you asked for a meal),
recently eaten (−35 within the history factor), disliked restaurant (−20).

Hard filters run **before** scoring: diet compatibility, allergens, avoided
ingredients, availability, disliked dishes, and a hard budget ceiling at
1.35× (so a ₹210 biryani still surfaces on a ₹200 budget, flagged as over).

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | React 18 + Vite + Tailwind + React Router | Fast HMR, no CSS bikeshedding, responsive by default |
| Map | Leaflet + OpenStreetMap tiles | Documented, public, no key, nothing scraped |
| Backend | Node.js + Express (ESM) | Straightforward, matches the recommended stack |
| Database | MongoDB + Mongoose | Geospatial queries, flexible menu documents |
| AI | Anthropic Claude (`claude-opus-5`) | Structured extraction via forced tool use, grounded explanations |
| ML (optional) | Python + scikit-learn + FastAPI | Right tool for small tabular regression |
| Auth | JWT + bcrypt | Stateless, standard |

---

## Database design

| Collection | Purpose | Key indexes |
|---|---|---|
| `users` | Accounts, addresses (coarse coords only) | `email` unique |
| `restaurants` | Venues, hours, capacity, baseline crowd curve | `2dsphere` on location; cuisine+price+rating; text |
| `fooditems` | Menus with nutrition estimates, tags, mood tags, allergens | restaurant+available; diet+price; cuisine+spice; text |
| `userpreferences` | Explicit settings **and** learned affinities | `user` unique |
| `orders` | Orders with denormalised line items and status history | user+createdAt |
| `favorites` / `ratings` | Saved and scored items | compound unique per user+target |
| `reviews` | Restaurant reviews | restaurant+createdAt |
| `checkins` | Anonymous "I'm here", **TTL-expiring** | restaurant+createdAt; restaurant+day+hour |
| `crowdreports` | Visitor crowd feedback — the ground truth | restaurant+day+hour |
| `crowdsnapshots` | Rolled-up (restaurant, day, hour) history — also the ML training table | unique compound |
| `recommendationhistory` | Every recommendation with its context and factor breakdown | user+createdAt |
| `feedback` | Rejections, reasons, and the adjustments applied | user+createdAt |

---

## API reference

| Method | Route | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | — | Status, counts, engine versions |
| GET | `/api/context` | — | Time, location, weather for the context strip |
| POST | `/api/auth/register` · `/login` | — | Accounts |
| GET | `/api/auth/me` | ✔ | Profile + preferences |
| GET | `/api/restaurants/nearby` | optional | 📍 Nearby discovery with crowd |
| GET | `/api/restaurants/:id` | optional | Detail, menu, reviews, AI picks, outlook |
| GET | `/api/restaurants/:id/crowd` · `/crowd/outlook` | — | Current estimate · hour-by-hour |
| POST | `/api/restaurants/:id/checkin` · `/crowd-report` | optional | Crowd signals (rate-limited) |
| GET | `/api/crowd/methodology` | — | How the estimate is built |
| GET | `/api/foods` · `/api/foods/:id` | optional | Search / detail |
| POST | `/api/recommendations/foods` · `/places` · `/alternatives` | optional | Ranked results |
| POST | `/api/recommendations/smart` | optional | Natural-language smart decision |
| GET | `/api/recommendations/weights` | — | The exact scoring weights |
| GET | `/api/recommendations/history` | ✔ | Past recommendations with context |
| POST | `/api/ai/chat` · `/ai/parse` | optional | Assistant · intent extraction |
| GET | `/api/me/dashboard` | optional | Personalised home |
| GET/PUT | `/api/me/preferences` | ✔ | Taste profile |
| POST | `/api/me/preferences/reset-learning` | ✔ | Clear learned signals |
| GET/POST | `/api/me/favorites` · `/ratings` · `/addresses` | ✔ | Account data |
| POST/GET | `/api/orders` · `/api/orders/:id` · `/:id/cancel` | ✔ | Ordering |
| POST/GET | `/api/feedback` | ✔ | "Not for me" + learning |

Errors are uniform: `{ "error": { "message", "status", "details?" } }`.

---

## Real vs. demo data

Clearly separated, in the schema and in the UI.

| Real integration | Demo / mock |
|---|---|
| Anthropic API (when a key is set) | Restaurants and menus (`dataSource: "seed"`) |
| Open-Meteo / OpenWeather | Nutrition values (`nutritionSource: "estimated"`) |
| Browser Geolocation API | 3 weeks of crowd history (`source: "simulated"`) |
| OpenStreetMap tiles + directions | Payments (`payment.isSimulated: true`) |
| MongoDB | Demo user accounts |

Swapping in a partner menu feed means writing `FoodItem`/`Restaurant` documents
with a different `dataSource` — nothing else in the system changes, because
everything reads from the database.

---

## Safety, accuracy and privacy

These are enforced in code, not just intentions:

- **No medical claims.** The LLM prompts forbid saying food cures, treats, fixes
  or heals anything, or that it will change your mood or health. Phrasing is
  "may be a lighter option based on your preferences". Template fallbacks are
  written the same way.
- **Nutrition is labelled as estimated** everywhere it appears, and carries
  `nutritionSource` in the API so a verified feed can be distinguished later.
- **No proprietary crowd data.** Crowd numbers are our own estimates from our
  own signals, stated on every badge, panel, chart and in
  `/api/crowd/methodology`. The prompts forbid claiming otherwise.
- **Location is minimised.** Never requested automatically. Precise coordinates
  are used for the request that needs them and never persisted — stored copies
  are rounded to ~1 km. The browser cache holds only the coarse point, and
  Profile has a "forget my cached location" control.
- **Anonymous crowd signals.** Check-ins carry a salted hash, not an identity,
  expire via TTL, are never returned by a read API, and are rate-limited.
- **Allergies are hard filters**, with an explicit note to confirm with the
  restaurant for severe allergies.
- **No hard-coded secrets.** Everything comes from the environment; both
  `.env.example` files document what's needed and `client/.env.example` warns
  that `VITE_*` values are public.

Additional hardening: Helmet, CORS allow-list, compression, body-size limits,
zod validation on every write, tiered rate limits (general / auth / AI /
crowd-writes), bcrypt hashing, and identical failure messages for wrong email
and wrong password.

---

## Scripts

| Command | Where | What |
|---|---|---|
| `npm install` | root | Installs both workspaces |
| `npm run dev` | root | API + client together |
| `npm run seed` | root | Reset and populate the demo dataset |
| `npm run build` | root | Production client build |
| `npm run start` | root | Production API |
| `npm run export:crowd-dataset -- <path>` | server | CSV training table for the ML model |

---

## Known limitations

Stated plainly rather than papered over:

- The demo dataset is fictional. Restaurants, prices and nutrition are authored
  for this project, not sourced from real businesses.
- Seeded crowd history is synthetic. It is generated from each venue's baseline
  curve plus noise, so a model trained on it mostly re-learns that curve. The
  estimates become genuinely informative once real check-ins accumulate.
- The order lifecycle is time-driven, not kitchen-driven — there is no
  restaurant-facing app behind it.
- Distances are great-circle, not routed, so real travel time will be longer.
- The public OpenStreetMap tile server is rate-limited and not suitable for
  production traffic; swap in your own tile provider via `VITE_MAP_TILE_URL`.
- There is no automated test suite yet. The recommendation matchers and crowd
  engine are written as pure functions specifically so they are easy to test.
