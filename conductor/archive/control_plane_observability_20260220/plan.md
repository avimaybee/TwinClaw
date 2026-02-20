# Implementation Plan: Control Plane Observability & Callback Idempotency

## Phase 1: Callback Idempotency Contract
- [x] **Task: Define Callback Idempotency Keys**
  - [x] Define deterministic key derivation for callback event identity.
  - [x] Define duplicate handling behavior and response contract.
- [x] **Task: Persist Callback Receipts**
  - [x] Add callback receipt table and persistence helpers.
  - [x] Record accepted, rejected, and duplicate callback outcomes.
- [x] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Handler & Middleware Integration
- [x] **Task: Integrate Idempotency in Callback Handler**
  - [x] Reject or short-circuit duplicates without reprocessing downstream.
  - [x] Preserve current success/error envelope semantics.
- [x] **Task: Add Structured Request Correlation**
  - [x] Inject correlation IDs into request logs and callback receipt records.
  - [x] Surface correlation IDs in error responses for operator troubleshooting.
- [x] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Observability Surfaces & Tests
- [x] **Task: Expose Callback Reliability Metrics**
  - [x] Add summary metrics endpoint output for callback throughput/outcomes.
  - [x] Include duplicate and invalid signature counters.
- [x] **Task: Add API/Callback Test Coverage**
  - [x] Add unit/integration tests for idempotency, signature checks, and diagnostics.
  - [x] Validate backward compatibility for existing control-plane endpoints.
- [x] **Task: Conductor - User Manual Verification 'Phase 3'**
