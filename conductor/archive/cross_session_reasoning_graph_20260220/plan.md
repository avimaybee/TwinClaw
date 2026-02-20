# Implementation Plan: Cross-Session Reasoning Graph & Evidence-Aware Retrieval

> Verification note: `pwsh` is unavailable in this environment, so verification was completed through targeted IDE diagnostics (TypeScript), deterministic harness tests added for reasoning-graph paths, and focused code-review pass on changed modules.

## Phase 1: Graph Data Model & Ingestion
- [x] **Task: Define Reasoning Graph Contracts**
  - [x] Add typed node/edge DTOs and persistence contracts.
  - [x] Add relationship taxonomy with validation.
- [x] **Task: Implement Graph Persistence**
  - [x] Add SQLite schema/migrations for nodes, edges, and provenance links.
  - [x] Add idempotent upsert paths for graph writes.
- [x] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Evidence-Aware Retrieval
- [x] **Task: Add Hybrid Retrieval Planner**
  - [x] Blend semantic vector score + graph support score + recency.
  - [x] Add bounded traversal for dependency/evidence expansion.
- [x] **Task: Integrate Gateway Context Assembly**
  - [x] Inject provenance-backed memory bundles into runtime prompt context.
  - [x] Surface contradiction/conflict markers in diagnostics.
- [x] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Reliability & Test Hardening
- [x] **Task: Add Deterministic Graph Tests**
  - [x] Cover node/edge ingestion, idempotency, conflict detection, retrieval ranking.
  - [x] Cover budget-safe traversal and prompt context formatting.
- [x] **Task: Add Observability Hooks**
  - [x] Add debug counters for graph hits/misses and contradiction detections.
  - [x] Add failure-mode tests for malformed provenance paths.
- [x] **Task: Conductor - User Manual Verification 'Phase 3'**
