"""Analytics-ready exports for Tableau (CSV) and Excel (workbook) — spec §28–29.

    python -m polybot_insights.exports                     # writes insights/exports/

Privacy (ADR-002, EVENT_TAXONOMY §6): learner IDs are replaced by ``learner_key`` =
HMAC-SHA256(POLYBOT_EXPORT_SALT, learner_id), truncated to 16 hex characters. Without the
salt the keys cannot be linked back to a learner, and the salt never leaves ``insights/.env``.
No vocabulary term, lesson text, or learner-owned content ID is exported: everything is
aggregated to skill, exercise type, difficulty band or catalog lesson. Every learner row
carries ``is_simulated`` so simulated learners can never be mistaken for real ones (ADR-003).

Files (all UTF-8 with header row):
  polybot_analytics.csv          main Tableau source: learner × language × skill × day
  engagement_weekly.csv          learner × week sessions, minutes, events
  content_performance.csv        catalog lessons and exercise types
  personalization_outcomes.csv   decisions and recommendation outcomes per rule
  polybot_analytics.xlsx         the six tabs of spec §29, each an Excel Table
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import hmac
import logging
import os
import sys
import time
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

import psycopg

from polybot_insights import __version__
from polybot_insights.config import load_env_file

log = logging.getLogger("polybot_insights.exports")
PIPELINE_NAME = "exports"
DEFAULT_DIR = Path(__file__).resolve().parents[2] / "exports"


class ExportError(RuntimeError):
    pass


@dataclass(frozen=True)
class Dataset:
    name: str          # file stem and sheet name
    sheet: str
    description: str
    sql: str
    learner_column: str | None = "learner_id"  # replaced by learner_key


DATASETS = [
    Dataset("polybot_analytics", "Raw Analytics Data",
            "One row per learner, language, skill and day: the model's history (main Tableau source).",
            """SELECT s.learner_id, l.is_synthetic AS is_simulated, s.language_code AS language, s.as_of_date AS date,
                      s.skill_id AS skill, coalesce(k.parent_skill_id, s.skill_id) AS skill_group,
                      s.mastery_score, s.accuracy_recent, s.accuracy_lifetime, s.attempt_count, s.self_report_count,
                      s.trend_per_week, s.confidence, analytics.confidence_label(s.confidence) AS confidence_label,
                      p.proficiency_estimate, p.proficiency_band, p.retention_score, p.consistency_score,
                      p.days_since_last_practice, p.total_practice_minutes,
                      sp.sessions_count AS sessions_28d, sp.median_session_minutes, sp.hint_rate, sp.completion_rate
               FROM analytics.skill_scores s
               JOIN core.learners l USING (learner_id)
               JOIN core.skills k USING (skill_id)
               LEFT JOIN analytics.learner_profiles p
                 ON p.learner_id = s.learner_id AND p.language_code = s.language_code AND p.as_of_date = s.as_of_date
               LEFT JOIN analytics.study_patterns sp ON sp.learner_id = s.learner_id AND sp.as_of_date = s.as_of_date
               ORDER BY s.learner_id, s.language_code, s.skill_id, s.as_of_date"""),
    Dataset("skill_performance", "Skill Performance",
            "Latest score per learner, language and skill.",
            """SELECT v.learner_id, l.is_synthetic AS is_simulated, v.language_code AS language, v.skill_id AS skill,
                      v.skill_name, v.parent_skill_id AS skill_group, v.as_of_date, v.mastery_score, v.accuracy_recent,
                      v.attempt_count, v.self_report_count, v.trend_per_week, v.confidence, v.confidence_label
               FROM analytics.vw_user_skill_performance v JOIN core.learners l USING (learner_id)
               ORDER BY v.learner_id, v.language_code, v.skill_id"""),
    Dataset("engagement_weekly", "Engagement",
            "Sessions, active days, practice minutes and events per learner and week.",
            """SELECT s.learner_id, l.is_synthetic AS is_simulated, date_trunc('week', s.started_at)::date AS week_start,
                      count(*) AS sessions, count(DISTINCT s.started_at::date) AS active_days,
                      round(sum(s.active_seconds) / 60.0, 1) AS practice_minutes, sum(s.event_count) AS events
               FROM core.sessions s JOIN core.learners l USING (learner_id)
               GROUP BY 1, 2, 3 ORDER BY 1, 3"""),
    Dataset("content_performance", "Content Performance",
            "Catalog lessons (starts, completions) and exercise types by difficulty (attempts, first-try accuracy). "
            "Learner-owned content and vocabulary terms are excluded.",
            """SELECT 'lesson' AS content_kind, ls.lesson_type AS content_type, ls.lesson_id AS content_id,
                      ls.language_code AS language, ls.primary_skill_id AS skill, ls.cefr_level, ls.difficulty_band,
                      count(DISTINCT e.learner_id) FILTER (WHERE e.event_type = 'lesson_started') AS learners,
                      count(*) FILTER (WHERE e.event_type = 'lesson_started') AS starts,
                      count(*) FILTER (WHERE e.event_type = 'lesson_completed') AS completions,
                      round(count(*) FILTER (WHERE e.event_type = 'lesson_completed')::numeric
                            / nullif(count(*) FILTER (WHERE e.event_type = 'lesson_started'), 0), 3) AS completion_rate,
                      NULL::bigint AS attempts, NULL::numeric AS first_try_accuracy, NULL::integer AS avg_response_ms,
                      bool_or(l.is_synthetic) AS includes_simulated
               FROM core.learner_events e JOIN core.lessons ls USING (lesson_id) JOIN core.learners l USING (learner_id)
               WHERE ls.owner_learner_id IS NULL AND e.event_type IN ('lesson_started', 'lesson_completed')
               GROUP BY 1, 2, 3, 4, 5, 6, 7
               UNION ALL
               SELECT 'exercise_type', x.exercise_type, x.exercise_type || ':band-' || coalesce(a.difficulty_band::text, 'unknown'),
                      a.language_code, a.skill_id, NULL, a.difficulty_band,
                      count(DISTINCT a.learner_id), NULL, NULL, NULL,
                      count(*), round(avg(a.is_correct::int), 3), round(avg(least(a.response_time_ms, 600000)))::int,
                      bool_or(l.is_synthetic)
               FROM core.attempts a JOIN core.exercises x USING (exercise_id) JOIN core.learners l USING (learner_id)
               WHERE a.is_graded AND a.attempt_number = 1
               GROUP BY 1, 2, 3, 4, 5, 6, 7
               ORDER BY 1, 4, 5, 3""", learner_column=None),
    Dataset("personalization_outcomes", "Personalization Outcomes",
            "Per rule: decisions made, still active, overridden by learners, and recommendation acceptance.",
            """SELECT d.rule_id, d.decision_type, count(*) AS decisions,
                      count(*) FILTER (WHERE d.status = 'active') AS active,
                      count(*) FILTER (WHERE d.status = 'overridden_by_learner') AS overridden_by_learner,
                      count(DISTINCT d.learner_id) AS learners, round(avg(d.confidence), 3) AS avg_confidence,
                      coalesce(sum(r.recommendations), 0) AS recommendations, coalesce(sum(r.shown), 0) AS shown,
                      coalesce(sum(r.accepted), 0) AS accepted, coalesce(sum(r.skipped), 0) AS skipped,
                      round(coalesce(sum(r.accepted), 0)::numeric / nullif(sum(r.shown), 0), 3) AS acceptance_rate,
                      bool_or(l.is_synthetic) AS includes_simulated
               FROM personalization.decisions d JOIN core.learners l USING (learner_id)
               LEFT JOIN (SELECT decision_id, count(*) AS recommendations,
                                 count(*) FILTER (WHERE first_shown_at IS NOT NULL) AS shown,
                                 count(*) FILTER (WHERE outcome = 'accepted') AS accepted,
                                 count(*) FILTER (WHERE outcome = 'skipped') AS skipped
                          FROM personalization.recommendations GROUP BY 1) r USING (decision_id)
               GROUP BY 1, 2 ORDER BY 2, 1""", learner_column=None),
]

SUMMARY_SQL = """
SELECT
  (SELECT count(*) FROM core.learners) AS learners,
  (SELECT count(*) FROM core.learners WHERE is_synthetic) AS simulated_learners,
  (SELECT count(*) FROM core.learner_events) AS events,
  (SELECT count(*) FROM core.sessions) AS sessions,
  (SELECT round(sum(active_seconds) / 3600.0, 1) FROM core.sessions) AS practice_hours,
  (SELECT count(*) FROM core.attempts WHERE is_graded AND attempt_number = 1) AS graded_first_tries,
  (SELECT round(avg(is_correct::int), 3) FROM core.attempts WHERE is_graded AND attempt_number = 1) AS first_try_accuracy,
  (SELECT round(avg(mastery_score), 3) FROM analytics.vw_user_skill_performance WHERE mastery_score IS NOT NULL) AS avg_mastery,
  (SELECT count(*) FROM personalization.decisions WHERE status = 'active') AS active_decisions,
  (SELECT round(sum(rows_invalid)::numeric / nullif(sum(rows_processed), 0), 4)
     FROM ops.pipeline_runs WHERE pipeline_name = 'events') AS quarantined_share,
  (SELECT max(as_of_date) FROM analytics.skill_scores) AS model_as_of
