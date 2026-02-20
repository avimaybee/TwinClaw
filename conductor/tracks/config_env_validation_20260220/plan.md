# Implementation Plan: Configuration & Environment Validation Framework

## Phase 1: Config Surface Inventory
- [ ] **Task: Map Runtime Config Inputs**
  - [ ] Inventory environment/secret keys consumed by startup and interface services.
  - [ ] Classify keys by required, optional, and conditional-by-feature semantics.
- [ ] **Task: Identify Validation Gaps**
  - [ ] Compare `.env.example` against actual runtime key usage.
  - [ ] Identify missing, stale, or inconsistent validation behavior across commands.
- [ ] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Validation & Error UX Hardening
- [ ] **Task: Implement Unified Validation Contracts**
  - [ ] Add or refine typed validation schema for runtime config.
  - [ ] Ensure setup/start/doctor paths consume the same validation layer.
- [ ] **Task: Improve Error Diagnostics**
  - [ ] Emit actionable redaction-safe error messages for invalid/missing config.
  - [ ] Add machine-readable diagnostics payload for automation.
- [ ] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Regression Coverage & Operational Readiness
- [ ] **Task: Add Validation Tests**
  - [ ] Add deterministic tests for required/optional config scenarios.
  - [ ] Validate secret redaction and error classification behavior.
- [ ] **Task: Final Config Readiness Verification**
  - [ ] Validate setup + startup paths under representative environment matrices.
  - [ ] Publish final key contract summary for operators.
- [ ] **Task: Conductor - User Manual Verification 'Phase 3'**
