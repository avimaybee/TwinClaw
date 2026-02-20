# Implementation Plan: Persona Source-of-Truth Sync & Profile State Management

## Phase 1: Persona Contracts & Safe Persistence
- [x] **Task: Define Persona State Contracts**
  - [x] Define typed DTOs for `soul.md`, `identity.md`, and `user.md` payloads.
  - [x] Define validation and explicit error envelope rules for persona updates.
- [x] **Task: Implement Safe Persona Persistence**
  - [x] Add staged-write helpers with backup/rollback behavior for markdown identity files.
  - [x] Add audit logging for every persona mutation path.
- [x] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Control Plane API & GUI Integration
- [x] **Task: Add Persona Control Plane Endpoints**
  - [x] Add read/update routes for persona state with input validation and deterministic status codes.
  - [x] Add diagnostics payloads for save outcome and validation hints.
- [x] **Task: Wire Live GUI Persona Editor**
  - [x] Replace placeholder persona panel with API-backed load/save behavior.
  - [x] Add save status indicators, inline validation messaging, and retry-safe UX.
- [x] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Hardening & Deterministic Tests
- [x] **Task: Add Regression Tests**
  - [x] Add tests for API validation, failed-write rollback, and success persistence paths.
  - [x] Add GUI tests for initial persona load, edit/save, and error handling.
- [x] **Task: Add Reliability Safeguards**
  - [x] Add protections against concurrent overwrite races and stale write attempts.
  - [x] Add diagnostics coverage for persona update failures and recovery outcomes.
- [x] **Task: Conductor - User Manual Verification 'Phase 3'**
