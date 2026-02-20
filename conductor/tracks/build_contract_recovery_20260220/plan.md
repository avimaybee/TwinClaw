# Implementation Plan: Build Contract Recovery & Compile Unblock

## Phase 1: Compile Failure Reproduction & Contract Trace
- [ ] **Task: Capture Build Failure Baseline**
  - [ ] Run TypeScript build and capture exact failing diagnostics.
  - [ ] Trace failing symbols to owning tracks and current source contracts.
- [ ] **Task: Validate Target Contract Surfaces**
  - [ ] Map current `assembleContext` signature and callers.
  - [ ] Map `better-sqlite3` typing pattern used across repository.
- [ ] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Contract & Type Fix Implementation
- [ ] **Task: Patch Onboarding Context Assembly Usage**
  - [ ] Update onboarding context assembly call path to current signature.
  - [ ] Add explicit typing for onboarding message/context values where needed.
- [ ] **Task: Patch Secret Vault Database Typing**
  - [ ] Replace invalid namespace-style `Database` type usages with proper imported types.
  - [ ] Ensure helper signatures stay aligned with existing DB abstractions.
- [ ] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Build Gate Verification & Regression Guard
- [ ] **Task: Verify Compile Health**
  - [ ] Re-run `npm run build` and confirm zero TypeScript compile errors.
  - [ ] Spot-check impacted runtime paths for onboarding and secret preflight startup.
- [ ] **Task: Add Regression Guardrails**
  - [ ] Add or update tests covering affected contracts.
  - [ ] Capture final validation summary for downstream tracks.
- [ ] **Task: Conductor - User Manual Verification 'Phase 3'**
