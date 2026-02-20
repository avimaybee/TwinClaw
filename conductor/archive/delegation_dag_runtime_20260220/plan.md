# Implementation Plan: Delegation DAG Planner & Dependency-Aware Execution

## Phase 1: DAG Contracts & Validation
- [x] **Task: Extend Delegation Contracts**
  - [x] Add stable node IDs and `dependsOn` metadata to delegation briefs.
  - [x] Define graph validation errors for missing nodes and cyclic dependencies.
- [x] **Task: Implement Graph Validator**
  - [x] Build deterministic topological ordering for delegation nodes.
  - [x] Reject invalid graphs before any job starts.
- [x] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Dependency-Aware Runtime Execution
- [x] **Task: Add Dependency Scheduler**
  - [x] Queue only root-ready nodes and release children after parent completion.
  - [x] Block children when any required parent fails or is cancelled.
- [x] **Task: Persist Graph Events**
  - [x] Log node dependency resolution and failure-propagation events.
  - [x] Include graph execution summary in parent gateway context.
- [x] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Reliability Hardening
- [x] **Task: Add Graph Runtime Tests**
  - [x] Validate cycle detection, missing dependency handling, and topological ordering.
  - [x] Validate cancellation propagation and retry boundaries.
- [x] **Task: Add Operational Controls**
  - [x] Add graph depth and node-count ceilings to prevent runaway decomposition.
  - [x] Surface actionable failure diagnostics to parent responses.
- [x] **Task: Conductor - User Manual Verification 'Phase 3'**
  - [x] Build verified clean (`npx tsc --noEmit`). TS errors from cross-track integration fixed.
