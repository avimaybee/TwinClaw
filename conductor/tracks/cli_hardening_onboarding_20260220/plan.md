# Implementation Plan: CLI Hardening, User Onboarding & "Doctor" Diagnostics

## Phase 1: Diagnostics Command Foundation
- [x] **Task: Add Doctor Check Contracts**
  - [x] Define typed checks for binaries, env vars, filesystem paths, and service endpoints.
  - [x] Define severity levels and remediation message schema.
- [x] **Task: Implement Doctor Runner**
  - [x] Execute checks and emit summary status + structured details.
  - [x] Add machine-readable output mode for automation.
- [x] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Guided Onboarding Flow
- [x] **Task: Add Onboarding Prompt Workflow**
  - [x] Add guided setup prompts for required runtime integrations.
  - [x] Validate and persist config safely with rerunnable behavior.
- [x] **Task: Add Setup Validation**
  - [x] Integrate doctor checks as preflight before finalizing onboarding.
  - [x] Provide explicit actionable remediation for invalid configuration.
- [x] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: CLI Hardening & Test Coverage
- [x] **Task: Harden CLI Command UX**
  - [x] Standardize error/help output and non-zero exit semantics.
  - [x] Add guardrails for unsupported or unsafe command invocations.
- [x] **Task: Add Deterministic Tests**
  - [x] Add tests for doctor check outcomes and onboarding validation logic.
  - [x] Add regression tests for CLI error messaging and exit behavior.
- [x] **Task: Conductor - User Manual Verification 'Phase 3'**

