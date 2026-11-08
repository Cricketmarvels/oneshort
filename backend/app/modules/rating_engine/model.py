"""Extension point for a future trained performance model (CatBoost / LightGBM + SHAP).

Phase 2 only: once enough verified, time-ordered match history exists, a model can be trained
with temporal validation (train on earlier seasons, validate on later ones) to predict batting
and bowling performance and match outcomes. Until then the rating engine runs entirely on
Glicko-2 and the deterministic scores in ``performance.py``; nothing here is consulted for
official ratings, and no untrained or synthetic-data model is ever loaded.
"""

from typing import Any, Protocol


class PerformanceModel(Protocol):
    name: str
    trained: bool

    def predict(self, features: dict[str, Any]) -> dict[str, float] | None: ...

    def explain(self, features: dict[str, Any]) -> dict[str, float] | None:
        """Per-feature contributions (e.g. SHAP values) for the last prediction."""


class NoModel:
    name = "none"
    trained = False

    def predict(self, features: dict[str, Any]) -> dict[str, float] | None:
        return None

    def explain(self, features: dict[str, Any]) -> dict[str, float] | None:
        return None


def build_performance_model(kind: str = "none") -> PerformanceModel:
    if kind != "none":
        raise ValueError(f"Performance model '{kind}' is not available; train and register one first")
    return NoModel()
