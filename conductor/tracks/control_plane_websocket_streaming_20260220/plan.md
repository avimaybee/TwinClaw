# Implementation Plan: Control Plane WebSocket Handshake & Real-Time Runtime Streaming

## Phase 1: WebSocket Protocol & Handshake Foundation
- [ ] **Task: Define WebSocket Control-Plane Contracts**
  - [ ] Add typed handshake/auth payload contracts and deterministic event envelope schema.
  - [ ] Define close codes and error payload semantics for invalid auth/subscription input.
- [ ] **Task: Implement WebSocket Hub Service**
  - [ ] Add loopback-only WebSocket server wiring with authenticated session establishment.
  - [ ] Add connection registry, heartbeat ping/pong checks, and stale-client cleanup.
- [ ] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Runtime Event Producers & Client Integration
- [ ] **Task: Integrate Runtime Event Sources**
  - [ ] Stream health, reliability, incident timeline, and release lifecycle updates through the shared event envelope.
  - [ ] Add initial snapshot frame dispatch on successful client subscription.
- [ ] **Task: Integrate Operator Client Subscription Path**
  - [ ] Add GUI/client-side subscription service with bounded reconnect strategy.
  - [ ] Preserve polling fallback path when websocket transport is unavailable.
- [ ] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Hardening, Diagnostics & Regression Coverage
- [ ] **Task: Add Connection Diagnostics & Safeguards**
  - [ ] Add metrics/logging for auth failures, reconnect churn, dropped events, and queue pressure.
  - [ ] Add guardrails for per-client queue bounds and global fan-out safety.
- [ ] **Task: Add Deterministic WebSocket Test Coverage**
  - [ ] Add tests for handshake validation, event ordering/delivery, and reconnect behavior.
  - [ ] Add regression tests confirming fallback behavior remains functional under socket outages.
- [ ] **Task: Conductor - User Manual Verification 'Phase 3'**
