"""Service settings, read from the environment and ``insights/.env``.

A tiny ``.env`` reader is used instead of a dependency: lines are ``KEY=value``, ``#``
starts a comment, and variables already set in the environment win.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path

ENV_FILE = Path(__file__).resolve().parent.parent / ".env"
DEFAULT_PORT = 17495
# Chrome extension IDs are 32 characters in the range a-p.
_EXTENSION_ORIGIN = re.compile(r"^chrome-extension://[a-p]{32}$")


def load_env_file(path: Path = ENV_FILE) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


@dataclass(frozen=True)
class Settings:
    database_url: str
    allowed_origins: frozenset[str]
    port: int = DEFAULT_PORT

    @classmethod
    def from_env(cls) -> "Settings":
        load_env_file()
        database_url = os.environ.get("POLYBOT_DATABASE_URL", "")
        if not database_url:
            raise ValueError("Set POLYBOT_DATABASE_URL in insights/.env.")
        origins = frozenset(o.strip() for o in os.environ.get("POLYBOT_ALLOWED_ORIGINS", "").split(",") if o.strip())
        bad = sorted(o for o in origins if not _EXTENSION_ORIGIN.match(o))
        if bad:
            raise ValueError(f"POLYBOT_ALLOWED_ORIGINS must list exact chrome-extension://<id> origins; got {bad}.")
        return cls(database_url, origins, int(os.environ.get("POLYBOT_INSIGHTS_PORT", DEFAULT_PORT)))
