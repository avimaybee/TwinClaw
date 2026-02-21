# Implementation Plan: Interactive CLI Onboarding Wizard (`twinclaw onboard`)

## Phase 1: Wizard UX & Prompt Contract
- [ ] **Task: Define Onboarding Prompt Flow**
  - [ ] Define prompt order and required fields for models, channels, and workspace.
  - [ ] Define secure prompt modes (masked secrets, optional defaults, re-entry behavior).
- [ ] **Task: Implement Interactive Prompt Runner**
  - [ ] Build prompt orchestration with validation and retry behavior.
  - [ ] Add cancellation handling with explicit partial-state behavior.
- [ ] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Persistence & Validation Integration
- [ ] **Task: Wire Wizard to Config Service**
  - [ ] Serialize validated onboarding output into `twinclaw.json`.
  - [ ] Ensure idempotent overwrite/merge semantics for reruns.
- [ ] **Task: Integrate First-Run Guidance**
  - [ ] Print deterministic next actions (`doctor`, channel login, pairing approve).
  - [ ] Surface concise warnings when optional integrations are skipped.
- [ ] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: CLI Hardening & Test Coverage
- [ ] **Task: Add Non-Interactive/Automation Mode**
  - [ ] Support flag-driven onboarding for scripted setups.
  - [ ] Preserve validation parity between interactive and non-interactive modes.
- [ ] **Task: Add Onboarding Regression Tests**
  - [ ] Cover first-run success, rerun updates, invalid inputs, and cancellation.
  - [ ] Verify no secret leakage in output/log surfaces.
- [ ] **Task: Conductor - User Manual Verification 'Phase 3'**
