# Crowd prediction service (optional)

The Node API ships a **deterministic rule-based crowd engine** that works out of
the box. This directory is the optional upgrade path: a small Python model that
learns each venue's real pattern from the check-ins and crowd reports the app
collects, and replaces the rule score when it is running.

Nothing here is required. If this service is not running, is slow, or returns
anything unexpected, `server/src/services/crowd/mlClient.js` circuit-breaks for
60 seconds and the rule engine answers instead.

## Why a model at all

The rule engine blends four signals with fixed weights. That is honest and
explainable, but it cannot learn that *this* venue's Tuesday lunch is unusually
quiet while its Saturday dinner overflows. A gradient-boosted regressor over
(day, hour, venue features, recent activity) can.

The architecture was built for this swap from the start: the crowd engine calls
`predictWithMlService()` after computing its own answer and only overrides it if
the service replies.

## Setup

```bash
cd ml
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
```

## 1. Export the training table

From the repo root, with a seeded database:

```bash
cd server
npm run export:crowd-dataset -- ../ml/data/crowd_training.csv
```

One row per `(restaurant, dayOfWeek, hour)` with the venue's features and
`avg_score` (0–100) as the label, computed from this app's own check-ins and
visitor crowd reports.

## 2. Train

```bash
python train_crowd_model.py --data data/crowd_training.csv --out crowd_model.joblib
```

It prints the model's MAE next to the rule-based baseline's MAE. **If the model
does not beat the baseline, do not serve it** — the script warns you.

## 3. Serve

```bash
uvicorn serve:app --port 8000
```

Then in `server/.env`:

```
ML_CROWD_SERVICE_URL=http://localhost:8000
```

Restart the API. `GET /api/health` will now report
`"crowdSource": "ml-service-with-rule-fallback"`, and every crowd estimate the
model answered carries `"source": "ml"` plus an extra entry in its `signals`
array, so the UI can show where the number came from.

## API

| Route | Purpose |
|---|---|
| `GET /health` | Model version and training metrics |
| `POST /predict` | Batch prediction — see the contract in `serve.py` |

## Honest limitations

- With only seeded demo data the model mostly re-learns the baseline curve it
  was generated from. It gets genuinely useful once real check-ins accumulate.
- It predicts a crowd *score*, not occupancy. Nothing here measures how many
  people are actually inside a building.
- It is not, and must not be presented as, live popularity data from any map
  provider.
