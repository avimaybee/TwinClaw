# Implementation Plan: Model Usage Telemetry, Cooldown Visibility & Fallback Mode Controls

## Phase 1: Telemetry Contracts & Data Pipeline
- [x] **Task: Define Routing Telemetry Contracts**
  - [x] Define typed telemetry schema for model attempts, failovers, cooldowns, and mode snapshots.
  - [x] Define bounded retention strategy for runtime and persisted telemetry windows.
- [x] **Task: Instrument Router Telemetry**
  - [x] Add structured telemetry emission in model routing and failover paths.
  - [x] Add persistence/query helpers for latest health and recent routing activity.
- [x] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Fallback Policy Modes & Visibility Surfaces
- [x] **Task: Add Fallback Mode Policy**
  - [x] Implement `intelligent_pacing` and `aggressive_fallback` mode behavior in routing decisions.
  - [x] Add validated persistence and startup loading for selected mode.
- [x] **Task: Expose Control Plane Visibility**
  - [x] Extend health/control-plane endpoints with model usage, cooldown, and mode diagnostics.
  - [x] Wire GUI/TUI surfaces to display current model, cooldown timers, and fallback mode.
- [x] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Operator UX Hardening & Test Coverage
- [x] **Task: Add Operator Guidance**
  - [x] Add actionable messages for degraded routing states and cooldown-heavy periods.
  - [x] Ensure diagnostics remain secret-safe and consistent across API/log/UI outputs.
- [x] **Task: Add Deterministic Tests**
  - [x] Add unit tests for mode-specific routing and cooldown behavior.
  - [x] Add integration tests for telemetry surfacing through API and dashboard consumers.
- [x] **Task: Conductor - User Manual Verification 'Phase 3'**

## Completion Notes
- Router now tracks bounded model telemetry events, cooldown timers, usage counters, and operator guidance.
- Control-plane `/health`, `/routing/telemetry`, and `/routing/mode` surfaces expose fallback mode and cooldown diagnostics.
- GUI overview now renders routing mode, failover/cooldown summary, and top operator guidance.
- Added deterministic unit/integration tests for fallback mode behavior and health telemetry surfacing.
