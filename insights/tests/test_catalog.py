"""Catalog sync (ADR-015): extension content lands in core.* and matches the taxonomy."""

from __future__ import annotations

import copy
import shutil

import pytest

from polybot_insights.catalog import CatalogError, export_catalog, load_catalog

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="Node is needed to export the catalog")


@pytest.fixture(scope="module")
def catalog():
    return export_catalog()


def test_every_grammar_topic_has_a_seeded_skill(conn, catalog):
    known = {row[0] for row in conn.execute("SELECT skill_id FROM core.skills WHERE parent_skill_id = 'grammar'")}
    assert set(catalog["grammar_skill_ids"]) == known


def test_catalog_loads_and_reloading_changes_nothing(conn, catalog):
    first = load_catalog(conn, catalog)
    count = lambda table: conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
    before = {t: count(t) for t in ("core.languages", "core.courses", "core.topics", "core.lessons", "core.vocabulary_items")}
    assert before["core.lessons"] == first["lessons"]
    assert before["core.languages"] == first["languages"]
    load_catalog(conn, catalog)
    assert {t: count(t) for t in before} == before


def test_loaded_rows_carry_skill_and_difficulty(conn, catalog):
    load_catalog(conn, catalog)
    row = conn.execute("SELECT lesson_type, primary_skill_id, cefr_level, difficulty_band, course_id "
                       "FROM core.lessons WHERE lesson_id = 'grammar:fr:A2:past-events'").fetchone()
    assert row == ("grammar_topic", "grammar.past-events", "A2", 2, "path:fr")
    assert conn.execute("SELECT difficulty_band FROM core.vocabulary_items WHERE vocab_item_id = 'es:que'").fetchone() == (1,)
    assert conn.execute("SELECT is_rtl FROM core.languages WHERE language_code = 'ar'").fetchone() == (True,)
    assert conn.execute("SELECT 1 FROM core.languages WHERE language_code = 'zh-CN'").fetchone() == (1,)


def test_unknown_skill_stops_the_load_before_any_write(conn, catalog):
    broken = copy.deepcopy(catalog)
    broken["grammar_skill_ids"].append("grammar.new-topic")
    with pytest.raises(CatalogError, match="grammar.new-topic"):
        load_catalog(conn, broken)
    assert conn.execute("SELECT count(*) FROM core.lessons").fetchone() == (0,)
