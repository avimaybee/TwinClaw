# MVP Gate Migration Notes: Wizard-First Alignment

## Overview
The MVP Gate and Release Checklist have been updated to align with the new wizard-first setup architecture. Legacy `.env.example` expectations have been replaced with checks for the CLI onboarding wizard and JSON configuration templates.

## Key Changes
- **Gate ID Change**: `env-config` has been replaced by `cli-onboard`.
- **Primary Setup Asset**: The gate now verifies the existence of `src/core/onboarding.ts` (the wizard logic) instead of `.env.example`.
- **Smoke Scenario Update**: `core:env-template` has been renamed to `core:config-template` and now verifies `twinclaw.default.json`.
- **Triage Alignment**: Failures in the onboarding check are now routed to **Track 23: CLI Hardening, User Onboarding & Doctor Diagnostics**.

## Operator Impact
- Running `npm run mvp:gate` no longer requires a `.env.example` file to be present in the root.
- A `twinclaw.default.json` file must be present in the root as a template for the onboarding wizard.
- If the onboarding wizard code is missing, the gate will return a `no-go` verdict.

## Deferred Setup Checks (Post-MVP)
- Integration of `twinclaw.json` (user-specific config) schema validation into the gate.
- Automated verification of the `twinclaw onboard` CLI command execution (currently only file-existence is checked).
- Mapping of secret vault status to gate readiness.
