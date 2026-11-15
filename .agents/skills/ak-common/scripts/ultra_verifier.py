"""Deterministic validation helpers for the ``ak.ultra/v1`` envelope.

The module deliberately does not dispatch agents, run candidate text, or make
network calls. It validates an already-collected evidence packet and chooses an
unchanged winner only when the contract is satisfied.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Iterable

PROTOCOL = "ak.ultra/v1"
RUBRIC_VERSION = "ultra-v1"
RUBRIC_WEIGHTS = {
    "contract": 20,
    "evidence": 20,
    "safety_scope": 20,
    "feasibility_portability": 15,
    "verification_rollback": 15,
    "clarity": 10,
}
DEFAULT_LIMITS = {
    "candidate_count": 5,
    "max_redispatch": 1,
    "max_debate_rounds": 2,
    "candidate_timeout_seconds": 900,
    "verifier_timeout_seconds": 900,
}
MIN_USABLE_CANDIDATES = 3
ALLOWED_VERIFIER_VETOES = frozenset({
    "candidate_not_read_only",
    "candidate_self_approval_or_unproven",
    "missing_rollback",
    "peer_output_visible_or_unproven",
    "scope_drift",
    "secret_leak",
    "unsafe_path",
    "unsupported_claim",
})
_SECRET_PATTERNS = (
    re.compile(
        r"(?i)\b(?:api[_ -]?key|access[_ -]?token|auth[_ -]?token|token|password|cookie|secret|private[_ -]?key|"
        r"signing[_ -]?key|client[_ -]?secret|authorization|credential)"
        r"\s*[:=]\s*[^\s,;]+"
    ),
    re.compile(
        r"(?i)\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|COOKIE|AUTH|CREDENTIAL)[A-Z0-9_]*"
        r"\s*[:=]\s*[^\s,;]+"
    ),
    # The scheme itself is sensitive; short fixture/proxy values must not
    # bypass redaction through a length heuristic.
    re.compile(r"(?i)\bbearer\s+[^\s,;]+"),
    re.compile(r"(?is)-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----.*?-----END [A-Z0-9 ]*PRIVATE KEY-----"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\b(?:xox[baprs]-)[A-Za-z0-9-]{12,}\b"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"),
    re.compile(r"\b(?:sk|ak|xai|ghp|AIza)[-_A-Za-z0-9]{12,}\b"),
)
SAFE_METADATA_KEYS = frozenset({
    "route",
    "model",
    "model_family",
    "version",
    "auth_state",
    "provider",
    "runtime",
    "status",
    "reasoning_effort",
})
# Candidate prose is untrusted.  Detect path escapes wherever a path token
# occurs in a string, not only when the token is the first character.  The
# POSIX branch deliberately ignores URL schemes (`https://`) while still
# rejecting absolute paths such as `/tmp/file`.
_UNSAFE_PATH = re.compile(
    r"(?i)(?<![A-Za-z0-9_])(?:[A-Za-z]:[\\/]|\\\\|~[\\/])"
    r"|(?<![A-Za-z0-9_])[A-Za-z]:[^\s/\\]"
    r"|(?<![A-Za-z0-9_])\\(?!\\)"
    r"|(?<![A-Za-z0-9_:])//"
    r"|(?:^|[\\/])\.\.(?:[\\/]|$)"
    r"|(?:^|[\s\"'`([{,:;=!?])/(?![/\s])"
)
_UNSUPPORTED_CLAIM = re.compile(r"(?i)\b(?:production[- ]ready|native\s+8\s+runtime|guaranteed|always\s+works)\b")


def canonical_json(value: Any) -> bytes:
    """Serialize JSON deterministically for evidence hashing."""

    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def evidence_digest(evidence: Any) -> str:
    return hashlib.sha256(canonical_json(evidence)).hexdigest()


def _walk_strings(value: Any) -> Iterable[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for key, child in value.items():
            yield from _walk_strings(key)
            yield from _walk_strings(child)
    elif isinstance(value, (list, tuple)):
        for child in value:
            yield from _walk_strings(child)


def _contains_secret(value: str) -> bool:
    """Detect credential material even when it appears in an unknown field."""

    return any(pattern.search(value) for pattern in _SECRET_PATTERNS)


def hard_vetoes(candidate: dict[str, Any]) -> list[str]:
    """Return deterministic safety vetoes without interpreting prose as code."""

    vetoes: list[str] = []
    if candidate.get("read_only") is not True:
        vetoes.append("candidate_not_read_only")
    if candidate.get("peer_output_visible") is not False:
        vetoes.append("peer_output_visible_or_unproven")
    if candidate.get("self_approved") is not False:
        vetoes.append("candidate_self_approval_or_unproven")
    if candidate.get("scope_drift") is True:
        vetoes.append("scope_drift")
    if candidate.get("missing_rollback") is True:
        vetoes.append("missing_rollback")
    if candidate.get("unsupported_claim") is True:
        vetoes.append("unsupported_claim")
    for text in _walk_strings(candidate):
        if _contains_secret(text):
            vetoes.append("secret_leak")
        if _UNSAFE_PATH.search(text):
            vetoes.append("unsafe_path")
        if _UNSUPPORTED_CLAIM.search(text):
            vetoes.append("unsupported_claim")
    return sorted(set(vetoes))


def redact_metadata(metadata: dict[str, Any] | None) -> dict[str, Any]:
    """Keep route/model/version/auth state while dropping credential material."""

    if not metadata:
        return {}
    blocked = re.compile(r"(?i)(token|secret|password|cookie|api[_-]?key|authorization|credential|env)")
    redacted: dict[str, Any] = {}
    for key, value in metadata.items():
        key_text = str(key)
        if blocked.search(key_text) or key_text not in SAFE_METADATA_KEYS:
            redacted[str(key)] = "<redacted>"
        elif isinstance(value, str) and _contains_secret(value):
            redacted[str(key)] = "<redacted>"
        elif isinstance(value, (str, int, float, bool)) or value is None:
            redacted[str(key)] = value
        else:
            redacted[str(key)] = "<redacted>"
    return redacted


def _error(errors: list[str], code: str) -> None:
    if code not in errors:
        errors.append(code)


def validate_packet(packet: Any) -> list[str]:
    """Validate shape and bounds; return stable machine-readable error codes."""

    errors: list[str] = []
    if not isinstance(packet, dict):
        return ["packet_not_object"]
    if packet.get("protocol") != PROTOCOL:
        _error(errors, "invalid_protocol")
    skill = packet.get("skill")
    if not isinstance(skill, str) or not re.fullmatch(r"ak:[a-z0-9][a-z0-9-]*", skill):
        _error(errors, "invalid_skill")
    evidence = packet.get("evidence")
    if not isinstance(evidence, dict):
        _error(errors, "missing_evidence_provenance" if "evidence" not in packet else "invalid_evidence_packet")
    digest = packet.get("evidence_sha256")
    if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
        _error(errors, "invalid_evidence_digest")
    elif isinstance(evidence, dict) and evidence_digest(evidence) != digest:
        _error(errors, "evidence_digest_mismatch")
    limits = packet.get("limits")
    if not isinstance(limits, dict):
        _error(errors, "missing_limits")
        limits = {}
    for key, default in DEFAULT_LIMITS.items():
        value = limits.get(key, default)
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            _error(errors, f"invalid_limit:{key}")
        elif key.endswith("timeout_seconds") and value > default:
            _error(errors, f"timeout_limit_exceeded:{key}")
    if limits.get("candidate_count", DEFAULT_LIMITS["candidate_count"]) != DEFAULT_LIMITS["candidate_count"]:
        _error(errors, "candidate_count_must_equal_five")
    if limits.get("max_redispatch", DEFAULT_LIMITS["max_redispatch"]) > 1:
        _error(errors, "redispatch_limit_exceeded")
    if limits.get("max_debate_rounds", DEFAULT_LIMITS["max_debate_rounds"]) > 2:
        _error(errors, "debate_round_limit_exceeded")
    candidates = packet.get("candidates")
    if not isinstance(candidates, list):
        _error(errors, "missing_candidates")
        candidates = []
    if len(candidates) != DEFAULT_LIMITS["candidate_count"]:
        _error(errors, "candidate_count_mismatch")
    ids: set[str] = set()
    redispatch_total = 0
    expected_digest = digest if isinstance(digest, str) else ""
    for index, candidate in enumerate(candidates):
        prefix = f"candidate:{index}"
        if not isinstance(candidate, dict):
            _error(errors, f"{prefix}:not_object")
            continue
        candidate_id = candidate.get("id")
        if not isinstance(candidate_id, str) or not re.fullmatch(r"c[0-9]+", candidate_id):
            _error(errors, f"{prefix}:invalid_id")
        elif candidate_id in ids:
            _error(errors, f"duplicate_candidate_id:{candidate_id}")
        else:
            ids.add(candidate_id)
        if candidate.get("evidence_sha256") != expected_digest:
            _error(errors, f"{prefix}:evidence_mismatch")
        redispatch = candidate.get("redispatch_count", 0)
        if not isinstance(redispatch, int) or isinstance(redispatch, bool) or redispatch < 0 or redispatch > 1:
            _error(errors, f"{prefix}:redispatch_limit")
        elif redispatch > limits.get("max_redispatch", DEFAULT_LIMITS["max_redispatch"]):
            _error(errors, f"{prefix}:redispatch_limit_exceeded")
        elif redispatch:
            if candidate.get("status") not in {"timeout", "error", "failed"}:
                _error(errors, f"{prefix}:redispatch_requires_failure_status")
            redispatch_total += redispatch
        vetoes = hard_vetoes(candidate)
        for veto in vetoes:
            # Report vetoes without annotating/mutating untrusted candidate data.
            _error(errors, f"{prefix}:hard_veto:{veto}")
        # Candidate-controlled data must never own verifier scores or verdicts.
        # Packet builders store candidate prose under `proposal`; reserved
        # top-level fields are rejected instead of being trusted.
        for reserved in ("rubric", "score", "verdict", "winner_id", "assessments"):
            if reserved in candidate:
                _error(errors, f"{prefix}:reserved_field:{reserved}")
    if redispatch_total > limits.get("max_redispatch", DEFAULT_LIMITS["max_redispatch"]):
        _error(errors, "redispatch_limit_exceeded_total")
    verifier = packet.get("verifier")
    if not isinstance(verifier, dict):
        _error(errors, "missing_verifier")
    else:
        if verifier.get("rubric_version") != RUBRIC_VERSION:
            _error(errors, "invalid_rubric_version")
        verdict = verifier.get("verdict")
        if verdict not in {"ACCEPT", "REJECT_ALL", "INCONCLUSIVE"}:
            _error(errors, "invalid_verdict")
        winner = verifier.get("winner_id")
        if winner is not None and winner not in ids:
            _error(errors, "winner_not_candidate")
        if verdict in {"REJECT_ALL", "INCONCLUSIVE"} and winner is not None:
            _error(errors, "non_accept_verdict_has_winner")
        if verdict == "ACCEPT" and winner is None:
            _error(errors, "accept_verdict_missing_winner")
        assessments = verifier.get("assessments")
        if not isinstance(assessments, dict):
            _error(errors, "missing_verifier_assessments")
            assessments = {}
        usable_ids = {
            candidate.get("id")
            for candidate in candidates
            if isinstance(candidate, dict) and candidate.get("status") in {"usable", "complete"}
        }
        if set(assessments) != usable_ids:
            _error(errors, "verifier_assessment_candidate_mismatch")
        for candidate_id, assessment in assessments.items():
            prefix = f"verifier:assessment:{candidate_id}"
            if not isinstance(assessment, dict):
                _error(errors, f"{prefix}:not_object")
                continue
            rubric = assessment.get("rubric")
            if not isinstance(rubric, dict):
                _error(errors, f"{prefix}:missing_rubric")
            else:
                for key, weight in RUBRIC_WEIGHTS.items():
                    score = rubric.get(key)
                    if not isinstance(score, (int, float)) or isinstance(score, bool) or not 0 <= score <= weight:
                        _error(errors, f"{prefix}:invalid_score:{key}")
                if all(isinstance(rubric.get(key), (int, float)) and not isinstance(rubric.get(key), bool) for key in RUBRIC_WEIGHTS):
                    computed = sum(float(rubric[key]) for key in RUBRIC_WEIGHTS)
                    supplied = assessment.get("score", computed)
                    if not isinstance(supplied, (int, float)) or abs(float(supplied) - computed) > 1e-9:
                        _error(errors, f"{prefix}:score_mismatch")
            vetoes = assessment.get("vetoes")
            if not isinstance(vetoes, list):
                _error(errors, f"{prefix}:missing_vetoes")
            else:
                for veto in vetoes:
                    if veto not in ALLOWED_VERIFIER_VETOES:
                        _error(errors, f"{prefix}:invalid_veto:{veto}")
                    else:
                        _error(errors, f"{prefix}:hard_veto:{veto}")
    return errors


def evaluate_packet(packet: dict[str, Any]) -> dict[str, Any]:
    """Return a verdict and unchanged winner reference, never blended output."""

    errors = validate_packet(packet)
    candidates = packet.get("candidates", []) if isinstance(packet, dict) else []
    verifier = packet.get("verifier", {}) if isinstance(packet, dict) else {}
    assessments = verifier.get("assessments", {}) if isinstance(verifier, dict) else {}
    usable: list[dict[str, Any]] = []
    for candidate in candidates if isinstance(candidates, list) else []:
        if not isinstance(candidate, dict) or candidate.get("status") not in {"usable", "complete"}:
            continue
        if hard_vetoes(candidate):
            continue
        assessment = assessments.get(candidate.get("id")) if isinstance(assessments, dict) else None
        if not isinstance(assessment, dict) or assessment.get("vetoes"):
            continue
        rubric = assessment.get("rubric")
        if not isinstance(rubric, dict):
            continue
        score = sum(float(rubric.get(key, -1)) for key in RUBRIC_WEIGHTS)
        if score < 0:
            continue
        usable.append({"id": candidate.get("id"), "score": score, "candidate": candidate})
    fatal_errors = [error for error in errors if ":hard_veto:" not in error]
    if fatal_errors:
        # Structural/provenance failures cannot be scored or repaired by the
        # verifier. Keep the packet and candidate text untouched for diagnosis.
        verdict = "INCONCLUSIVE"
        winner = None
    elif len(usable) < MIN_USABLE_CANDIDATES:
        verdict = "INCONCLUSIVE"
        winner = None
    else:
        ranked = sorted(usable, key=lambda item: (-item["score"], str(item["id"])))
        top, second = ranked[0], ranked[1]
        if top["score"] < 70 or top["score"] - second["score"] < 5:
            verdict = "REJECT_ALL"
            winner = None
        else:
            verdict = "ACCEPT"
            winner = top["id"]
    return {
        "protocol": PROTOCOL,
        "verdict": verdict,
        "winner_id": winner,
        "usable_count": len(usable),
        "errors": errors,
        "rubric_version": RUBRIC_VERSION,
    }


__all__ = [
    "ALLOWED_VERIFIER_VETOES",
    "DEFAULT_LIMITS",
    "MIN_USABLE_CANDIDATES",
    "PROTOCOL",
    "RUBRIC_VERSION",
    "RUBRIC_WEIGHTS",
    "canonical_json",
    "evidence_digest",
    "evaluate_packet",
    "hard_vetoes",
    "redact_metadata",
    "validate_packet",
]