"""


def learner_key(salt: bytes, learner_id: Any) -> str:
    return hmac.new(salt, str(learner_id).encode(), hashlib.sha256).hexdigest()[:16]


def _cell(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    return value


def fetch(conn: psycopg.Connection, dataset: Dataset, salt: bytes) -> tuple[list[str], list[list[Any]]]:
    cur = conn.execute(dataset.sql)
    columns = [c.name for c in cur.description]
    rows = [[_cell(v) for v in row] for row in cur.fetchall()]
    if dataset.learner_column:
        i = columns.index(dataset.learner_column)
        columns[i] = "learner_key"
        for row in rows:
            row[i] = learner_key(salt, row[i])
    return columns, rows


def write_csv(path: Path, columns: list[str], rows: list[list[Any]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(columns)
        for row in rows:
            writer.writerow(["" if v is None else v.isoformat() if isinstance(v, (date, datetime)) else v for v in row])


def write_workbook(path: Path, summary: dict, tables: dict[str, tuple[Dataset, list[str], list[list[Any]]]]) -> None:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter
    from openpyxl.worksheet.table import Table, TableStyleInfo

    wb = Workbook()
    ws = wb.active
    ws.title = "Summary"
    title = Font(size=16, bold=True)
    ws["A1"] = "Polybot Learning Intelligence — summary"
    ws["A1"].font = title
    ws["A2"] = f"Generated {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC · model as of {summary['model_as_of'] or '—'} · polybot-insights {__version__}"
    if summary["simulated_learners"]:
        ws["A3"] = (f"Contains {summary['simulated_learners']} simulated learner(s) out of {summary['learners']}. "
                    "Results from simulated learners must be reported as simulated.")
        ws["A3"].font = Font(bold=True, color="9C2C00")
    labels = [("Learners", "learners"), ("Simulated learners", "simulated_learners"), ("Events loaded", "events"),
              ("Sessions", "sessions"), ("Practice hours", "practice_hours"), ("Graded first tries", "graded_first_tries"),
              ("First-try accuracy", "first_try_accuracy"), ("Average skill mastery", "avg_mastery"),
              ("Active personalization decisions", "active_decisions"), ("Share of events quarantined", "quarantined_share")]
    ws["A5"], ws["B5"] = "Metric", "Value"
    for c in ("A5", "B5"):
        ws[c].font = Font(bold=True)
    for i, (label, key) in enumerate(labels, start=6):
        ws.cell(i, 1, label)
        cell = ws.cell(i, 2, _cell(summary[key]))
        if key in ("first_try_accuracy", "avg_mastery", "quarantined_share"):
            cell.number_format = "0.0%"
    row = 6 + len(labels) + 1
    ws.cell(row, 1, "Live formulas (they recalculate if you filter or edit the tables)").font = Font(bold=True)
    formulas = [("Rows in Raw Analytics Data", "=ROWS(RawAnalyticsData[learner_key])"),
                ("Average mastery in Skill Performance", "=AVERAGE(SkillPerformance[mastery_score])"),
                ("Recommendations accepted", "=SUM(PersonalizationOutcomes[accepted])"),
                ("Acceptance rate (accepted / shown)", "=IFERROR(SUM(PersonalizationOutcomes[accepted])/SUM(PersonalizationOutcomes[shown]),\"—\")")]
    for j, (label, formula) in enumerate(formulas, start=row + 1):
        ws.cell(j, 1, label)
        ws.cell(j, 2, formula).number_format = "0.0%" if "rate" in label.lower() or "mastery" in label.lower() else "General"
    notes = row + len(formulas) + 2
    ws.cell(notes, 1, "About this workbook").font = Font(bold=True)
    lines = ["Each tab is an Excel Table: use Insert → PivotTable, slicers or filters directly.",
             "learner_key is an anonymous key (HMAC-SHA256 with a private salt); it cannot be turned back into a learner ID.",
             "No vocabulary terms or learner-written text are included. Definitions: docs/LEARNER_MODEL.md, docs/BI_EXPORTS.md."]
    for k, line in enumerate(lines, start=notes + 1):
        ws.cell(k, 1, line)
    ws.column_dimensions["A"].width = 46
    ws.column_dimensions["B"].width = 18

    order = ["skill_performance", "content_performance", "engagement_weekly", "personalization_outcomes", "polybot_analytics"]
    header_fill = PatternFill("solid", fgColor="EFEBF9")
    for name in order:
        dataset, columns, rows = tables[name]
        sheet = wb.create_sheet(dataset.sheet)
        sheet.append(columns)
        for r in rows:
            sheet.append(r)
        for c in sheet[1]:
            c.font, c.fill, c.alignment = Font(bold=True), header_fill, Alignment(wrap_text=True, vertical="top")
        sheet.freeze_panes = "A2"
        for idx, col in enumerate(columns, start=1):
            letter = get_column_letter(idx)
            sheet.column_dimensions[letter].width = max(10, min(32, len(col) + 2))
            if any(w in col for w in ("rate", "accuracy", "mastery", "confidence", "score", "share", "estimate")) and col != "confidence_label":
                for cell in sheet[letter][1:]:
                    cell.number_format = "0.0%"
        if rows:
            ref = f"A1:{get_column_letter(len(columns))}{len(rows) + 1}"
            table = Table(displayName=dataset.sheet.replace(" ", ""), ref=ref)
            table.tableStyleInfo = TableStyleInfo(name="TableStyleMedium2", showRowStripes=True)
            sheet.add_table(table)
    wb.save(path)


def build_exports(conn: psycopg.Connection, out_dir: Path, salt: str, trigger_source: str = "cli") -> dict:
    if not salt or salt.startswith("REPLACE_WITH") or len(salt) < 16:
        raise ExportError("Set POLYBOT_EXPORT_SALT in insights/.env to a long random string (see .env.example).")
    if not conn.autocommit:
        raise ValueError("build_exports needs an autocommit connection.")
    started = time.monotonic()
    run_id = conn.execute(
        "INSERT INTO ops.pipeline_runs (pipeline_name, trigger_source, code_version) VALUES (%s, %s, %s) RETURNING run_id",
        (PIPELINE_NAME, trigger_source, __version__)).fetchone()[0]
    status, error, files, rows_total = "succeeded", None, [], 0
    try:
        out_dir.mkdir(parents=True, exist_ok=True)
        key = salt.encode()
        tables = {}
        with conn.transaction():  # one snapshot: every file describes the same moment
            conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
            for dataset in DATASETS:
                columns, rows = fetch(conn, dataset, key)
                tables[dataset.name] = (dataset, columns, rows)
            cur = conn.execute(SUMMARY_SQL)
            summary = dict(zip([c.name for c in cur.description], cur.fetchone()))
        for name in ("polybot_analytics", "engagement_weekly", "content_performance", "personalization_outcomes"):
            dataset, columns, rows = tables[name]
            write_csv(out_dir / f"{name}.csv", columns, rows)
            files.append(f"{name}.csv")
            rows_total += len(rows)
        write_workbook(out_dir / "polybot_analytics.xlsx", summary, tables)
        files.append("polybot_analytics.xlsx")
    except Exception as exc:  # noqa: BLE001 - recorded on the run row, then re-raised
        status, error = "failed", f"{type(exc).__name__}: {str(exc)[:300]}"
    conn.execute("""UPDATE ops.pipeline_runs SET status = %s, completed_at = now(), rows_processed = %s, rows_valid = %s,
                      error_summary = %s WHERE run_id = %s""", (status, rows_total, rows_total, error, run_id))
    result = {"run_id": run_id, "status": status, "directory": str(out_dir), "files": files, "rows": rows_total,
              "duration_ms": int((time.monotonic() - started) * 1000), "error_summary": error}
    log.info("operation=exports status=%s run_id=%s files=%d rows=%d duration_ms=%d",
             status, run_id, len(files), rows_total, result["duration_ms"])
    if status == "failed":
        raise ExportError(error)
    return result


def main(argv: list[str] | None = None) -> int:
    load_env_file()
    parser = argparse.ArgumentParser(description="Write Tableau CSVs and an Excel workbook.")
    parser.add_argument("--database-url", default=os.environ.get("POLYBOT_DATABASE_URL"))
    parser.add_argument("--out", type=Path, default=DEFAULT_DIR, help=f"output folder (default {DEFAULT_DIR})")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    if not args.database_url:
        parser.error("set POLYBOT_DATABASE_URL or pass --database-url")
    try:
        with psycopg.connect(args.database_url, autocommit=True) as conn:
            print(build_exports(conn, args.out, os.environ.get("POLYBOT_EXPORT_SALT", "")))
    except ExportError as error:
        log.error("operation=exports status=failed error=%s", error)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
