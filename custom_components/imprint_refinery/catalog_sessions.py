"""In-memory state for explicit, one-shot guided catalog matching."""

from collections.abc import Callable, Mapping, Sequence
from copy import deepcopy
import time
from typing import Any, Literal
import uuid

GuidedResult = Literal["worked", "no_response", "not_sure"]

INTER_TEST_DELAY_SECONDS = 5.0
_RESULTS = {"worked", "no_response", "not_sure"}
_MAX_ERROR_LENGTH = 240


class GuidedSessionError(RuntimeError):
    """Raised when a guided matching operation violates its session contract."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class GuidedCatalogSessionManager:
    """Manage ordered guided tests without owning the IR transport."""

    def __init__(self, *, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._sessions: dict[str, dict[str, Any]] = {}

    def start(
        self,
        candidates: Sequence[Mapping[str, Any]],
        *,
        context: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Start an ordered session from already de-duplicated candidates."""
        normalized_candidates: list[dict[str, Any]] = []
        candidate_ids: list[str] = []
        for candidate in candidates:
            if not isinstance(candidate, Mapping):
                raise GuidedSessionError(
                    "invalid_candidate",
                    "Every candidate must be an object",
                )
            candidate_copy = deepcopy(dict(candidate))
            candidate_id = candidate_copy.get("candidate_id")
            if not isinstance(candidate_id, str) or not candidate_id.strip():
                raise GuidedSessionError(
                    "invalid_candidate",
                    "Every candidate requires a non-empty candidate_id",
                )
            candidate_copy["candidate_id"] = candidate_id.strip()
            candidate_ids.append(candidate_copy["candidate_id"])
            normalized_candidates.append(candidate_copy)

        if not normalized_candidates:
            raise GuidedSessionError(
                "no_candidates",
                "A guided matching session requires at least one candidate",
            )
        if len(set(candidate_ids)) != len(candidate_ids):
            raise GuidedSessionError(
                "duplicate_candidate",
                "Candidates must be de-duplicated before starting a session",
            )

        session_id = uuid.uuid4().hex
        self._sessions[session_id] = {
            "session_id": session_id,
            "status": "active",
            "pause_reason": None,
            "context": deepcopy(dict(context or {})),
            "candidates": normalized_candidates,
            "current_index": 0,
            "pending_test": None,
            "cooldown_until": self._now(),
        }
        return self.get(session_id)

    def get(self, session_id: str) -> dict[str, Any]:
        """Return a detached view of a session."""
        return self._snapshot(self._find(session_id))

    def begin_test(self, session_id: str, candidate_id: str) -> dict[str, Any]:
        """Claim the current candidate for one explicit transport send."""
        session = self._find(session_id)
        self._require_status(session, "active")
        if session["pending_test"] is not None:
            raise GuidedSessionError(
                "result_pending",
                "Record the outstanding test result before testing again",
            )

        expected = self._current_candidate(session)
        if expected is None:
            self._complete(session)
            raise GuidedSessionError("session_completed", "The session is complete")
        if candidate_id != expected["candidate_id"]:
            raise GuidedSessionError(
                "unexpected_candidate",
                f"Expected candidate {expected['candidate_id']}",
            )

        now = self._now()
        if now < session["cooldown_until"]:
            remaining = session["cooldown_until"] - now
            raise GuidedSessionError(
                "inter_test_delay",
                f"Wait {remaining:.3f} seconds before the next test",
            )

        session["pending_test"] = {"candidate_id": candidate_id}
        session["cooldown_until"] = now + INTER_TEST_DELAY_SECONDS
        return self._snapshot(session)

    def record_result(
        self,
        session_id: str,
        candidate_id: str,
        result: GuidedResult,
    ) -> dict[str, Any]:
        """Record one user response for the outstanding test."""
        session = self._find(session_id)
        self._require_status(session, "active")
        if result not in _RESULTS:
            raise GuidedSessionError(
                "invalid_result",
                "Result must be worked, no_response, or not_sure",
            )

        pending = session["pending_test"]
        if pending is None:
            raise GuidedSessionError(
                "no_test_pending",
                "Begin the expected candidate test before recording a result",
            )
        if candidate_id != pending["candidate_id"]:
            raise GuidedSessionError(
                "unexpected_candidate",
                f"Expected a result for candidate {pending['candidate_id']}",
            )

        expected = self._current_candidate(session)
        if expected is None or expected["candidate_id"] != candidate_id:
            raise GuidedSessionError(
                "unexpected_candidate",
                "The result does not match the current candidate order",
            )

        session["pending_test"] = None
        if result == "no_response":
            session["current_index"] += 1
            if self._current_candidate(session) is None:
                self._complete(session)
        else:
            session["status"] = "paused"
            session["pause_reason"] = result

        return self._snapshot(session)

    def record_send_failure(
        self,
        session_id: str,
        candidate_id: str,
        message: str,
    ) -> dict[str, Any]:
        """Release a failed send and pause without advancing."""
        session = self._find(session_id)
        self._require_status(session, "active")
        pending = session["pending_test"]
        if pending is None:
            raise GuidedSessionError(
                "no_test_pending",
                "Begin the expected candidate test before recording a send failure",
            )
        if candidate_id != pending["candidate_id"]:
            raise GuidedSessionError(
                "unexpected_candidate",
                f"Expected a send failure for candidate {pending['candidate_id']}",
            )

        session["pending_test"] = None
        session["status"] = "paused"
        session["pause_reason"] = "send_failed"
        session["last_error"] = {"message": _sanitize_error(message)}
        return self._snapshot(session)

    def pause(self, session_id: str) -> dict[str, Any]:
        """Pause an active session without discarding its place."""
        session = self._find(session_id)
        if session["status"] == "paused":
            return self._snapshot(session)
        self._require_status(session, "active")
        if session["pending_test"] is not None:
            raise GuidedSessionError(
                "result_pending",
                "Record the outstanding test result before pausing",
            )
        session["status"] = "paused"
        session["pause_reason"] = "user"
        return self._snapshot(session)

    def resume(self, session_id: str) -> dict[str, Any]:
        """Resume a paused session at the same candidate."""
        session = self._find(session_id)
        if session["status"] == "active":
            return self._snapshot(session)
        self._require_status(session, "paused")
        session["status"] = "active"
        session["pause_reason"] = None
        return self._snapshot(session)

    def cancel(self, session_id: str) -> dict[str, Any]:
        """Cancel a session without sending IR."""
        session = self._find(session_id)
        if session["status"] == "cancelled":
            return self._snapshot(session)
        if session["status"] == "completed":
            raise GuidedSessionError(
                "invalid_session_state",
                "A completed session cannot be cancelled",
            )
        session["status"] = "cancelled"
        session["pause_reason"] = None
        session["pending_test"] = None
        return self._snapshot(session)

    def _find(self, session_id: str) -> dict[str, Any]:
        try:
            return self._sessions[session_id]
        except KeyError as err:
            raise GuidedSessionError(
                "session_not_found",
                f"Guided matching session {session_id!r} was not found",
            ) from err

    @staticmethod
    def _current_candidate(session: Mapping[str, Any]) -> dict[str, Any] | None:
        index = session["current_index"]
        candidates = session["candidates"]
        return candidates[index] if index < len(candidates) else None

    @staticmethod
    def _require_status(session: Mapping[str, Any], expected: str) -> None:
        if session["status"] != expected:
            raise GuidedSessionError(
                "invalid_session_state",
                f"Session is {session['status']}; expected {expected}",
            )

    @staticmethod
    def _complete(session: dict[str, Any]) -> None:
        session["status"] = "completed"
        session["pause_reason"] = None
        session["pending_test"] = None

    def _snapshot(self, session: Mapping[str, Any]) -> dict[str, Any]:
        current = self._current_candidate(session)
        candidates = session["candidates"]
        snapshot = {
            "session_id": session["session_id"],
            "status": session["status"],
            "pause_reason": session["pause_reason"],
            "context": deepcopy(session["context"]),
            "candidates": deepcopy(candidates),
            "current_index": session["current_index"],
            "current_candidate": deepcopy(current),
            "pending_test": deepcopy(session["pending_test"]),
            "progress": {
                "position": min(session["current_index"] + 1, len(candidates)),
                "total": len(candidates),
            },
            "remaining_delay_seconds": max(
                0.0,
                round(session["cooldown_until"] - self._now(), 3),
            ),
        }
        if "last_error" in session:
            snapshot["last_error"] = deepcopy(session["last_error"])
        return snapshot

    def _now(self) -> float:
        return float(self._clock())


def _sanitize_error(message: str) -> str:
    if not isinstance(message, str):
        raise GuidedSessionError(
            "invalid_error", "Send failure message must be a string"
        )
    sanitized = " ".join(message.split()) or "IR send failed"
    return sanitized[:_MAX_ERROR_LENGTH]
