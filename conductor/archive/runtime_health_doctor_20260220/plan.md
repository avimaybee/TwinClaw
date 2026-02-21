# Implementation Plan: Runtime Health, Doctor & Readiness Surfaces

## Phase 1: Health Contract Definition
- [x] **Task: Define Core Health/Readiness Checks**
  - [x] Define checks for config validity, DB availability, queue state, and interface adapters.
  - [x] Define severity model and readiness aggregation rules.
- [x] **Task: Map Current Observability Inputs**
  - [x] Inventory existing heartbeat/incident/health data sources.
  - [x] Map reusable status signals for CLI and API exposure.
- [x] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Doctor & Readiness Implementation
- [x] **Task: Implement Doctor Runtime Checks**
  - [x] Wire checks into CLI doctor and startup preflight flows.
  - [x] Add actionable remediation output per failed check.
- [x] **Task: Expose Readiness Surfaces**
  - [x] Extend control-plane API payloads with unified readiness state.
  - [x] Ensure GUI/CLI consumers can render health and degraded-state details.
- [x] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Validation & Operator UX Finalization
- [x] **Task: Add Deterministic Health Tests**
  - [x] Add tests for healthy, degraded, and hard-fail paths.
  - [x] Validate redaction-safe diagnostics in all outputs.
- [x] **Task: Verify End-to-End Diagnostic Flow**
  - [x] Validate installation -> doctor -> start runtime sequence.
  - [x] Capture operator checklist for MVP launch readiness.
- [x] **Task: Conductor - User Manual Verification 'Phase 3'**
