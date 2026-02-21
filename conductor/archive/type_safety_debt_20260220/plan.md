# Implementation Plan: Type Safety Debt Burn-Down (Strict TS Compliance)

## Phase 1: Type Debt Inventory & Contract Mapping
- [ ] **Task: Validate `any` Inventory**
  - [ ] Confirm and localize all outstanding `any` usages from the audit report.
  - [ ] Group usages by domain (delivery queue, DB rows, onboarding, runtime UI).
- [ ] **Task: Map Existing Reusable Types**
  - [ ] Identify existing shared interfaces and helper type guards.
  - [ ] Define any missing minimal type contracts for uncovered shapes.
- [ ] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Refactor to Strict Types
- [ ] **Task: Type Delivery Queue & DB Paths**
  - [ ] Replace untyped delivery-query return values with explicit row/result types.
  - [ ] Propagate typed contracts through `queue-service.ts`.
- [ ] **Task: Type Remaining Runtime Interfaces**
  - [ ] Remove `any` from onboarding, lane executor, TUI dashboard, and skills types.
  - [ ] Add narrow `unknown` handling where dynamic parsing is unavoidable.
- [ ] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Strict Compliance Verification
- [ ] **Task: Validate No-New-`any` Gate**
  - [ ] Re-run static checks confirming targeted files are `any`-free.
  - [ ] Ensure TypeScript build remains green after typing changes.
- [ ] **Task: Regression Safety Validation**
  - [ ] Run affected reliability and runtime tests.
  - [ ] Capture post-refactor type-safety summary for release gate inputs.
- [ ] **Task: Conductor - User Manual Verification 'Phase 3'**
