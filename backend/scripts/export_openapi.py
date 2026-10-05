"""Печатает схему OpenAPI в stdout — из неё генерируется TS-клиент фронтенда."""

import json
import sys

from app.main import app

json.dump(app.openapi(), sys.stdout, ensure_ascii=False, indent=2, sort_keys=True)
sys.stdout.write("\n")
