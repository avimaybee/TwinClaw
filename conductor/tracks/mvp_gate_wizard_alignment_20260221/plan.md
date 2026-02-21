# Implementation Plan: MVP Gate / Checklist Wizard-First Alignment

## Phase 1: Gate Criteria Contract Update
- [x] **Task: Update Hard Gate Setup Criteria**
  - [x] Replace legacy env-template assumptions with onboarding wizard/file checks.
  - [x] Align check naming and evidence references with current CLI/config artifacts.
- [x] **Task: Update Smoke Scenario Matrix**
  - [x] Ensure required asset checks include JSON config schema/template coverage.
  - [x] Remove stale scenario entries tied to deprecated setup flow.
- [x] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Automation Alignment
- [x] **Task: Update Gate Runner Check IDs**
  - [x] Ensure runtime gate code emits check IDs matching updated checklist docs.
  - [x] Preserve backward-compatible triage output where feasible.
- [x] **Task: Validate Evidence Output**
  - [x] Verify JSON/Markdown gate reports include updated criteria and ownership mappings.
  - [x] Confirm no false failures on valid wizard-first setups.
- [x] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Release Readiness Verification
- [x] **Task: Execute End-to-End Gate Dry Run**
  - [x] Run local gate workflow against migrated setup baseline.
  - [x] Capture pass/fail behaviors and verify expected operator guidance.
- [x] **Task: Publish Checklist Migration Notes**
  - [x] Summarize gate changes for release operators and track owners.
  - [x] Document remaining deferred setup checks (if any) for post-MVP follow-up.
- [x] **Task: Conductor - User Manual Verification 'Phase 3'**
