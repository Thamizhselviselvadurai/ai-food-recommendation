"""
Crowd prediction service (optional).

    uvicorn serve:app --port 8000

Point the Node API at it with ML_CROWD_SERVICE_URL=http://localhost:8000 and the
crowd engine will use these predictions instead of its rule-based score. If this
service is down, slow, or returns anything unexpected, the Node side silently
falls back to the rule engine — the app never breaks because of it.

Contract (must match server/src/services/crowd/mlClient.js):

    POST /predict
    { "items": [ { "restaurantId": "...", "dayOfWeek": 5, "hour": 20, ... } ] }
 -> { "predictions": [ { "restaurantId": "...", "score": 78.2, "level": "high",
                         "waitMinutes": {"min": 25, "max": 35, "label": "25-35 min"},
                         "modelVersion": "crowd-hgb-1.0.0" } ] }
"""

from __future__ import annotations

from pathlib import Path
from typing import List, Optional

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI
from pydantic import BaseModel, Field

from train_crowd_model import CATEGORICAL_FEATURES, NUMERIC_FEATURES, build_features

MODEL_PATH = Path(__file__).parent / "crowd_model.joblib"

app = FastAPI(title="Food AI — crowd prediction", version="1.0.0")

_bundle = None


def get_model():
    global _bundle
    if _bundle is None:
        if not MODEL_PATH.exists():
            raise FileNotFoundError(
                f"{MODEL_PATH.name} not found. Train it first: python train_crowd_model.py"
            )
        _bundle = joblib.load(MODEL_PATH)
    return _bundle


class PredictItem(BaseModel):
    restaurantId: str
    dayOfWeek: int = Field(ge=0, le=6)
    hour: int = Field(ge=0, le=23)
    isWeekend: int = 0
    seatingCapacity: float = 40
    avgServiceMinutes: float = 12
    popularityIndex: float = 0.5
    baselineScore: float = 30
    recentCheckIns: float = 0
    recentReports: float = 0
    historicalAvg: Optional[float] = None
    priceCategory: str = "medium"


class PredictRequest(BaseModel):
    items: List[PredictItem]


def level_from_score(score: float) -> str:
    if score < 35:
        return "low"
    if score < 68:
        return "moderate"
    return "high"


def wait_range(score: float, service_minutes: float) -> dict:
    """Mirrors the Node rule engine so both sources produce comparable waits."""
    throughput = min(max(service_minutes / 12, 0.55), 1.9)
    load = min(max(score / 100, 0.0), 1.0)
    centre = 3 + (load**1.9) * 42 * throughput
    low = max(0, round(centre * 0.7 / 5) * 5)
    high = max(low + 5, round(centre * 1.35 / 5) * 5)
    return {
        "min": int(low),
        "max": int(high),
        "label": f"Under {high} min" if low == 0 else f"{low}–{high} min",
    }


@app.get("/health")
def health():
    try:
        bundle = get_model()
        return {"status": "ok", "modelVersion": bundle["version"], "metrics": bundle["metrics"]}
    except FileNotFoundError as error:
        return {"status": "no_model", "detail": str(error)}


@app.post("/predict")
def predict(request: PredictRequest):
    if not request.items:
        return {"predictions": []}

    try:
        bundle = get_model()
    except FileNotFoundError:
        # No trained model: return nothing so the caller keeps its rule-based
        # estimate. An empty list is a valid, well-behaved response.
        return {"predictions": []}

    frame = pd.DataFrame(
        [
            {
                "day_of_week": item.dayOfWeek,
                "hour": item.hour,
                "is_weekend": item.isWeekend,
                "seating_capacity": item.seatingCapacity,
                "avg_service_minutes": item.avgServiceMinutes,
                "popularity_index": item.popularityIndex,
                "baseline_score": item.baselineScore,
                "check_in_count": item.recentCheckIns,
                "report_count": item.recentReports,
                "price_category": item.priceCategory,
            }
            for item in request.items
        ]
    )

    features = build_features(frame)[CATEGORICAL_FEATURES + NUMERIC_FEATURES]
    scores = np.clip(bundle["pipeline"].predict(features), 0, 100)

    predictions = []
    for item, score in zip(request.items, scores):
        score = float(score)
        predictions.append(
            {
                "restaurantId": item.restaurantId,
                "score": round(score, 1),
                "level": level_from_score(score),
                "waitMinutes": wait_range(score, item.avgServiceMinutes),
                "modelVersion": bundle["version"],
            }
        )

    return {"predictions": predictions}
