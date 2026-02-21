# Implementation Plan: Channel Login + Doctor Validation Surfaces

## Phase 1: Channel Login Foundations
- [x] **Task: Implement `channels login` Flow**
  - [x] Add command routing for channel-specific login (starting with WhatsApp QR).
  - [x] Persist linked-channel state in local credentials/config storage.
- [x] **Task: Improve Operator Login UX**
  - [x] Emit clear prompts for scan/wait/success/failure outcomes.
  - [x] Provide explicit next-step guidance for pairing and readiness checks.
- [x] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Doctor Readiness Expansion
- [x] **Task: Add Channel/Config Readiness Checks**
  - [x] Validate `twinclaw.json` schema + required integration keys.
  - [x] Validate channel auth/link state and readiness for inbound processing.
- [x] **Task: Integrate with Existing Diagnostics Surfaces**
  - [x] Ensure structured doctor output includes channel-specific remediation.
  - [x] Keep checks reusable for release gate and support scripts.
- [x] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Test Coverage & Ops Documentation
- [x] **Task: Add Login/Doctor Regression Tests**
  - [x] Cover successful link, disconnected session, invalid config, and recovery.
  - [x] Verify diagnostics remain secret-safe under failure conditions.
- [x] **Task: Update Operational Documentation**
  - [x] Document wizard -> login -> doctor -> pairing first-run sequence.
  - [x] Document troubleshooting for common channel bootstrap failures.
- [x] **Task: Conductor - User Manual Verification 'Phase 3'**
