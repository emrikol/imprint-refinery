"""Focused tests for guided catalog matching session state."""

import importlib.util
import json
from pathlib import Path
import sys
import unittest

_MODULE_PATH = (
    Path(__file__).resolve().parents[1]
    / "custom_components"
    / "imprint_refinery"
    / "catalog_sessions.py"
)
spec = importlib.util.spec_from_file_location(
    "imprint_refinery_catalog_sessions_test", _MODULE_PATH
)
assert spec and spec.loader
catalog_sessions = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = catalog_sessions
spec.loader.exec_module(catalog_sessions)


class _Clock:
    def __init__(self) -> None:
        self.now = 1_000.0

    def __call__(self) -> float:
        return self.now


class GuidedCatalogSessionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.clock = _Clock()
        self.manager = catalog_sessions.GuidedCatalogSessionManager(clock=self.clock)
        self.candidates = [
            {"candidate_id": "power-a", "profile_ids": ["a"], "code": "AAA"},
            {"candidate_id": "power-b", "profile_ids": ["b"], "code": "BBB"},
        ]

    def start(self) -> dict:
        return self.manager.start(
            self.candidates,
            context={"category": "tv", "brand": "Example"},
        )

    def test_session_is_small_serializable_and_detached(self) -> None:
        session = self.start()

        json.dumps(session)
        self.assertEqual(session["status"], "active")
        self.assertEqual(session["current_candidate"]["candidate_id"], "power-a")
        self.assertEqual(session["progress"], {"position": 1, "total": 2})
        self.assertNotIn("policy", session)
        self.assertNotIn("results", session)
        self.assertNotIn("created_at", session)
        self.assertNotIn("cooldown_until", session)

        session["candidates"][0]["code"] = "changed"
        self.assertEqual(
            self.manager.get(session["session_id"])["candidates"][0]["code"], "AAA"
        )

    def test_one_shot_result_enforces_candidate_order_and_cooldown(self) -> None:
        session_id = self.start()["session_id"]
        with self.assertRaisesRegex(
            catalog_sessions.GuidedSessionError, "Expected candidate power-a"
        ):
            self.manager.begin_test(session_id, "power-b")

        pending = self.manager.begin_test(session_id, "power-a")
        self.assertEqual(pending["pending_test"], {"candidate_id": "power-a"})
        with self.assertRaisesRegex(
            catalog_sessions.GuidedSessionError, "outstanding test result"
        ):
            self.manager.begin_test(session_id, "power-a")
        with self.assertRaisesRegex(
            catalog_sessions.GuidedSessionError,
            "Expected a result for candidate power-a",
        ):
            self.manager.record_result(session_id, "power-b", "no_response")

        advanced = self.manager.record_result(session_id, "power-a", "no_response")
        self.assertEqual(advanced["current_candidate"]["candidate_id"], "power-b")
        with self.assertRaisesRegex(
            catalog_sessions.GuidedSessionError, "Begin the expected candidate"
        ):
            self.manager.record_result(session_id, "power-b", "no_response")
        with self.assertRaisesRegex(
            catalog_sessions.GuidedSessionError, "Wait 5.000 seconds"
        ):
            self.manager.begin_test(session_id, "power-b")

        self.clock.now += 5
        self.manager.begin_test(session_id, "power-b")
        completed = self.manager.record_result(session_id, "power-b", "no_response")
        self.assertEqual(completed["status"], "completed")
        self.assertIsNone(completed["current_candidate"])

    def test_worked_and_not_sure_pause_without_advancing(self) -> None:
        for result in ("worked", "not_sure"):
            with self.subTest(result=result):
                manager = catalog_sessions.GuidedCatalogSessionManager(clock=self.clock)
                session = manager.start(self.candidates)
                manager.begin_test(session["session_id"], "power-a")
                paused = manager.record_result(session["session_id"], "power-a", result)

                self.assertEqual(paused["status"], "paused")
                self.assertEqual(paused["pause_reason"], result)
                self.assertEqual(paused["current_candidate"]["candidate_id"], "power-a")
                resumed = manager.resume(session["session_id"])
                self.assertEqual(resumed["status"], "active")
                self.assertEqual(
                    resumed["current_candidate"]["candidate_id"], "power-a"
                )

    def test_send_failure_pauses_and_can_resume_same_candidate(self) -> None:
        session_id = self.start()["session_id"]
        self.manager.begin_test(session_id, "power-a")

        failed = self.manager.record_send_failure(
            session_id,
            "power-a",
            "  transport\nfailed\t" + ("x" * 300),
        )

        self.assertEqual(failed["status"], "paused")
        self.assertEqual(failed["pause_reason"], "send_failed")
        self.assertEqual(failed["current_candidate"]["candidate_id"], "power-a")
        self.assertIsNone(failed["pending_test"])
        self.assertNotIn("\n", failed["last_error"]["message"])
        self.assertLessEqual(len(failed["last_error"]["message"]), 240)

        resumed = self.manager.resume(session_id)
        self.assertEqual(resumed["status"], "active")
        self.assertEqual(resumed["current_candidate"]["candidate_id"], "power-a")

    def test_explicit_pause_resume_and_cancel_preserve_lifecycle(self) -> None:
        session_id = self.start()["session_id"]
        paused = self.manager.pause(session_id)
        self.assertEqual(paused["status"], "paused")
        self.assertEqual(paused["pause_reason"], "user")
        self.assertEqual(self.manager.resume(session_id)["status"], "active")

        cancelled = self.manager.cancel(session_id)
        self.assertEqual(cancelled["status"], "cancelled")
        self.assertEqual(self.manager.cancel(session_id), cancelled)
        with self.assertRaisesRegex(
            catalog_sessions.GuidedSessionError, "expected active"
        ):
            self.manager.begin_test(session_id, "power-a")

    def test_rejects_duplicate_candidates(self) -> None:
        duplicate = [self.candidates[0], dict(self.candidates[0])]
        with self.assertRaisesRegex(
            catalog_sessions.GuidedSessionError, "de-duplicated"
        ):
            self.manager.start(duplicate)


if __name__ == "__main__":
    unittest.main()
