# BI Exports — Tableau and Excel (Phase 8)

Analytics-ready files for exploring Polybot's data outside the extension (spec §28–29). The learner-facing dashboard stays in Polybot; these files are for analysis and portfolio work.

```powershell
cd insights
.venv\Scripts\python -m polybot_insights.exports            # writes insights/exports/ (git-ignored)
```

Run it after the daily sequence (pipeline → learner model → personalization). Each export is one `ops.pipeline_runs` row (`pipeline_name = 'exports'`) and reads one consistent database snapshot.

## Privacy

- **`learner_key`** replaces every learner ID: HMAC-SHA256 of the ID with `POLYBOT_EXPORT_SALT` from `insights/.env`, first 16 hex characters. Without the salt a key cannot be traced back to a learner; with the same salt, keys stay stable across exports so trends line up. The exporter refuses to run without a real salt.
- **No vocabulary terms, learner-written text, or learner-owned content IDs** (captured phrases, saved media). Data is aggregated to skill, exercise type, difficulty band or catalog lesson (EVENT_TAXONOMY §6).
- **`is_simulated` / `includes_simulated`** on every row: simulated learners must be reported as simulated (ADR-003). The workbook's Summary says so in bold when any are present. A test scans every output file for learner IDs, vocabulary IDs and learner-owned lesson IDs.

## Files

| File | Grain | Use |
|---|---|---|
| `polybot_analytics.csv` | learner × language × skill × day | **Main Tableau source.** Mastery, accuracy, attempts, confidence, trend, plus that day's profile (proficiency, retention, consistency) and study patterns |
| `engagement_weekly.csv` | learner × week | Sessions, active days, practice minutes, events |
| `content_performance.csv` | catalog lesson, or exercise type × difficulty band | Starts, completions, completion rate; attempts, first-try accuracy, response time |
| `personalization_outcomes.csv` | rule × decision type | Decisions, active, overridden by learners, recommendations shown / accepted, acceptance rate |
| `polybot_analytics.xlsx` | all of the above | Tabs **Summary, Skill Performance, Content Performance, Engagement, Personalization Outcomes, Raw Analytics Data** |

Column definitions follow [LEARNER_MODEL.md](LEARNER_MODEL.md) and [PERSONALIZATION_RULES.md](PERSONALIZATION_RULES.md). Rates are 0–1.

## Tableau: "Polybot Learning Intelligence Overview"

1. **Connect → To a File → Text file** → `polybot_analytics.csv`. Add `engagement_weekly.csv`, `content_performance.csv` and `personalization_outcomes.csv` as separate data sources (they have different grains; do not join them row-by-row).
2. Check types: `date` → Date, `is_simulated` → Boolean, `learner_key` → String (Dimension).
3. Add a data-source filter or a visible quick filter on `is_simulated`, and put "Simulated data" in the dashboard title whenever simulated rows are included.

Suggested sheets:

| Sheet | Build |
|---|---|
| Skill progression | `date` (continuous day) on Columns, AVG(`mastery_score`) on Rows, `skill_group` on Color; filter `confidence_label` ≠ *Still learning* |
| Mastery distribution | `skill` on Rows, AVG(`mastery_score`) bars, COUNTD(`learner_key`) as label; latest `date` only |
| Engagement | `engagement_weekly`: `week_start` on Columns, SUM(`sessions`) and SUM(`practice_minutes`) on dual axis |
| Retention vs consistency | latest day, one mark per `learner_key`: `consistency_score` × `retention_score` scatter, size = `total_practice_minutes` |
| Content effectiveness | `content_performance` where `content_kind` = lesson: `completion_rate` by `cefr_level`; exercise types: `first_try_accuracy` by `difficulty_band` |
| Personalization outcomes | `personalization_outcomes`: `acceptance_rate` and `overridden_by_learner` by `rule_id` |

Combine them on one dashboard with `language` and `is_simulated` as global filters.

## Excel

Open `polybot_analytics.xlsx`. Every data tab is an **Excel Table** (Skill Performance → `SkillPerformance`, Raw Analytics Data → `RawAnalyticsData`, and so on), so **Insert → PivotTable** works straight away, and structured references such as `=AVERAGE(SkillPerformance[mastery_score])` stay correct as rows change. The Summary tab has headline numbers plus a few live formulas built that way. Rate columns are formatted as percentages. The layout is ready for later VBA (one table per sheet, header row 1).
