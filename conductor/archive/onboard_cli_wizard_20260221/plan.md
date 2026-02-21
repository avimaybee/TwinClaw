# Implementation Plan: Interactive CLI Onboarding Wizard (`twinclaw onboard`)

## Phase 1: Wizard UX & Prompt Contract
- [x] **Task: Define Onboarding Prompt Flow**
  - [x] Define prompt order and required fields for models, channels, and workspace.
  - [x] Define secure prompt modes (masked secrets, optional defaults, re-entry behavior).
- [x] **Task: Implement Interactive Prompt Runner**
  - [x] Build prompt orchestration with validation and retry behavior.
  - [x] Add cancellation handling with explicit partial-state behavior.
- [x] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Persistence & Validation Integration
- [x] **Task: Wire Wizard to Config Service**
  - [x] Serialize validated onboarding output into `twinclaw.json`.
  - [x] Ensure idempotent overwrite/merge semantics for reruns.
- [x] **Task: Integrate First-Run Guidance**
  - [x] Print deterministic next actions (`doctor`, channel login, pairing approve).
  - [x] Surface concise warnings when optional integrations are skipped.
- [x] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: CLI Hardening & Test Coverage
- [x] **Task: Add Non-Interactive/Automation Mode**
  - [x] Support flag-driven onboarding for scripted setups.
  - [x] Preserve validation parity between interactive and non-interactive modes.
- [x] **Task: Add Onboarding Regression Tests**
  - [x] Cover first-run success, rerun updates, invalid inputs, and cancellation.
  - [x] Verify no secret leakage in output/log surfaces.
- [x] **Task: Conductor - User Manual Verification 'Phase 3'**
