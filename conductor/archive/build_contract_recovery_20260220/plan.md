# Implementation Plan: Build Contract Recovery & Compile Unblock

## Phase 1: Compile Failure Reproduction & Contract Trace
- [x] **Task: Capture Build Failure Baseline**
  - [x] Run TypeScript build and capture exact failing diagnostics.
  - [x] Trace failing symbols to owning tracks and current source contracts.
- [x] **Task: Validate Target Contract Surfaces**
  - [x] Map current `assembleContext` signature and callers.
  - [x] Map `better-sqlite3` typing pattern used across repository.
- [x] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Contract & Type Fix Implementation
- [x] **Task: Patch Onboarding Context Assembly Usage**
  - [x] Update onboarding context assembly call path to current signature.
  - [x] Add explicit typing for onboarding message/context values where needed.
- [x] **Task: Patch Secret Vault Database Typing**
  - [x] Replace invalid namespace-style `Database` type usages with proper imported types.
  - [x] Ensure helper signatures stay aligned with existing DB abstractions.
- [x] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Build Gate Verification & Regression Guard
- [x] **Task: Verify Compile Health**
  - [x] Re-run `npm run build` and confirm zero TypeScript compile errors.
  - [x] Spot-check impacted runtime paths for onboarding and secret preflight startup.
- [x] **Task: Add Regression Guardrails**
  - [x] Add or update tests covering affected contracts.
  - [x] Capture final validation summary for downstream tracks.
- [x] **Task: Conductor - User Manual Verification 'Phase 3'**
