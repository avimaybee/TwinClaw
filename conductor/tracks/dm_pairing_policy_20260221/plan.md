# Implementation Plan: DM Pairing Policy & Approval Commands

## Phase 1: Pairing Policy Core
- [ ] **Task: Implement Shared Pairing State Model**
  - [ ] Define pending/approved stores for channel-specific identities.
  - [ ] Implement code generation, expiry, and dedupe constraints.
- [ ] **Task: Integrate Pairing Gate in Channel Inbound Flow**
  - [ ] Apply pairing gate before agent execution for unknown DM senders.
  - [ ] Emit deterministic pairing challenge replies for eligible channels.
- [ ] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: CLI Pairing Controls
- [ ] **Task: Implement Pairing CLI Commands**
  - [ ] Add list/approve command surfaces with clear output.
  - [ ] Validate channel names and pairing-code states with actionable errors.
- [ ] **Task: Wire Channel Approval to Runtime Access**
  - [ ] Ensure approved identities are merged into runtime allow checks.
  - [ ] Ensure invalid/expired codes fail safely with no implicit bypass.
- [ ] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Coverage & Policy Hardening
- [ ] **Task: Add Pairing Regression Tests**
  - [ ] Cover unknown sender challenge, approval success, expiry, and pending limits.
  - [ ] Verify no message processing before approval.
- [ ] **Task: Document Pairing Operations**
  - [ ] Update channel docs and operator runbooks for pairing workflows.
  - [ ] Add migration notes from static allowlist behavior.
- [ ] **Task: Conductor - User Manual Verification 'Phase 3'**
