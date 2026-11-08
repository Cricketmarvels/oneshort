"""Write the FastAPI OpenAPI schema to ../shared/openapi.json (source of truth for TS types)."""

import json
from pathlib import Path

from app.core.config import Settings
from app.main import create_app


def main() -> None:
    app = create_app(Settings(scheduler_enabled=False))
    out = Path(__file__).resolve().parents[2] / "shared" / "openapi.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(app.openapi(), indent=2))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
