# Implementation Plan: DM Pairing Policy & Approval Commands

## Phase 1: Pairing Policy Core
- [x] **Task: Implement Shared Pairing State Model**
  - [x] Define pending/approved stores for channel-specific identities.
  - [x] Implement code generation, expiry, and dedupe constraints.
- [x] **Task: Integrate Pairing Gate in Channel Inbound Flow**
  - [x] Apply pairing gate before agent execution for unknown DM senders.
  - [x] Emit deterministic pairing challenge replies for eligible channels.
- [x] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: CLI Pairing Controls
- [x] **Task: Implement Pairing CLI Commands**
  - [x] Add list/approve command surfaces with clear output.
  - [x] Validate channel names and pairing-code states with actionable errors.
- [x] **Task: Wire Channel Approval to Runtime Access**
  - [x] Ensure approved identities are merged into runtime allow checks.
  - [x] Ensure invalid/expired codes fail safely with no implicit bypass.
- [x] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Coverage & Policy Hardening
- [x] **Task: Add Pairing Regression Tests**
  - [x] Cover unknown sender challenge, approval success, expiry, and pending limits.
  - [x] Verify no message processing before approval.
- [x] **Task: Document Pairing Operations**
  - [x] Update channel docs and operator runbooks for pairing workflows.
  - [x] Add migration notes from static allowlist behavior.
- [x] **Task: Conductor - User Manual Verification 'Phase 3'**
