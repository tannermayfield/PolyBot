"""Load the extension's content catalog into ``core`` (ADR-015).

    python -m polybot_insights.catalog                       # runs the Node exporter itself
    python -m polybot_insights.catalog --catalog catalog.json

Every row is upserted inside one transaction, so a failed load changes nothing and a
repeated load is a no-op. Content that disappears from the extension is NOT deleted:
events may still reference it.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import subprocess
import sys
from pathlib import Path

import psycopg

from polybot_insights.config import load_env_file

log = logging.getLogger("polybot_insights.catalog")
REPO_ROOT = Path(__file__).resolve().parents[2]


class CatalogError(RuntimeError):
    """The catalog does not fit the database's taxonomy."""


def export_catalog() -> dict:
    """Run scripts/export-catalog.cjs and return its JSON (needs Node on PATH)."""
    result = subprocess.run(["node", str(REPO_ROOT / "scripts" / "export-catalog.cjs")],
                            capture_output=True, text=True, encoding="utf-8", check=True)
    return json.loads(result.stdout)


def load_catalog(conn: psycopg.Connection, catalog: dict) -> dict[str, int]:
    if catalog.get("schema_version") != 1:
        raise CatalogError(f"Unsupported catalog schema_version {catalog.get('schema_version')!r}.")
    with conn.transaction():
        known = {row[0] for row in conn.execute("SELECT skill_id FROM core.skills")}
        missing = sorted({*catalog["grammar_skill_ids"], *(l["primary_skill_id"] for l in catalog["lessons"])} - known)
        if missing:
            raise CatalogError(f"Skills missing from core.skills (add them in a new migration): {', '.join(missing)}")

        with conn.cursor() as cur:
            cur.executemany(
                """INSERT INTO core.languages (language_code, name, is_rtl) VALUES (%(code)s, %(name)s, %(is_rtl)s)
                   ON CONFLICT (language_code) DO UPDATE SET name = EXCLUDED.name, is_rtl = EXCLUDED.is_rtl""",
                catalog["languages"])
            cur.executemany(
                """INSERT INTO core.courses (course_id, language_code, title)
                   VALUES (%(course_id)s, %(language_code)s, %(title)s)
                   ON CONFLICT (course_id) DO UPDATE SET title = EXCLUDED.title""",
                catalog["courses"])
            cur.executemany(
                """INSERT INTO core.topics (topic_id, category, label) VALUES (%(topic_id)s, %(category)s, %(label)s)
                   ON CONFLICT (topic_id) DO UPDATE SET category = EXCLUDED.category, label = EXCLUDED.label""",
                catalog["topics"])
            cur.executemany(
                """INSERT INTO core.lessons
                     (lesson_id, lesson_type, language_code, course_id, primary_skill_id, cefr_level, difficulty_band)
                   VALUES (%(lesson_id)s, %(lesson_type)s, %(language_code)s, %(course_id)s, %(primary_skill_id)s,
                           %(cefr_level)s, %(difficulty_band)s)
                   ON CONFLICT (lesson_id) DO UPDATE SET
                     lesson_type = EXCLUDED.lesson_type, course_id = EXCLUDED.course_id,
                     primary_skill_id = EXCLUDED.primary_skill_id, cefr_level = EXCLUDED.cefr_level,
                     difficulty_band = EXCLUDED.difficulty_band""",
                catalog["lessons"])
            cur.executemany(
                """INSERT INTO core.vocabulary_items (vocab_item_id, language_code, term, difficulty_band)
                   VALUES (%(vocab_item_id)s, %(language_code)s, %(term)s, %(difficulty_band)s)
                   ON CONFLICT (vocab_item_id) DO UPDATE SET difficulty_band = EXCLUDED.difficulty_band""",
                catalog["vocabulary"])
    counts = {key: len(catalog[key]) for key in ("languages", "courses", "topics", "lessons", "vocabulary")}
    log.info("operation=catalog_load status=succeeded %s", " ".join(f"{k}={v}" for k, v in counts.items()))
    return counts


def main(argv: list[str] | None = None) -> int:
    load_env_file()
    parser = argparse.ArgumentParser(description="Load the extension content catalog into the insights database.")
    parser.add_argument("--catalog", type=Path, help="JSON from scripts/export-catalog.cjs (default: run the exporter)")
    parser.add_argument("--database-url", default=os.environ.get("POLYBOT_DATABASE_URL"))
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    if not args.database_url:
        parser.error("set POLYBOT_DATABASE_URL or pass --database-url")
    try:
        catalog = json.loads(args.catalog.read_text(encoding="utf-8")) if args.catalog else export_catalog()
        with psycopg.connect(args.database_url, autocommit=True) as conn:
            load_catalog(conn, catalog)
    except (OSError, subprocess.CalledProcessError, json.JSONDecodeError, psycopg.Error, CatalogError) as error:
        log.error("operation=catalog_load status=failed error=%s", error)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
