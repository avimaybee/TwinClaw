# Plan: Onboarding Wizard UX 2.0 (Interactive Stepper)

## Phase 1: UX and Flow Design
- [x] Task: Define wizard step model and section boundaries.
- [x] Task: Design choice-first prompts with recommended defaults.
- [x] Task: Define revise loop for summary confirmation.

## Phase 2: Wizard Implementation
- [x] Task: Refactor onboarding prompt engine to support sectioned step navigation.
- [x] Task: Add inline validation and retry messaging per field group.
- [x] Task: Add summary/review step with confirm-or-edit path before write.

## Phase 3: Compatibility and Verification
- [x] Task: Keep `--non-interactive` behavior backward-compatible.
- [x] Task: Add onboarding setup tests for stepper flow, validation retries, and summary edits.
- [x] Task: Verify secret masking still prevents sensitive output leakage.
