# Specification: MVP Gate / Checklist Wizard-First Alignment

## Overview
This track updates release gate policy and smoke checks so MVP readiness is assessed against the new wizard-first setup architecture instead of legacy `.env` expectations.

## Requirements
- Update `docs/mvp-release-checklist.md` hard-gate references to verify CLI onboarding wizard assets.
- Replace `.env.example`-style assumptions with JSON schema/template asset checks (`twinclaw.default.json` or equivalent).
- Ensure check IDs and evidence mapping remain deterministic for automated gate tooling.
- Align smoke scenario matrix with the config migration deliverables.
- Preserve triage ownership semantics while updating references to new setup components.

## Technical Mandates
- Keep gate criteria executable by existing `npm run mvp:gate` workflows.
- Avoid introducing brittle checks tied to optional integrations.
- Ensure docs and gate script check IDs stay synchronized.
- Keep release decision protocol semantics unchanged (`go`, `advisory-only`, `no-go`).
