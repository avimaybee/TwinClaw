# Implementation Plan: Persistent Delivery Queue & Dead-Letter Recovery

## Phase 1: Queue Schema & Core Delivery State Machine
- [x] **Task: Add Delivery Queue Persistence**
  - [x] Add SQLite tables for queued deliveries, attempts, and dead-letter records.
  - [x] Define typed state transitions and transition guards.
- [x] **Task: Implement Queue Service**
  - [x] Add enqueue/dequeue/ack/fail operations with transaction safety.
  - [x] Add bounded retry scheduling metadata.
- [x] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Dispatcher & Callback Integration
- [x] **Task: Integrate Queue with Dispatcher**
  - [x] Route outbound proactive/reply sends through the queue service.
  - [x] Preserve existing adapter routing semantics.
- [x] **Task: Callback Reconciliation Wiring**
  - [x] Correlate callback payloads with queue records and finalize state transitions.
  - [x] Ensure duplicate callbacks remain idempotent and non-destructive.
- [x] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Dead-Letter Operations & Test Coverage
- [x] **Task: Dead-Letter Replay Tooling**
  - [x] Add replay/requeue operations with audit logs.
  - [x] Add metrics for dead-letter growth, replay success, and terminal failures.
- [x] **Task: Reliability Regression Tests**
  - [x] Add deterministic tests for restart recovery, retry exhaustion, and replay correctness.
  - [x] Add integration tests for queue + callback reconciliation paths.
- [x] **Task: Conductor - User Manual Verification 'Phase 3'**
