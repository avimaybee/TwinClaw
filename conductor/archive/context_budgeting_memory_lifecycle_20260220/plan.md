# Implementation Plan: Adaptive Context Budgeting & Memory Lifecycle Orchestrator

## Phase 1: Budget Contracts & Context Accounting
- [x] **Task: Define Context Budget Model**
  - [x] Add typed budget contracts for system/history/memory/delegation segments.
  - [x] Add deterministic token/size estimation utilities with bounded error expectations.
- [x] **Task: Integrate Budget Accounting in Gateway Assembly**
  - [x] Compute and persist per-turn budget allocation before model invocation.
  - [x] Add explicit logging for over-budget drops/reductions.
- [x] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Adaptive Retrieval & Session Compaction
- [x] **Task: Adaptive Retrieval Depth**
  - [x] Dynamically tune memory retrieval `topK` based on remaining context budget.
  - [x] Preserve memory relevance ordering while enforcing hard limits.
- [x] **Task: Long-Session Compaction**
  - [x] Add summary checkpoints for older turns with provenance tags.
  - [x] Introduce lifecycle transitions for hot/warm/archived memory segments.
- [x] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Diagnostics, Safety, and Regression Tests
- [x] **Task: Context Budget Diagnostics**
  - [x] Expose budget allocation and compaction outcomes for operator inspection.
  - [x] Add alertable counters for repeated over-budget degradations.
- [x] **Task: Deterministic Test Coverage**
  - [x] Add tests for budget boundaries, adaptive retrieval behavior, and compaction correctness.
  - [x] Add regression scenarios ensuring critical context is not silently lost.
- [x] **Task: Conductor - User Manual Verification 'Phase 3'**
