# Implementation Plan: Accessibility Reference Browser Actions & Deterministic Click Mapping

## Phase 1: Reference Contracts & Snapshot Mapping Foundation
- [x] **Task: Define Browser Reference Contracts**
  - [x] Add typed DTOs for snapshot reference maps and click-by-reference requests.
  - [x] Define deterministic error contracts for invalid/missing/stale references.
- [x] **Task: Implement Snapshot Reference Extraction**
  - [x] Add accessibility-tree traversal that emits stable reference IDs for interactive nodes.
  - [x] Add bounded in-memory snapshot context storage for later reference resolution.
- [x] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Click-by-Reference Integration & Compatibility
- [x] **Task: Add Click-by-Reference Routing Path**
  - [x] Extend browser click handler to accept `ref` and resolve it against stored snapshot contexts.
  - [x] Return explicit diagnostics for unresolved, stale, and non-interactive references.
- [x] **Task: Preserve Existing Click Path Compatibility**
  - [x] Keep selector/coordinate click routes functional with unchanged envelope semantics.
  - [x] Add clear preference guidance to encourage reference-first execution in operator tooling.
- [x] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Hardening, Observability & Deterministic Tests
- [x] **Task: Add Reference Diagnostics & Safeguards**
  - [x] Add metrics/log events for reference generation counts, lookup failures, and click outcome states.
  - [x] Add reference-context eviction safeguards to prevent stale buildup.
- [x] **Task: Add Deterministic Browser Reference Tests**
  - [x] Add tests for reference map reproducibility and stale-reference error handling.
  - [x] Add integration tests for click-by-reference success paths and compatibility fallback behavior.
- [x] **Task: Conductor - User Manual Verification 'Phase 3'**
