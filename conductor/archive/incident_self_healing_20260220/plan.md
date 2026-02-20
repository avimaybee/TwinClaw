# Implementation Plan: Incident Detection, Auto-Remediation & Operator Escalation

## Phase 1: Incident Signals & Policy Model
- [x] **Task: Define Incident Contracts**
  - [x] Define incident types, severities, and evidence payload schema.
  - [x] Define remediation policy and cooldown contracts.
- [x] **Task: Implement Signal Collectors**
  - [x] Add detectors for queue depth, callback error bursts, and context degradation.
  - [x] Add persistence for incident timeline entries.
- [x] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Playbooks & Escalation
- [x] **Task: Implement Auto-Remediation Playbooks**
  - [x] Add safe remediation actions with guardrails and rollback hooks.
  - [x] Add max-attempt and cooldown enforcement.
- [x] **Task: Implement Escalation Reporting**
  - [x] Add concise operator incident summary with recommended actions.
  - [x] Add API/GUI surfaces for current and historical incident states.
- [x] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Simulation & Hardening
- [x] **Task: Add Deterministic Incident Simulations**
  - [x] Add tests for detection thresholds and playbook selection logic.
  - [x] Add tests for cooldown behavior and escalation fallback.
- [x] **Task: Add Reliability Safeguards**
  - [x] Add protections against remediation oscillation loops.
  - [x] Add diagnostics counters for remediation outcomes.
- [x] **Task: Conductor - User Manual Verification 'Phase 3'**
