# Specification: Reliability, Replay Evaluation & Guardrail Test Harness

## Overview
This track adds a reproducible evaluation harness that replays transcripts, stress-tests failover paths, and verifies safety guardrails so new features can ship without destabilizing the runtime.

## Requirements
- Build a transcript replay runner for deterministic regression checks across gateway and tool-call flows.
- Add failover evaluation scenarios for model routing, MCP availability loss, and tool execution errors.
- Define and automate guardrail checks for sensitive output scrubbing and bounded tool execution loops.
- Produce machine-readable evaluation reports suitable for CI and local smoke runs.
- Ensure failures identify exact scenario, subsystem, and breakage reason.

## Technical Mandates
- Reuse existing persistence/transcript sources; do not invent parallel logging stores.
- Keep scenario fixtures versioned and deterministic for reproducible results.
- Avoid broad exception swallowing; test harness must surface actionable errors.
- Integrate with current test tooling rather than introducing a separate framework.
