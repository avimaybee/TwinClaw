# Implementation Plan: Runtime Health, Doctor & Readiness Surfaces

## Phase 1: Health Contract Definition
- [ ] **Task: Define Core Health/Readiness Checks**
  - [ ] Define checks for config validity, DB availability, queue state, and interface adapters.
  - [ ] Define severity model and readiness aggregation rules.
- [ ] **Task: Map Current Observability Inputs**
  - [ ] Inventory existing heartbeat/incident/health data sources.
  - [ ] Map reusable status signals for CLI and API exposure.
- [ ] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Doctor & Readiness Implementation
- [ ] **Task: Implement Doctor Runtime Checks**
  - [ ] Wire checks into CLI doctor and startup preflight flows.
  - [ ] Add actionable remediation output per failed check.
- [ ] **Task: Expose Readiness Surfaces**
  - [ ] Extend control-plane API payloads with unified readiness state.
  - [ ] Ensure GUI/CLI consumers can render health and degraded-state details.
- [ ] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Validation & Operator UX Finalization
- [ ] **Task: Add Deterministic Health Tests**
  - [ ] Add tests for healthy, degraded, and hard-fail paths.
  - [ ] Validate redaction-safe diagnostics in all outputs.
- [ ] **Task: Verify End-to-End Diagnostic Flow**
  - [ ] Validate installation -> doctor -> start runtime sequence.
  - [ ] Capture operator checklist for MVP launch readiness.
- [ ] **Task: Conductor - User Manual Verification 'Phase 3'**
