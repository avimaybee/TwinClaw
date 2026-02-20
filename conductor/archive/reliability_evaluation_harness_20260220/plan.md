# Implementation Plan: Reliability, Replay Evaluation & Guardrail Test Harness

## Phase 1: Replay Harness Foundation
- [x] **Task: Define Replay Scenario Format**
  - [x] Create fixture format for transcript turns, expected tool calls, and assertions.
  - [x] Add loader utilities for selecting scenario packs.
- [x] **Task: Implement Replay Runner**
  - [x] Execute scenarios through gateway loop with deterministic mocks where needed.
  - [x] Capture structured pass/fail artifacts and diff details.
- [x] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Failover & Resilience Scenarios
- [x] **Task: Add Router Failover Scenarios**
  - [x] Simulate provider rate limits and transport failures.
  - [x] Assert fallback behavior and final response continuity.
- [x] **Task: Add Skill/MCP Degradation Scenarios**
  - [x] Simulate MCP unavailability and tool execution failures.
  - [x] Assert graceful degradation and explicit surfaced diagnostics.
- [x] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Guardrail Assertions & CI Output
- [x] **Task: Add Guardrail Checks**
  - [x] Validate output scrubbing and bounded tool-round limits.
  - [x] Assert sensitive token redaction in logs/transcripts.
- [x] **Task: CI-Friendly Reporting**
  - [x] Emit summary JSON + readable console report per run.
  - [x] Add npm script wiring for local and CI usage.
- [x] **Task: Conductor - User Manual Verification 'Phase 3'**
