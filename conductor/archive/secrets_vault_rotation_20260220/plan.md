# Implementation Plan: Secrets Vault, Rotation & Runtime Redaction Policy

## Phase 1: Secret Registry Foundation
- [x] **Task: Define Secret Metadata Contracts**
  - [x] Add typed schema for secret descriptors and lifecycle state.
  - [x] Add validation for required scopes and expiration windows.
- [x] **Task: Implement Secret Service**
  - [x] Add centralized secret set/get/list/revoke operations.
  - [x] Add audit event emission for secret lifecycle actions.
- [x] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Rotation & Runtime Enforcement
- [x] **Task: Add Rotation Workflow**
  - [x] Implement atomic rotate with fallback semantics.
  - [x] Add expiry checks and warning thresholds.
- [x] **Task: Add Runtime Redaction Layer**
  - [x] Redact secrets from logs, diagnostics, and prompt traces.
  - [x] Add startup preflight guard for required secrets.
- [x] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Coverage & Hardening
- [x] **Task: Add Deterministic Tests**
  - [x] Add unit tests for rotation, expiry gating, and revoke behavior.
  - [x] Add integration tests for redaction in callback/queue logs.
- [x] **Task: Add Operational Diagnostics**
  - [x] Add doctor checks for secret health and rotation status.
  - [x] Add actionable remediation output for failures.
- [x] **Task: Conductor - User Manual Verification 'Phase 3'**
