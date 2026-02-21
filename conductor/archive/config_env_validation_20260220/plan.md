# Implementation Plan: Configuration & Environment Validation Framework

## Phase 1: Config Surface Inventory
- [x] **Task: Map Runtime Config Inputs**
  - [x] Inventory environment/secret keys consumed by startup and interface services.
  - [x] Classify keys by required, optional, and conditional-by-feature semantics.
- [x] **Task: Identify Validation Gaps**
  - [x] Compare `.env.example` against actual runtime key usage.
  - [x] Identify missing, stale, or inconsistent validation behavior across commands.
- [x] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Validation & Error UX Hardening
- [x] **Task: Implement Unified Validation Contracts**
  - [x] Add or refine typed validation schema for runtime config.
  - [x] Ensure setup/start/doctor paths consume the same validation layer.
- [x] **Task: Improve Error Diagnostics**
  - [x] Emit actionable redaction-safe error messages for invalid/missing config.
  - [x] Add machine-readable diagnostics payload for automation.
- [x] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Regression Coverage & Operational Readiness
- [x] **Task: Add Validation Tests**
  - [x] Add deterministic tests for required/optional config scenarios.
  - [x] Validate secret redaction and error classification behavior.
- [x] **Task: Final Config Readiness Verification**
  - [x] Validate setup + startup paths under representative environment matrices.
  - [x] Publish final key contract summary for operators.
- [x] **Task: Conductor - User Manual Verification 'Phase 3'**
