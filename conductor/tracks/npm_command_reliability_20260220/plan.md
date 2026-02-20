# Implementation Plan: NPM Command Reliability Matrix & Script Repair

## Phase 1: Script Inventory & Failure Baseline
- [ ] **Task: Enumerate Script Surface**
  - [ ] Inventory root and subproject npm scripts with expected behavior.
  - [ ] Classify scripts by criticality (build/test/runtime/release/tooling).
- [ ] **Task: Capture Script Failure Baseline**
  - [ ] Run command matrix and capture reproducible failures.
  - [ ] Identify missing dependencies, invalid flags, and environment assumptions.
- [ ] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Script & Toolchain Repair
- [ ] **Task: Patch Broken Scripts**
  - [ ] Fix script definitions and command wiring causing startup/build/test failures.
  - [ ] Align script behavior with current source layout and release workflow.
- [ ] **Task: Add Deterministic Command Health Output**
  - [ ] Provide machine-readable summary of command pass/fail state.
  - [ ] Ensure failures emit actionable remediation hints.
- [ ] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: End-to-End Command Verification
- [ ] **Task: Validate Critical Command Matrix**
  - [ ] Verify clean success path for high-priority npm commands.
  - [ ] Validate fallback handling where optional dependencies are absent.
- [ ] **Task: Publish Reliability Baseline**
  - [ ] Record final script reliability state for operations and release gate.
  - [ ] Hand off any residual non-critical items to backlog tracks.
- [ ] **Task: Conductor - User Manual Verification 'Phase 3'**
