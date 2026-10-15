"""Synthetic learner simulator (ADR-003).

    python -m polybot_insights.simulator --learners 25 --days 45 --seed 7

Each simulated learner has hidden traits (per-skill ability, learning rate, practice rhythm,
preferred time of day, hint habit, input/output preference) and produces weeks of events
that follow docs/EVENT_TAXONOMY.md. Ability grows with practice, so later phases have real
trends to find. Batches go through ``ingest.store_batch`` — the same path as the extension —
labelled ``source = 'simulator'``, so every learner they create is marked ``is_synthetic``.
Anything computed from them must be reported as simulated.

``--invalid-rate`` deliberately corrupts a small share of events (bad values, missing fields,
future timestamps, resent batches) to exercise the validator's quarantine.
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import os
import random
import sys
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

import psycopg

from polybot_insights.config import load_env_file
from polybot_insights.ingest import MAX_EVENTS, EventBatch, store_batch

log = logging.getLogger("polybot_insights.simulator")
APP_VERSION = "sim-1"
SKILLS = ("vocabulary", "grammar", "pronunciation", "listening_comprehension", "reading_comprehension")
HOUR_BUCKETS = {"early_morning": (5, 8), "morning": (8, 12), "afternoon": (12, 17), "evening": (17, 21), "night": (21, 24)}
FORMATS = ["audio", "reading", "speaking", "writing", "visual", "hands-on"]
ACCENTS = ["es-MX", "es-ES", "es-AR", "es-CO"]
REGIONS = ["MX", "ES", "AR", "CO", "PE", "CL"]
# French has no frequency list in the extension; a small built-in set with rough bands.
FRENCH_WORDS = [("le", 1), ("être", 1), ("avoir", 1), ("et", 1), ("maison", 2), ("chat", 2), ("chien", 2), ("pain", 2),
                ("eau", 2), ("livre", 2), ("ville", 2), ("travail", 2), ("voiture", 2), ("ami", 2), ("temps", 2),
                ("pomme", 3), ("fenêtre", 3), ("cuisine", 3), ("voyage", 3), ("montagne", 3), ("plage", 3),
                ("souvenir", 3), ("épicerie", 4), ("bibliothèque", 4), ("parapluie", 4), ("chaussure", 4),
                ("éphémère", 5), ("quotidien", 4), ("néanmoins", 5), ("dorénavant", 5)]
CEFR_ORDER = ["A1", "A2", "B1", "B2", "C1"]


def sigmoid(x: float) -> float:
    return 1 / (1 + math.exp(-x))


@dataclass
class Traits:
    language: str
    ability: dict[str, float]
    learning_rate: float
    sessions_per_week: float
    session_minutes: float
    hour_bucket: str
    hint_rate: float
    skip_rate: float
    output_preference: int
    grammar_preference: int
    formats: list[str]
    interests: list[str]


@dataclass
class Learner:
    learner_id: str
    traits: Traits
    words: list[tuple[str, int]]          # (vocab_item_id, band) the learner has saved
    grammar: list[tuple[str, str]]        # (lesson_id, cefr) available
    media: list[str]
    completed: set[str] = field(default_factory=set)
    attempt_seq: int = 0


class Simulator:
    def __init__(self, conn: psycopg.Connection, seed: int = 7, invalid_rate: float = 0.0, end: datetime | None = None):
        self.conn, self.rng, self.invalid_rate = conn, random.Random(seed), invalid_rate
        self.end = end or datetime.now(timezone.utc)
        self.spanish = [(r[0], r[1] or 3) for r in conn.execute(
            "SELECT vocab_item_id, difficulty_band FROM core.vocabulary_items WHERE language_code = 'es' AND difficulty_band <= 3 "
            "ORDER BY vocab_item_id")]
        self.topics = [r[0] for r in conn.execute("SELECT topic_id FROM core.topics ORDER BY topic_id")]
        if not self.spanish or not self.topics:
            raise RuntimeError("The catalog is empty. Run `python -m polybot_insights.catalog` first.")
        self.lessons = {lang: [(r[0], r[1]) for r in conn.execute(
            "SELECT lesson_id, cefr_level FROM core.lessons WHERE lesson_type = 'grammar_topic' AND language_code = %s "
            "ORDER BY lesson_id", (lang,))] for lang in ("es", "fr")}
        self.media = [r[0] for r in conn.execute(
            "SELECT lesson_id FROM core.lessons WHERE lesson_type = 'media_item' AND owner_learner_id IS NULL "
            "AND language_code = 'es' ORDER BY lesson_id")]

    # ── helpers ─────────────────────────────────────────────────────────────────────
    def uuid(self) -> str:
        return str(uuid.UUID(int=self.rng.getrandbits(128), version=4))

    def make_learner(self) -> Learner:
        r = self.rng
        language = "es" if r.random() < 0.75 else "fr"
        level = r.betavariate(2, 3)  # most learners are beginners
        ability = {s: min(0.95, max(0.05, level + r.gauss(0, 0.12))) for s in SKILLS}
        traits = Traits(
            language=language, ability=ability, learning_rate=r.uniform(0.001, 0.005),
            sessions_per_week=r.choice([1.5, 3, 4, 5, 6.5]), session_minutes=r.choice([6, 10, 15, 25, 40]),
            hour_bucket=r.choice(list(HOUR_BUCKETS)), hint_rate=r.uniform(0.02, 0.35), skip_rate=r.uniform(0.0, 0.12),
            output_preference=r.choice([20, 50, 80]), grammar_preference=r.choice([20, 50, 80]),
            formats=r.sample(FORMATS, r.randint(1, 3)), interests=r.sample(self.topics, r.randint(2, 6)))
        if language == "es":
            pool = [w for w in self.spanish if w[1] <= 2] + r.sample([w for w in self.spanish if w[1] == 3], 60)
            words = r.sample(pool, min(len(pool), r.randint(25, 70)))
        else:
            words = [(f"fr:{w}", b) for w, b in FRENCH_WORDS]
        top = CEFR_ORDER.index("B1") if level > 0.5 else CEFR_ORDER.index("A2")
        grammar = [l for l in self.lessons[language] if CEFR_ORDER.index(l[1]) <= top]
        return Learner(self.uuid(), traits, words, grammar, self.media if language == "es" else [])

    def event(self, learner: Learner, session: str, at: datetime, event_type: str, language: str | None = None,
              context: dict | None = None, payload: dict | None = None) -> dict[str, Any]:
        body = {"event_id": self.uuid(), "schema_version": 1, "event_type": event_type,
                "learner_id": learner.learner_id, "session_id": session,
                "occurred_at": at.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                "tz_offset_minutes": 0, "surface": "simulator", "app_version": APP_VERSION,
                "context": context or {}, "payload": payload or {}}
        if language:
            body["language"] = language
        return body

    # ── one learner's history ───────────────────────────────────────────────────────
    def simulate_learner(self, learner: Learner, days: int) -> list[list[dict]]:
        r, t = self.rng, learner.traits
        lang = t.language
        start = self.end - timedelta(days=days)
        sessions: list[list[dict]] = []
        first = True
        for day in range(days):
            if not first and r.random() > t.sessions_per_week / 7:
                continue
            lo, hi = HOUR_BUCKETS[t.hour_bucket] if r.random() < 0.8 else HOUR_BUCKETS[r.choice(list(HOUR_BUCKETS))]
            at = (start + timedelta(days=day)).replace(hour=0, minute=0, second=0, microsecond=0) \
                + timedelta(hours=r.uniform(lo, hi - 0.5))
            if at > self.end - timedelta(minutes=90):
                break
            session = self.uuid()
            events: list[dict] = []
            if first:
                events.append(self.event(learner, session, at, "learner_registered",
                                         payload={"native_language": "en", "consent_version": 1}))
            events.append(self.event(learner, session, at, "session_started", payload={"entry_surface": "studio"}))
            if first:
                at += timedelta(seconds=40)
                for key, value in (("practice_balance", t.output_preference), ("grammar_approach", t.grammar_preference),
                                   ("content_formats", t.formats)):
                    events.append(self.event(learner, session, at, "preference_set", lang,
                                             payload={"preference_key": key, "value": value, "stated_via": "quiz"}))
                    at += timedelta(seconds=2)
                events.append(self.event(learner, session, at, "preference_set", lang,
                                         payload={"preference_key": "interests", "value": t.interests, "stated_via": "settings"}))
                if lang == "es":
                    events.append(self.event(learner, session, at + timedelta(seconds=5), "preference_set", "es",
                                             payload={"preference_key": "region", "value": r.choice(REGIONS), "stated_via": "settings"}))
                first = False
            budget = at + timedelta(minutes=max(3, r.gauss(t.session_minutes, t.session_minutes * 0.3)))
            while at < budget:
                at += timedelta(seconds=r.uniform(5, 40))
                activity = r.choices(["recall", "review", "lookup", "grammar", "speak", "media"],
                                     weights=[5, 2, 2, 1.5, 1.5 if lang == "es" else 0, 1 if learner.media else 0])[0]
                at, new = getattr(self, f"_{activity}")(learner, session, at)
                events.extend(new)
            sessions.append(events)
        return sessions

    def _grow(self, learner: Learner, skill: str, success: bool) -> None:
        a = learner.traits.ability[skill]
        rate = learner.traits.learning_rate * (1.0 if success else 0.4)
        learner.traits.ability[skill] = min(0.98, a + rate * (1 - a))

    def _recall(self, learner: Learner, session: str, at: datetime):
        r, t = self.rng, learner.traits
        vocab_item_id, band = r.choice(learner.words)
        kind = r.choice(["vocab_recall_choice", "vocab_recall_reverse_choice"])
        ctx = {"exercise_id": f"{kind}:{vocab_item_id}", "vocab_item_id": vocab_item_id}
        events, hints, choices = [], 0, 4
        if r.random() < t.skip_rate:
            return at, [self.event(learner, session, at, "content_skipped", t.language, ctx, {"reason": "skip_button"})]
        if r.random() < t.hint_rate:
            at += timedelta(seconds=r.uniform(2, 6))
            events.append(self.event(learner, session, at, "hint_requested", t.language, ctx, {"hint_type": "eliminate_choice"}))
            hints, choices = 1, 3
        p = sigmoid(6 * (t.ability["vocabulary"] - (band - 1) / 5) + 0.6 * hints)
        for attempt in (1, 2, 3):
            correct = r.random() < p
            ms = int(r.lognormvariate(math.log(2200 if correct else 3800), 0.45))
            at += timedelta(milliseconds=ms)
            events.append(self.event(learner, session, at, "answer_submitted", t.language, ctx, {
                "exercise_type": kind, "is_correct": correct, "response_time_ms": ms, "attempt_number": attempt,
                "hints_used": hints, "choice_count": choices}))
            if attempt == 1:
                self._grow(learner, "vocabulary", correct)
            if correct:
                break
            choices, p = choices - 1, min(0.97, p + 0.3)
            if choices < 2:
                break
        return at, events

    def _review(self, learner: Learner, session: str, at: datetime):
        r, t = self.rng, learner.traits
        vocab_item_id, band = r.choice(learner.words)
        recall = sigmoid(6 * (t.ability["vocabulary"] - (band - 1) / 5))
        rating = "easy" if recall > 0.85 else "good" if recall > 0.6 else "hard" if recall > 0.35 else "again"
        if r.random() < 0.2:
            rating = r.choice(["again", "hard", "good", "easy"])  # self-reports are noisy
        at += timedelta(seconds=r.uniform(3, 10))
        kind = "listening" if r.random() < 0.3 else "meaning"
        return at, [self.event(learner, session, at, "review_rated", t.language, {"vocab_item_id": vocab_item_id},
                               {"review_kind": kind, "rating": rating, "revealed_after_ms": r.randint(800, 9000)})]

    def _lookup(self, learner: Learner, session: str, at: datetime):
        r, t = self.rng, learner.traits
        vocab_item_id, _ = r.choice(learner.words)
        ctx = {"vocab_item_id": vocab_item_id}
        events = [self.event(learner, session, at, "word_looked_up", t.language, ctx,
                             {"lookup_surface": r.choice(["page", "dictionary"]), "direction": "target_to_native",
                              "result": "translated"})]
        if r.random() < 0.5:
            at += timedelta(seconds=r.uniform(2, 8))
            events.append(self.event(learner, session, at, "definition_saved", t.language, ctx,
                                     {"has_context": r.random() < 0.8, "is_custom": r.random() < 0.1}))
        if r.random() < 0.4:
            at += timedelta(seconds=1)
            events.append(self.event(learner, session, at, "vocab_status_changed", t.language, ctx,
                                     {"from": "unmarked", "to": r.choice(["learning", "known"]), "method": "page_click"}))
        return at, events

    def _grammar(self, learner: Learner, session: str, at: datetime):
        r, t = self.rng, learner.traits
        if not learner.grammar:
            return at, []
        lesson_id, _ = r.choice(learner.grammar)
        ctx = {"lesson_id": lesson_id}
        events = [self.event(learner, session, at, "lesson_started", t.language, ctx, {"entry": "navigation"})]
        at += timedelta(minutes=r.uniform(1.5, 6))
        if r.random() < 0.7:
            events.append(self.event(learner, session, at, "lesson_completed", t.language, ctx, {"completion": "self_marked"}))
            learner.completed.add(lesson_id)
            self._grow(learner, "grammar", True)
        else:
            events.append(self.event(learner, session, at, "content_skipped", t.language, ctx, {"reason": "closed_early"}))
        return at, events

    def _speak(self, learner: Learner, session: str, at: datetime):
        r, t = self.rng, learner.traits
        learner.attempt_seq += 1
        phrase = f"phrase:sim-{learner.learner_id[:8]}-{r.randint(1, 12)}"
        ref = f"attempt-{learner.learner_id[:8]}-{learner.attempt_seq}"
        ctx = {"lesson_id": phrase}
        duration = int(r.uniform(1500, 6000))
        at += timedelta(milliseconds=duration + 2000)
        events = [self.event(learner, session, at, "pronunciation_attempted", "es", ctx, {
            "client_attempt_ref": ref, "mode": r.choice(["practice", "practice", "test"]), "duration_ms": duration,
            "accent": r.choice(ACCENTS[:2]), "has_reference": True, "is_segment": r.random() < 0.3})]
        if r.random() < 0.6:
            at += timedelta(seconds=r.uniform(3, 8))
            score = lambda: round(min(100, max(0, r.gauss(100 * t.ability["pronunciation"], 8))), 1)
            words = r.randint(3, 9)
            accuracy = score()
            events.append(self.event(learner, session, at, "pronunciation_scored", "es", ctx, {
                "client_attempt_ref": ref, "provider": "azure", "locale": r.choice(ACCENTS[:2]), "accuracy": accuracy,
                "fluency": score(), "completeness": score(), "words_scored": words,
                "words_below_70": min(words, max(0, round(words * (1 - accuracy / 100) * 1.5)))}))
            self._grow(learner, "pronunciation", accuracy >= 70)
        if r.random() < 0.5:
            at += timedelta(seconds=r.uniform(1, 4))
            events.append(self.event(learner, session, at, "review_rated", "es", ctx,
                                     {"review_kind": "speaking", "rating": r.choice(["hard", "good", "good", "easy"]),
                                      "client_attempt_ref": ref}))
        return at, events

    def _media(self, learner: Learner, session: str, at: datetime):
        r, t = self.rng, learner.traits
        lesson_id = r.choice(learner.media)
        ctx = {"lesson_id": lesson_id}
        events = [self.event(learner, session, at, "lesson_started", t.language, ctx, {"entry": "navigation"})]
        at += timedelta(minutes=r.uniform(1, 4))
        mode = "writing" if t.output_preference >= 50 else "speaking_reflection"
        events.append(self.event(learner, session, at, "media_response_saved", t.language, ctx,
                                 {"mode": mode, "response_chars": r.randint(40, 600)}))
        skill = "listening_comprehension" if ":listening:" in lesson_id else "reading_comprehension"
        self._grow(learner, skill, True)
        return at, events

    # ── deliberate data-quality problems ────────────────────────────────────────────
    def corrupt(self, body: dict) -> dict:
        r = self.rng
        body = json.loads(json.dumps(body))
        choice = r.choice(["missing_field", "negative_time", "future", "bad_enum", "forbidden"])
        if choice == "missing_field":
            body.pop("session_id")
        elif choice == "negative_time" and body["event_type"] == "answer_submitted":
            body["payload"]["response_time_ms"] = -50
        elif choice == "future":
            body["occurred_at"] = (self.end + timedelta(days=2)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        elif choice == "forbidden":
            body["payload"]["text"] = "simulated private text"
        else:
            body["surface"] = "smartwatch"
        return body

    def batches(self, learner: Learner, sessions: list[list[dict]]) -> list[EventBatch]:
        out = []
        for events in sessions:
            events = [self.corrupt(e) if e["event_type"] != "learner_registered" and self.rng.random() < self.invalid_rate else e
                      for e in events]
            for i in range(0, len(events), MAX_EVENTS):
                chunk = events[i:i + MAX_EVENTS]
                out.append(EventBatch(batch_id=self.uuid(), learner_id=learner.learner_id, source="simulator",
                                      sent_at=self.end, dropped_since_last_sync=0, events=chunk))
        return out

    def run(self, learners: int, days: int) -> dict[str, int]:
        totals = {"learners": 0, "batches": 0, "events": 0, "resent_batches": 0}
        for _ in range(learners):
            learner = self.make_learner()
            for batch in self.batches(learner, self.simulate_learner(learner, days)):
                store_batch(self.conn, batch, len(batch.model_dump_json()))
                totals["batches"] += 1
                totals["events"] += len(batch.events)
                if self.invalid_rate and self.rng.random() < self.invalid_rate:
                    store_batch(self.conn, batch, len(batch.model_dump_json()))  # a retry: must be stored once
                    totals["resent_batches"] += 1
            totals["learners"] += 1
        log.info("operation=simulate status=succeeded learners=%d batches=%d events=%d",
                 totals["learners"], totals["batches"], totals["events"])
        return totals


def real_learner_count(conn: psycopg.Connection) -> int:
    """Real learners already in the database, including ones still waiting in raw."""
    loaded = conn.execute("SELECT count(*) FROM core.learners WHERE NOT is_synthetic").fetchone()[0]
    waiting = conn.execute("SELECT count(DISTINCT claimed_learner_id) FROM raw.event_batches b "
                           "WHERE source <> 'simulator' AND NOT EXISTS "
                           "(SELECT 1 FROM core.learners l WHERE l.learner_id = b.claimed_learner_id)").fetchone()[0]
    return loaded + waiting


def main(argv: list[str] | None = None) -> int:
    load_env_file()
    parser = argparse.ArgumentParser(description="Generate simulated learners through the ingest path (ADR-003).")
    parser.add_argument("--database-url", default=os.environ.get("POLYBOT_DATABASE_URL"))
    parser.add_argument("--learners", type=int, default=25)
    parser.add_argument("--days", type=int, default=45)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--invalid-rate", type=float, default=0.005,
                        help="share of events deliberately corrupted to exercise validation (default 0.005)")
    parser.add_argument("--run-pipeline", action="store_true", help="process the new events right away")
    parser.add_argument("--allow-real-learners", action="store_true",
                        help="add simulated learners even if the database already holds real ones")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    if not args.database_url:
        parser.error("set POLYBOT_DATABASE_URL or pass --database-url")
    with psycopg.connect(args.database_url, autocommit=True) as conn:
        real = real_learner_count(conn)
        if real and not args.allow_real_learners:
            log.error("operation=simulate status=refused reason=database_has_real_learners count=%d", real)
            print(f"Refusing to add simulated learners: this database already holds {real} real learner(s). "
                  "Use a separate database for simulations (see insights/README.md §8), or pass "
                  "--allow-real-learners if you really want them mixed.", file=sys.stderr)
            return 2
        totals = Simulator(conn, args.seed, args.invalid_rate).run(args.learners, args.days)
        print({"simulated": totals})
        if args.run_pipeline:
            from polybot_insights.pipeline.run import run_pipeline
            print(run_pipeline(conn, "cli").as_dict())
    return 0


if __name__ == "__main__":
    sys.exit(main())
