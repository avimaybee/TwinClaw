# Specification: NPM Command Reliability Matrix & Script Repair

## Overview
This track ensures all documented npm commands are executable and reliable so agents and operators can consistently build, test, release, and validate TwinClaw.

## Requirements
- Audit and validate every npm script in `package.json` (root and relevant workspace paths).
- Fix broken script references, missing command prerequisites, and incompatible script flows.
- Ensure high-priority commands (`build`, `test`, `start`, `dev`, release commands) work from clean checkout.
- Add deterministic command-health verification output for operators.

## Technical Mandates
- Keep script names stable unless migration notes are provided.
- Prefer cross-platform-safe command composition.
- Surface actionable failures instead of opaque script exits.
- Feed command reliability status into MVP release readiness criteria.
