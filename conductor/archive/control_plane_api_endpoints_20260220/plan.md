# Implementation Plan: Control Plane HTTP API & Webhook Callback Layer

## Phase 1: API Surface & Contracts
- [x] **Task: Define Endpoint Contracts**
  - [x] Define request/response schemas for `/health`, `/browser/snapshot`, and `/browser/click`.
  - [x] Define callback payload contract and authentication expectations.
- [x] **Task: Scaffold Router + Handlers**
  - [x] Add thin route bindings and dedicated handler modules.
  - [x] Reuse shared response formatting and error mapping utilities.
- [x] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Service Integration
- [x] **Task: Wire Browser Endpoints**
  - [x] Route snapshot/click actions through the existing browser service.
  - [x] Return deterministic references needed for follow-up click actions.
- [x] **Task: Wire Callback Endpoint**
  - [x] Validate callback signature and payload integrity.
  - [x] Forward completion events into gateway/session state updates.
- [x] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Hardening & Tests
- [x] **Task: Add Error-Path Hardening**
  - [x] Enforce schema validation, auth failures, and standardized status codes.
  - [x] Add structured operational logging for all endpoint outcomes.
- [x] **Task: Add API Test Coverage**
  - [x] Add tests for happy path, invalid payloads, and unauthorized callbacks.
  - [x] Add smoke tests for browser endpoint integration contracts.
- [x] **Task: Conductor - User Manual Verification 'Phase 3'**
