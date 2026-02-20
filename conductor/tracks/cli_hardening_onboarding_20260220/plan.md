# Implementation Plan: CLI Hardening, User Onboarding & "Doctor" Diagnostics

## Phase 1: Diagnostics Command Foundation
- [ ] **Task: Add Doctor Check Contracts**
  - [ ] Define typed checks for binaries, env vars, filesystem paths, and service endpoints.
  - [ ] Define severity levels and remediation message schema.
- [ ] **Task: Implement Doctor Runner**
  - [ ] Execute checks and emit summary status + structured details.
  - [ ] Add machine-readable output mode for automation.
- [ ] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Guided Onboarding Flow
- [ ] **Task: Add Onboarding Prompt Workflow**
  - [ ] Add guided setup prompts for required runtime integrations.
  - [ ] Validate and persist config safely with rerunnable behavior.
- [ ] **Task: Add Setup Validation**
  - [ ] Integrate doctor checks as preflight before finalizing onboarding.
  - [ ] Provide explicit actionable remediation for invalid configuration.
- [ ] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: CLI Hardening & Test Coverage
- [ ] **Task: Harden CLI Command UX**
  - [ ] Standardize error/help output and non-zero exit semantics.
  - [ ] Add guardrails for unsupported or unsafe command invocations.
- [ ] **Task: Add Deterministic Tests**
  - [ ] Add tests for doctor check outcomes and onboarding validation logic.
  - [ ] Add regression tests for CLI error messaging and exit behavior.
- [ ] **Task: Conductor - User Manual Verification 'Phase 3'**
