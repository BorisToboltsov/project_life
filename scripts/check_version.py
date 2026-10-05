"""Гейт версии: манифесты бэкенда и фронтенда и CHANGELOG обязаны называть одну версию."""

import json
import re
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).parent.parent


def main() -> int:
    backend = tomllib.loads((ROOT / "backend/pyproject.toml").read_text())["project"]["version"]
    frontend = json.loads((ROOT / "frontend/package.json").read_text())["version"]
    changelog = (ROOT / "CHANGELOG.md").read_text()

    errors: list[str] = []
    if backend != frontend:
        errors.append(f"версии расходятся: бэкенд {backend}, фронтенд {frontend}")
    if not re.fullmatch(r"\d+\.\d+\.\d+", backend):
        errors.append(f"версия {backend} не в формате <major>.<фаза>.<фикс>")
    if not re.search(rf"^## {re.escape(backend)}\b", changelog, re.MULTILINE):
        errors.append(f"в CHANGELOG.md нет раздела «## {backend}»")

    for error in errors:
        print(f"check_version: {error}", file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
