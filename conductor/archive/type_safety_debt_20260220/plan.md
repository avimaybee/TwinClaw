# Implementation Plan: Type Safety Debt Burn-Down (Strict TS Compliance)

## Phase 1: Type Debt Inventory & Contract Mapping
- [x] **Task: Validate `any` Inventory**
  - [x] Confirm and localize all outstanding `any` usages from the audit report.
  - [x] Group usages by domain (delivery queue, DB rows, onboarding, runtime UI).
- [x] **Task: Map Existing Reusable Types**
  - [x] Identify existing shared interfaces and helper type guards.
  - [x] Define any missing minimal type contracts for uncovered shapes.
- [x] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Refactor to Strict Types
- [x] **Task: Type Delivery Queue & DB Paths**
  - [x] Replace untyped delivery-query return values with explicit row/result types.
  - [x] Propagate typed contracts through `queue-service.ts`.
- [x] **Task: Type Remaining Runtime Interfaces**
  - [x] Remove `any` from onboarding, lane executor, TUI dashboard, and skills types.
  - [x] Add narrow `unknown` handling where dynamic parsing is unavoidable.
- [x] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Strict Compliance Verification
- [x] **Task: Validate No-New-`any` Gate**
  - [x] Re-run static checks confirming targeted files are `any`-free.
  - [x] Ensure TypeScript build remains green after typing changes.
- [x] **Task: Regression Safety Validation**
  - [x] Run affected reliability and runtime tests.
  - [x] Capture post-refactor type-safety summary for release gate inputs.
- [x] **Task: Conductor - User Manual Verification 'Phase 3'**
