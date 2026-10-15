"""The rule catalog: transparent, versioned rules that turn the learner model into decisions.

Each rule reads a ``Context`` (one learner, one language) and returns a ``Decision`` or None.
For each decision type the rules are tried in order and the first that fires wins, so rules
that follow what the learner told Polybot (``EXPLICIT_*``) always come before rules that
follow observed behaviour (spec §26). Every decision states why (``reason``), how the app
adapts (``adaptation``), the numbers it used (``metrics``) and how sure it is. Full catalog:
docs/PERSONALIZATION_RULES.md. Changing a rule's logic means bumping its version.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

FIRES_ACCURACY = 0.70        # spec §16: below 70 % with at least 10 attempts raises priority
MIN_SKILL_ATTEMPTS = 10
SHORT_SESSION_MINUTES = 12   # spec §16: average session under 12 minutes -> shorter sequences
EXPLICIT_CONFIDENCE = 1.0    # the learner said so


@dataclass
class Context:
    learner_id: str
    language: str
    skills: list[dict]                 # vw_user_skill_performance rows
    profile: dict | None               # latest learner_profiles row
    patterns: dict | None              # latest study_patterns row
    explicit: dict[str, Any]           # effective explicit preferences: key -> value
    inferred: dict[str, dict]          # inferred preferences: key -> {value, confidence, rationale, evidence_count}
    recall: dict                       # {"attempts", "accuracy", "band"} first tries, last 28 days
    output_share: float | None         # observed share of speaking/writing actions (0-100), last 28 days
    error_words: list[str]             # recurring wrong words, most frequent first
    open_lessons: dict[str, list[str]] # skill_id -> catalog lessons not yet completed, easiest first
    topics: dict[str, str]             # topic_id -> label


@dataclass
class Decision:
    decision_type: str
    scope: str            # 'language' (this language only) or 'global' (every language)
    value: dict
    reason: str
    adaptation: str
    metrics: dict
    confidence: float
    rule_id: str
    rule_version: int
    recommendations: list[tuple[str, str]] = field(default_factory=list)  # (target_type, target_id), ranked


@dataclass(frozen=True)
class Rule:
    rule_id: str
    version: int
    decision_type: str
    description: str
    scope: str
    apply: Callable[[Context], Decision | None]


def pct(x: float) -> int:
    return round(100 * float(x))


def skill_name(ctx: Context, skill_id: str) -> str:
    return next((s["skill_name"] for s in ctx.skills if s["skill_id"] == skill_id), skill_id.replace("_", " ").title())


def _decision(rule: "Rule", value, reason, adaptation, metrics, confidence, recommendations=()) -> Decision:
    return Decision(rule.decision_type, rule.scope, value, reason, adaptation, metrics, round(min(1.0, confidence), 3),
                    rule.rule_id, rule.version, list(recommendations))


def _lesson_recs(ctx: Context, skill_id: str, n: int = 3) -> list[tuple[str, str]]:
    return [("skill", skill_id)] + [("lesson", lesson) for lesson in ctx.open_lessons.get(skill_id, [])[:n]]


# ── next_skill_priority ──────────────────────────────────────────────────────────────

def explicit_focus_skill(ctx: Context) -> Decision | None:
    skill = ctx.explicit.get("focus_skill")
    if not skill:
        return None
    name = skill_name(ctx, skill)
    return _decision(RULES_BY_ID["EXPLICIT_FOCUS_SKILL"], {"skill_id": skill},
                     f"You asked to practise {name} more.",
                     f"Your practice suggestions start with {name}.",
                     {"explicit_focus_skill": skill}, EXPLICIT_CONFIDENCE, _lesson_recs(ctx, skill))


def low_skill_accuracy(ctx: Context) -> Decision | None:
    weak = [s for s in ctx.skills if s["mastery_score"] is not None and s["attempt_count"] >= MIN_SKILL_ATTEMPTS
            and float(s["confidence"]) >= 0.45 and float(s["accuracy_recent"] if s["accuracy_recent"] is not None
                                                          else s["mastery_score"]) < FIRES_ACCURACY]
    if not weak:
        return None
    s = min(weak, key=lambda r: float(r["mastery_score"]))
    accuracy = float(s["accuracy_recent"] if s["accuracy_recent"] is not None else s["mastery_score"])
    return _decision(RULES_BY_ID["LOW_SKILL_ACCURACY"], {"skill_id": s["skill_id"]},
                     f"{s['skill_name']} accuracy is {pct(accuracy)}% across your graded attempts "
                     f"({s['attempt_count']} so far), below the {pct(FIRES_ACCURACY)}% target.",
                     f"Upcoming practice puts {s['skill_name']} first until it passes {pct(FIRES_ACCURACY)}%.",
                     {"skill_id": s["skill_id"], "accuracy": round(accuracy, 3), "mastery_score": float(s["mastery_score"]),
                      "attempt_count": s["attempt_count"], "threshold": FIRES_ACCURACY},
                     float(s["confidence"]), _lesson_recs(ctx, s["skill_id"]))


# ── recommended_difficulty ───────────────────────────────────────────────────────────

def _observed_level(ctx: Context) -> str | None:
    n, acc = ctx.recall["attempts"], ctx.recall["accuracy"]
    if n < 20 or acc is None:
        return None
    return "harder" if acc >= 0.85 else "easier" if acc <= 0.60 else "standard"


def explicit_difficulty(ctx: Context) -> Decision | None:
    wanted = ctx.explicit.get("difficulty_preference")
    if not wanted:
        return None
    observed = _observed_level(ctx)
    note = ""
    if observed and observed != wanted:
        note = (f" Your recent first-try accuracy ({pct(ctx.recall['accuracy'])}%) suggests {observed} material could "
                f"also work; you can change this in your preferences at any time.")
    return _decision(RULES_BY_ID["EXPLICIT_DIFFICULTY"], {"level": wanted},
                     f"You chose {wanted} material.{note}",
                     f"New practice keeps to the {wanted} level you chose.",
                     {"explicit_difficulty": wanted, "observed_level": observed,
                      "recent_accuracy": ctx.recall["accuracy"], "attempts": ctx.recall["attempts"]},
                     EXPLICIT_CONFIDENCE)


def recent_accuracy_level(ctx: Context) -> Decision | None:
    level = _observed_level(ctx)
    if level is None:
        return None
    n, acc = ctx.recall["attempts"], ctx.recall["accuracy"]
    adaptation = {"harder": "New recall words will come from less frequent vocabulary, and well-known words come back less often.",
                  "easier": "Practice will lean on more common words until your accuracy recovers.",
                  "standard": "Difficulty stays where it is; it is working well for you."}[level]
    margin = abs(acc - 0.85) if level == "harder" else abs(0.60 - acc) if level == "easier" else min(acc - 0.60, 0.85 - acc)
    confidence = min(0.95, n / (n + 15)) * max(0.3, min(1.0, margin / 0.1))
    return _decision(RULES_BY_ID["RECENT_ACCURACY_LEVEL"], {"level": level},
                     f"You answered {pct(acc)}% of {n} recall questions correctly on the first try in the last 4 weeks.",
                     adaptation, {"recent_accuracy": round(acc, 3), "attempts": n, "typical_band": ctx.recall["band"],
                                  "harder_at": 0.85, "easier_at": 0.60}, confidence)


# ── review_needed ────────────────────────────────────────────────────────────────────

def explicit_review_frequency(ctx: Context) -> Decision | None:
    wanted = ctx.explicit.get("review_frequency")
    if not wanted:
        return None
    return _decision(RULES_BY_ID["EXPLICIT_REVIEW_FREQUENCY"], {"amount": wanted, "vocab_item_ids": ctx.error_words[:5]},
                     f"You asked for {wanted} review.",
                     {"more": "More of each session goes to words you have seen before.",
                      "less": "Review takes a smaller share of each session.",
                      "standard": "Review keeps its usual share of each session."}[wanted],
                     {"explicit_review_frequency": wanted, "recurring_error_words": len(ctx.error_words)},
                     EXPLICIT_CONFIDENCE, [("vocab_item", w) for w in ctx.error_words[:5]])


def retention_low(ctx: Context) -> Decision | None:
    retention = ctx.profile and ctx.profile.get("retention_score")
    if retention is None or float(retention) >= 0.70:
        return None
    retention = float(retention)
    return _decision(RULES_BY_ID["RETENTION_LOW"], {"amount": "more", "vocab_item_ids": ctx.error_words[:5]},
                     f"You remembered {pct(retention)}% of words when they came back a few days later.",
                     "More of each session goes to reviewing words you have seen before, starting with the ones you missed most.",
                     {"retention_score": retention, "threshold": 0.70, "recurring_error_words": len(ctx.error_words)},
                     0.7, [("vocab_item", w) for w in ctx.error_words[:5]])


def recurring_errors(ctx: Context) -> Decision | None:
    if len(ctx.error_words) < 3:
        return None
    k = len(ctx.error_words)
    return _decision(RULES_BY_ID["RECURRING_ERRORS"], {"amount": "targeted", "vocab_item_ids": ctx.error_words[:5]},
                     f"{k} words were answered wrong at least twice on the first try in the last 4 weeks.",
                     "Those words come back first in Quick Recall.",
                     {"recurring_error_words": k}, min(0.9, 0.5 + 0.05 * k), [("vocab_item", w) for w in ctx.error_words[:5]])


# ── recommended_session_length and recommended_exercise_count ───────────────────────

def _median_minutes(ctx: Context) -> tuple[float | None, int]:
    p = ctx.patterns or {}
    sessions = p.get("sessions_count") or 0
    median = p.get("median_session_minutes")
    return (float(median) if median is not None and sessions >= 5 else None), sessions


def explicit_session_length(ctx: Context) -> Decision | None:
    minutes = ctx.explicit.get("session_length_minutes")
    if minutes is None:
        return None
    return _decision(RULES_BY_ID["EXPLICIT_SESSION_LENGTH"], {"minutes": int(minutes)},
                     f"You told Polybot you prefer sessions of about {int(minutes)} minutes.",
                     f"Practice is planned in sequences that fit {int(minutes)} minutes.",
                     {"explicit_minutes": int(minutes)}, EXPLICIT_CONFIDENCE)


def short_sessions(ctx: Context) -> Decision | None:
    median, sessions = _median_minutes(ctx)
    if median is None or median >= SHORT_SESSION_MINUTES:
        return None
    minutes = max(3, round(median))
    return _decision(RULES_BY_ID["SHORT_SESSIONS"], {"minutes": minutes, "sequence": "short"},
                     f"Your sessions usually last about {minutes} minutes (median of {sessions} in 4 weeks).",
                     f"Lessons are split into shorter sequences that fit a {minutes}-minute session.",
                     {"median_session_minutes": median, "sessions": sessions, "threshold": SHORT_SESSION_MINUTES},
                     min(0.95, sessions / (sessions + 8)))


def typical_session_length(ctx: Context) -> Decision | None:
    median, sessions = _median_minutes(ctx)
    if median is None:
        return None
    minutes = min(90, round(median))
    return _decision(RULES_BY_ID["TYPICAL_SESSION_LENGTH"], {"minutes": minutes, "sequence": "standard"},
                     f"Your sessions usually last about {minutes} minutes (median of {sessions} in 4 weeks).",
                     f"Practice is planned to fit about {minutes} minutes.",
                     {"median_session_minutes": median, "sessions": sessions}, min(0.95, sessions / (sessions + 8)))


def session_pacing(ctx: Context) -> Decision | None:
    minutes = ctx.explicit.get("session_length_minutes")
    median, _ = _median_minutes(ctx)
    minutes = float(minutes) if minutes is not None else median
    response_ms = (ctx.patterns or {}).get("avg_response_time_ms")
    if minutes is None or not response_ms:
        return None
    seconds_per_question = (response_ms + 4000) / 1000  # answer time plus reading and feedback
    count = int(max(5, min(40, round(minutes * 60 * 0.5 / seconds_per_question))))  # half the session for recall
    return _decision(RULES_BY_ID["SESSION_PACING"], {"count": count},
                     f"At about {round(seconds_per_question)} seconds per question, {count} recall questions fill about "
                     f"half of a {round(minutes)}-minute session.",
                     f"Quick Recall rounds aim for {count} questions, leaving time for other practice.",
                     {"session_minutes": round(minutes, 1), "avg_response_time_ms": response_ms, "share_for_recall": 0.5},
                     0.6)


# ── recommended_content_type ─────────────────────────────────────────────────────────

FORMAT_ADAPTATION = "Suggestions favour {formats} activities."


def explicit_content_formats(ctx: Context) -> Decision | None:
    formats = ctx.explicit.get("content_formats")
    if not formats:
        return None
    joined = ", ".join(formats)
    return _decision(RULES_BY_ID["EXPLICIT_CONTENT_FORMATS"], {"formats": formats},
                     f"You said you enjoy {joined}.", FORMAT_ADAPTATION.format(formats=joined),
                     {"explicit_formats": formats}, EXPLICIT_CONFIDENCE)


def practice_balance_gap(ctx: Context) -> Decision | None:
    wanted = ctx.explicit.get("practice_balance")
    if wanted is None or ctx.output_share is None:
        return None
    gap = float(wanted) - ctx.output_share
    if abs(gap) < 20:
        return None
    more_output = gap > 0
    formats = ["speaking", "writing"] if more_output else ["audio", "reading"]
    return _decision(RULES_BY_ID["PRACTICE_BALANCE_GAP"], {"formats": formats},
                     f"You wanted about {round(float(wanted))}% speaking and writing, but recently it has been "
                     f"{round(ctx.output_share)}%.",
                     ("More speaking and writing practice is suggested to match the balance you chose." if more_output
                      else "More listening and reading is suggested to match the balance you chose."),
                     {"explicit_practice_balance": float(wanted), "observed_output_share": round(ctx.output_share, 1),
                      "gap": round(gap, 1)}, 0.8)


def observed_content_formats(ctx: Context) -> Decision | None:
    inferred = ctx.inferred.get("content_formats")
    if not inferred or float(inferred["confidence"]) < 0.45:
        return None
    joined = ", ".join(inferred["value"])
    return _decision(RULES_BY_ID["OBSERVED_CONTENT_FORMATS"], {"formats": inferred["value"]},
                     inferred["rationale"], FORMAT_ADAPTATION.format(formats=joined),
                     {"inferred_formats": inferred["value"], "evidence_count": inferred["evidence_count"]},
                     float(inferred["confidence"]))


# ── recommended_topic, feedback_style, explanation_style ─────────────────────────────

def explicit_interests(ctx: Context) -> Decision | None:
    topics = ctx.explicit.get("interests")
    if not topics:
        return None
    labels = [ctx.topics.get(t, t) for t in topics]
    return _decision(RULES_BY_ID["EXPLICIT_INTERESTS"], {"topics": topics},
                     f"You picked {', '.join(labels[:5])}{' and more' if len(labels) > 5 else ''} as interests.",
                     "Example sentences and practice scenarios will use these topics as topic-tagged content is added.",
                     {"explicit_topics": topics}, EXPLICIT_CONFIDENCE, [("topic", t) for t in topics[:5]])


def explicit_feedback_detail(ctx: Context) -> Decision | None:
    wanted = ctx.explicit.get("feedback_detail")
    if not wanted:
        return None
    return _decision(RULES_BY_ID["EXPLICIT_FEEDBACK_DETAIL"], {"style": wanted},
                     f"You asked for {wanted} feedback.",
                     "Feedback after each answer follows your choice.", {"explicit_feedback_detail": wanted}, EXPLICIT_CONFIDENCE)


def hint_reliance(ctx: Context) -> Decision | None:
    p = ctx.patterns or {}
    rate, n, acc = p.get("hint_rate"), ctx.recall["attempts"], ctx.recall["accuracy"]
    if rate is None or n < 20:
        return None
    rate = float(rate)
    if rate >= 0.25:
        style, reason = "detailed", f"You asked for a hint on {pct(rate)}% of questions in the last 4 weeks."
        adaptation = "After a wrong answer Polybot shows a fuller explanation."
    elif rate <= 0.05 and acc is not None and acc >= 0.80:
        style, reason = "brief", f"You rarely need hints ({pct(rate)}%) and answer {pct(acc)}% correctly on the first try."
        adaptation = "Feedback stays short so you can keep a quick pace."
    else:
        return None
    return _decision(RULES_BY_ID["HINT_RELIANCE"], {"style": style}, reason, adaptation,
                     {"hint_rate": rate, "attempts": n, "recent_accuracy": acc}, min(0.9, n / (n + 20)))


def explicit_grammar_approach(ctx: Context) -> Decision | None:
    value = ctx.explicit.get("grammar_approach")
    if value is None:
        return None
    value = float(value)
    style = "rules_first" if value > 60 else "examples_first" if value < 40 else "mixed"
    words = {"rules_first": "a clear rule first, then examples", "examples_first": "examples first, then the pattern",
             "mixed": "a mix of examples and short rules"}[style]
    return _decision(RULES_BY_ID["EXPLICIT_GRAMMAR_APPROACH"], {"style": style},
                     f"In your learning method you chose {words}.", f"Grammar topics open with {words}.",
                     {"explicit_grammar_approach": value}, EXPLICIT_CONFIDENCE)


RULES: list[Rule] = [
    Rule("EXPLICIT_FOCUS_SKILL", 1, "next_skill_priority", "The learner chose a skill to focus on.", "language", explicit_focus_skill),
    Rule("LOW_SKILL_ACCURACY", 1, "next_skill_priority",
         "Lowest-mastery skill with first-try accuracy below 70% over at least 10 graded attempts.", "language", low_skill_accuracy),
    Rule("EXPLICIT_DIFFICULTY", 1, "recommended_difficulty", "The learner chose a difficulty level.", "language", explicit_difficulty),
    Rule("RECENT_ACCURACY_LEVEL", 1, "recommended_difficulty",
         "First-try recall accuracy over 4 weeks (at least 20 attempts): 85% or more -> harder, 60% or less -> easier.",
         "language", recent_accuracy_level),
    Rule("EXPLICIT_REVIEW_FREQUENCY", 1, "review_needed", "The learner chose how much review they want.", "language", explicit_review_frequency),
    Rule("RETENTION_LOW", 1, "review_needed", "Recall of words seen days earlier is below 70%.", "language", retention_low),
    Rule("RECURRING_ERRORS", 1, "review_needed", "Three or more words answered wrong twice or more in 4 weeks.", "language", recurring_errors),
    Rule("EXPLICIT_SESSION_LENGTH", 1, "recommended_session_length", "The learner chose a session length.", "global", explicit_session_length),
    Rule("SHORT_SESSIONS", 1, "recommended_session_length", "Median session under 12 minutes (at least 5 sessions).", "global", short_sessions),
    Rule("TYPICAL_SESSION_LENGTH", 1, "recommended_session_length", "Plan around the learner's median session length.", "global", typical_session_length),
    Rule("SESSION_PACING", 1, "recommended_exercise_count",
         "Recall questions that fill half a session at the learner's own pace.", "global", session_pacing),
    Rule("EXPLICIT_CONTENT_FORMATS", 1, "recommended_content_type", "The learner chose the formats they enjoy.", "global", explicit_content_formats),
    Rule("PRACTICE_BALANCE_GAP", 1, "recommended_content_type",
         "Observed input/output balance differs from the learner's chosen balance by 20 points or more.", "global", practice_balance_gap),
    Rule("OBSERVED_CONTENT_FORMATS", 1, "recommended_content_type",
         "Formats the learner engages with most (inferred, at least moderate confidence).", "global", observed_content_formats),
    Rule("EXPLICIT_INTERESTS", 1, "recommended_topic", "The learner picked interests.", "global", explicit_interests),
    Rule("EXPLICIT_FEEDBACK_DETAIL", 1, "feedback_style", "The learner chose a feedback style.", "global", explicit_feedback_detail),
    Rule("HINT_RELIANCE", 1, "feedback_style",
         "Hint rate of 25% or more -> detailed feedback; 5% or less with 80% accuracy -> brief.", "global", hint_reliance),
    Rule("EXPLICIT_GRAMMAR_APPROACH", 1, "explanation_style", "The learner's chosen grammar approach.", "global", explicit_grammar_approach),
]
RULES_BY_ID = {r.rule_id: r for r in RULES}
DECISION_TYPES = list(dict.fromkeys(r.decision_type for r in RULES))


def decide(ctx: Context, scope: str) -> list[Decision]:
    """First firing rule per decision type, among rules of the given scope."""
    out = []
    for decision_type in DECISION_TYPES:
        for rule in (r for r in RULES if r.decision_type == decision_type and r.scope == scope):
            decision = rule.apply(ctx)
            if decision is not None:
                out.append(decision)
                break
    return out
