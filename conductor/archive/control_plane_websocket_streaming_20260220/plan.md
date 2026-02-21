# Implementation Plan: Control Plane WebSocket Handshake & Real-Time Runtime Streaming

## Phase 1: WebSocket Protocol & Handshake Foundation
- [x] **Task: Define WebSocket Control-Plane Contracts**
  - [x] Add typed handshake/auth payload contracts and deterministic event envelope schema.
  - [x] Define close codes and error payload semantics for invalid auth/subscription input.
- [x] **Task: Implement WebSocket Hub Service**
  - [x] Add loopback-only WebSocket server wiring with authenticated session establishment.
  - [x] Add connection registry, heartbeat ping/pong checks, and stale-client cleanup.
- [x] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Runtime Event Producers & Client Integration
- [x] **Task: Integrate Runtime Event Sources**
  - [x] Stream health, reliability, incident timeline, and release lifecycle updates through the shared event envelope.
  - [x] Add initial snapshot frame dispatch on successful client subscription.
- [x] **Task: Integrate Operator Client Subscription Path**
  - [x] Add GUI/client-side subscription service with bounded reconnect strategy.
  - [x] Preserve polling fallback path when websocket transport is unavailable.
- [x] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Hardening, Diagnostics & Regression Coverage
- [x] **Task: Add Connection Diagnostics & Safeguards**
  - [x] Add metrics/logging for auth failures, reconnect churn, dropped events, and queue pressure.
  - [x] Add guardrails for per-client queue bounds and global fan-out safety.
- [x] **Task: Add Deterministic WebSocket Test Coverage**
  - [x] Add tests for handshake validation, event ordering/delivery, and reconnect behavior.
  - [x] Add regression tests confirming fallback behavior remains functional under socket outages.
- [x] **Task: Conductor - User Manual Verification 'Phase 3'**
