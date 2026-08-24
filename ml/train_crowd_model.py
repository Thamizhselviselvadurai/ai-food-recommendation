"""
Train the restaurant crowd-prediction model.

    python train_crowd_model.py --data data/crowd_training.csv --out crowd_model.joblib

The training table comes from the Node API:

    npm run export:crowd-dataset -- ../ml/data/crowd_training.csv

One row per (restaurant, day-of-week, hour) with the venue's own features and
`avg_score` (0-100) as the label. The label is built from this app's own
check-ins and visitor crowd reports — no external popularity data is involved.

The model is a gradient-boosted regressor: small tabular dataset, non-linear
day/hour interactions, no GPU, trains in seconds. It replaces the rule engine
only when `ML_CROWD_SERVICE_URL` is set, and the rule engine remains the
fallback for every venue and hour the model has no confidence in.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

MODEL_VERSION = "crowd-hgb-1.0.0"

NUMERIC_FEATURES = [
    "hour_sin",
    "hour_cos",
    "is_weekend",
    "seating_capacity",
    "avg_service_minutes",
    "popularity_index",
    "baseline_score",
    "check_in_count",
    "report_count",
]
CATEGORICAL_FEATURES = ["day_of_week", "price_category"]
TARGET = "avg_score"


def build_features(frame: pd.DataFrame) -> pd.DataFrame:
    """Hour is cyclical — 23:00 is adjacent to 00:00, not 23 units away."""
    out = frame.copy()
    out["hour_sin"] = np.sin(2 * np.pi * out["hour"] / 24)
    out["hour_cos"] = np.cos(2 * np.pi * out["hour"] / 24)
    out["day_of_week"] = out["day_of_week"].astype(str)
    out["price_category"] = out["price_category"].astype(str)

    for column in NUMERIC_FEATURES:
        if column not in out.columns:
            out[column] = 0.0
    return out


def build_pipeline() -> Pipeline:
    return Pipeline(
        [
            (
                "encode",
                ColumnTransformer(
                    [("cat", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL_FEATURES)],
                    remainder="passthrough",
                ),
            ),
            (
                "model",
                HistGradientBoostingRegressor(
                    max_iter=400,
                    learning_rate=0.06,
                    max_depth=6,
                    min_samples_leaf=8,
                    l2_regularization=0.5,
                    random_state=42,
                ),
            ),
        ]
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Train the crowd prediction model")
    parser.add_argument("--data", default="data/crowd_training.csv")
    parser.add_argument("--out", default="crowd_model.joblib")
    parser.add_argument("--test-size", type=float, default=0.2)
    args = parser.parse_args()

    data_path = Path(args.data)
    if not data_path.exists():
        raise SystemExit(
            f"No dataset at {data_path}.\n"
            "Export it from the API first:\n"
            "  cd ../server && npm run export:crowd-dataset -- ../ml/data/crowd_training.csv"
        )

    frame = pd.read_csv(data_path)
    if len(frame) < 50:
        raise SystemExit(
            f"Only {len(frame)} rows — not enough to train anything meaningful. "
            "Seed the database and collect more crowd reports first."
        )

    frame = build_features(frame)
    features = frame[CATEGORICAL_FEATURES + NUMERIC_FEATURES]
    target = frame[TARGET]

    x_train, x_test, y_train, y_test = train_test_split(
        features, target, test_size=args.test_size, random_state=42
    )

    pipeline = build_pipeline()
    pipeline.fit(x_train, y_train)

    predictions = np.clip(pipeline.predict(x_test), 0, 100)
    mae = mean_absolute_error(y_test, predictions)
    r2 = r2_score(y_test, predictions)

    # A model that cannot beat "always predict the venue's baseline" is not
    # worth serving — say so loudly rather than shipping it silently.
    baseline_mae = mean_absolute_error(y_test, x_test["baseline_score"].clip(0, 100))

    print(f"rows            : {len(frame)}")
    print(f"MAE (model)     : {mae:.2f} crowd points")
    print(f"MAE (baseline)  : {baseline_mae:.2f} crowd points")
    print(f"R^2             : {r2:.3f}")

    if mae >= baseline_mae:
        print("\n  WARNING: the model does not beat the rule-based baseline.")
        print("  Keep ML_CROWD_SERVICE_URL unset until it does.")

    output_path = Path(args.out)
    joblib.dump(
        {
            "pipeline": pipeline,
            "version": MODEL_VERSION,
            "numeric_features": NUMERIC_FEATURES,
            "categorical_features": CATEGORICAL_FEATURES,
            "metrics": {"mae": float(mae), "baseline_mae": float(baseline_mae), "r2": float(r2)},
        },
        output_path,
    )
    print(f"\nSaved -> {output_path.resolve()}")


if __name__ == "__main__":
    main()
