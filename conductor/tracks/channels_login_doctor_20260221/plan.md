# Implementation Plan: Channel Login + Doctor Validation Surfaces

## Phase 1: Channel Login Foundations
- [ ] **Task: Implement `channels login` Flow**
  - [ ] Add command routing for channel-specific login (starting with WhatsApp QR).
  - [ ] Persist linked-channel state in local credentials/config storage.
- [ ] **Task: Improve Operator Login UX**
  - [ ] Emit clear prompts for scan/wait/success/failure outcomes.
  - [ ] Provide explicit next-step guidance for pairing and readiness checks.
- [ ] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Doctor Readiness Expansion
- [ ] **Task: Add Channel/Config Readiness Checks**
  - [ ] Validate `twinclaw.json` schema + required integration keys.
  - [ ] Validate channel auth/link state and readiness for inbound processing.
- [ ] **Task: Integrate with Existing Diagnostics Surfaces**
  - [ ] Ensure structured doctor output includes channel-specific remediation.
  - [ ] Keep checks reusable for release gate and support scripts.
- [ ] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Test Coverage & Ops Documentation
- [ ] **Task: Add Login/Doctor Regression Tests**
  - [ ] Cover successful link, disconnected session, invalid config, and recovery.
  - [ ] Verify diagnostics remain secret-safe under failure conditions.
- [ ] **Task: Update Operational Documentation**
  - [ ] Document wizard -> login -> doctor -> pairing first-run sequence.
  - [ ] Document troubleshooting for common channel bootstrap failures.
- [ ] **Task: Conductor - User Manual Verification 'Phase 3'**
