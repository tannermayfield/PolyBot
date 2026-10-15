"""Apply numbered SQL migrations to PostgreSQL.

    python -m polybot_insights.db.migrate                 # uses POLYBOT_DATABASE_URL
    python -m polybot_insights.db.migrate --database-url postgresql://...

Each ``NNN_name.sql`` file runs once, in filename order, inside its own transaction.
Applied files are recorded in ``ops.schema_migrations`` with a SHA-256 checksum, so
editing a migration that already ran is reported as an error instead of being skipped
silently. Schema changes always go in a new numbered file.
"""

from __future__ import annotations

import argparse
import hashlib
import logging
import os
import sys
from dataclasses import dataclass
from pathlib import Path

import psycopg

from polybot_insights.config import load_env_file

log =logging.getLogger("polybot_insights.migrate")

MIGRATIONS_DIR = Path(__file__).with_name("migrations")

_BOOTSTRAP = """
CREATE SCHEMA IF NOT EXISTS ops;
CREATE TABLE IF NOT EXISTS ops.schema_migrations (
  filename    text        PRIMARY KEY,
  checksum    text        NOT NULL,
  applied_at  timestamptz NOT NULL DEFAULT now()
);
"""


class MigrationError(RuntimeError):
    """A migration could not be applied safely."""


@dataclass(frozen=True)
class Migration:
    filename: str
    sql: str

    @property
    def checksum(self) -> str:
        return hashlib.sha256(self.sql.encode("utf-8")).hexdigest()


def discover(directory: Path = MIGRATIONS_DIR) -> list[Migration]:
    """Return migrations found in ``directory``, ordered by filename."""
    files = sorted(directory.glob("[0-9][0-9][0-9]_*.sql"))
    return [Migration(path.name, path.read_text(encoding="utf-8")) for path in files]


def apply_migrations(conn: psycopg.Connection, migrations: list[Migration] | None = None) -> list[str]:
    """Apply pending migrations and return the filenames that were applied.

    ``conn`` must be in autocommit mode so each ``conn.transaction()`` block is a real
    BEGIN/COMMIT rather than a savepoint inside an implicit outer transaction.
    """
    if not conn.autocommit:
        raise MigrationError("apply_migrations needs an autocommit connection.")
    migrations = discover() if migrations is None else migrations

    with conn.transaction():
        conn.execute(_BOOTSTRAP)
    applied = dict(conn.execute("SELECT filename, checksum FROM ops.schema_migrations").fetchall())

    newly_applied: list[str] = []
    for migration in migrations:
        recorded = applied.get(migration.filename)
        if recorded is not None:
            if recorded != migration.checksum:
                raise MigrationError(
                    f"{migration.filename} changed after it was applied. "
                    "Put the change in a new numbered migration instead."
                )
            continue
        with conn.transaction():
            conn.execute(migration.sql)  # no parameters, so multiple statements are allowed
            conn.execute(
                "INSERT INTO ops.schema_migrations (filename, checksum) VALUES (%s, %s)",
                (migration.filename, migration.checksum),
            )
        log.info("operation=migrate status=applied migration=%s", migration.filename)
        newly_applied.append(migration.filename)
    return newly_applied


def main(argv: list[str] | None = None) -> int:
    load_env_file()
    parser = argparse.ArgumentParser(description="Apply Polybot Insights database migrations.")
    parser.add_argument("--database-url", default=os.environ.get("POLYBOT_DATABASE_URL"),
                        help="PostgreSQL URL (default: $POLYBOT_DATABASE_URL)")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    if not args.database_url:
        parser.error("set POLYBOT_DATABASE_URL or pass --database-url")
    try:
        with psycopg.connect(args.database_url, autocommit=True) as conn:
            applied = apply_migrations(conn)
    except (psycopg.Error, MigrationError) as error:
        log.error("operation=migrate status=failed error=%s", error)
        return 1
    log.info("operation=migrate status=succeeded applied=%d", len(applied))
    return 0


if __name__ == "__main__":
    sys.exit(main())
