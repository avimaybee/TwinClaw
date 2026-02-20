# Implementation Plan: Test Harness FK Integrity & Suite Unblock

## Phase 1: Failure Reproduction & Fixture Trace
- [ ] **Task: Reproduce Orchestration Harness Failure**
  - [ ] Run the failing runner harness spec and capture full stack trace.
  - [ ] Identify fixture sequence causing missing session-parent references.
- [ ] **Task: Audit Test Data Contract Against DB Schema**
  - [ ] Verify required FK parent creation order in schema and test setup.
  - [ ] Identify any additional tests affected by shared fixture assumptions.
- [ ] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Fixture & Test Contract Repair
- [ ] **Task: Implement Session-First Fixture Helpers**
  - [ ] Introduce or update helper paths that create sessions before job rows.
  - [ ] Refactor failing tests to use shared fixture helpers.
- [ ] **Task: Harden Harness Isolation**
  - [ ] Ensure setup/teardown resets state deterministically between cases.
  - [ ] Prevent cascading skips caused by avoidable fixture failure.
- [ ] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Suite Validation & Regression Safety
- [ ] **Task: Validate Harness Stability**
  - [ ] Re-run targeted orchestration harness tests to confirm FK-safe behavior.
  - [ ] Re-run broader test command to confirm suite can progress normally.
- [ ] **Task: Add Regression Assertions**
  - [ ] Add explicit assertions for parent-record existence expectations.
  - [ ] Document fixture invariants for future agent tracks.
- [ ] **Task: Conductor - User Manual Verification 'Phase 3'**
