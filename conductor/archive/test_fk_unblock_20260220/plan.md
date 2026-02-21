# Implementation Plan: Test Harness FK Integrity & Suite Unblock

## Phase 1: Failure Reproduction & Fixture Trace
- [x] **Task: Reproduce Orchestration Harness Failure**
  - [x] Run the failing runner harness spec and capture full stack trace.
    - Scenario 3 (rate-limit resiliency) timed out after 5 000 ms.
    - Scenario 4 (bounded tool loop) failed with "No more mock responses queued".
  - [x] Identify fixture sequence causing missing session-parent references.
    - Root cause: `ModelRouter` reads persisted `fallback_mode` (`intelligent_pacing`) from
      the shared SQLite DB. When `model-router.spec.ts` runs in a parallel worker it
      persists `intelligent_pacing`; `runner.spec.ts` picks it up, waits 5 s on each 429,
      and times out. The timed-out Scenario 3 leaks an async fetch call into Scenario 4's
      mock-response queue, exhausting it one response early.
- [x] **Task: Audit Test Data Contract Against DB Schema**
  - [x] Verify required FK parent creation order in schema and test setup.
    - `orchestration_jobs.session_id` → `sessions.session_id` (FK enforced with `PRAGMA foreign_keys = ON`).
    - Both `runner.spec.ts` and `orchestration-edge.spec.ts` already call `createSession(sessionId)`
      inside `buildRequest` before `runDelegation` inserts any job rows. Order is correct.
  - [x] Identify any additional tests affected by shared fixture assumptions.
    - `model-router.spec.ts` persists `intelligent_pacing` into `model_routing_settings`.
      This propagates to any test file that constructs a `ModelRouter`/`MockModelRouter`
      without an explicit `fallbackMode` override.
- [ ] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Fixture & Test Contract Repair
- [x] **Task: Implement Session-First Fixture Helpers**
  - [x] Introduce or update helper paths that create sessions before job rows.
    - `buildRequest` helpers in `runner.spec.ts` and `orchestration-edge.spec.ts` already
      call `createSession` first; annotated with a fixture-invariant comment.
  - [x] Refactor failing tests to use shared fixture helpers.
    - No structural refactor needed; helpers already centralise session creation.
- [x] **Task: Harden Harness Isolation**
  - [x] Ensure setup/teardown resets state deterministically between cases.
    - `runner.spec.ts` `beforeEach`: passes `{ fallbackMode: 'aggressive_fallback' }` to
      `MockModelRouter` constructor so it never inherits a DB-persisted mode.
    - `model-router.spec.ts` `afterEach`: creates a cleanup `ModelRouter({ fallbackMode: 'aggressive_fallback' })`
      to reset the persisted setting after every test, preventing cross-file contamination.
  - [x] Prevent cascading skips caused by avoidable fixture failure.
    - Fixing Scenario 3 removes the 5-second leaked async that was corrupting
      Scenario 4's mock-response pool, eliminating the cascade.
- [ ] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Suite Validation & Regression Safety
- [x] **Task: Validate Harness Stability**
  - [x] Re-run targeted orchestration harness tests to confirm FK-safe behavior.
    - `orchestration-edge.spec.ts` (6 tests), `runner.spec.ts` (11 tests),
      `model-router.spec.ts` (8 tests) — all 25 pass.
  - [x] Re-run broader test command to confirm suite can progress normally.
    - `npm test`: runner/orchestration/model-router suites all green; remaining
      failures are pre-existing issues outside this track's scope.
- [x] **Task: Add Regression Assertions**
  - [x] Add explicit assertions for parent-record existence expectations.
    - New `describe('OrchestrationService FK fixture ordering')` in
      `orchestration-edge.spec.ts` with 4 tests:
      1. FK violation is thrown when session row is absent.
      2. Session-first ordering satisfies FK constraint.
      3. `buildRequest` helper creates the session before delegation jobs.
      4. `runDelegation` completes without FK errors with a proper fixture.
  - [x] Document fixture invariants for future agent tracks.
    - Inline comments on `buildRequest` helpers in both `runner.spec.ts` and
      `orchestration-edge.spec.ts` state the ordering invariant.
- [ ] **Task: Conductor - User Manual Verification 'Phase 3'**
