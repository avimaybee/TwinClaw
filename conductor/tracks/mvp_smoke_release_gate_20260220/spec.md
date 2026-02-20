# Specification: MVP Smoke Validation & Release Gate

## Overview
This track defines and enforces the minimum release gate required to declare TwinClaw a working MVP, based on build/test/command/health evidence.

## Requirements
- Define MVP acceptance criteria spanning install, setup, startup, build, test, and health diagnostics.
- Add deterministic smoke workflow covering core runtime and interface readiness.
- Block MVP declaration until acceptance criteria pass.
- Publish operator-facing release checklist and triage path for failures.

## Technical Mandates
- Use existing command/health services and test harness outputs as evidence sources.
- Keep gate criteria explicit, automatable, and reproducible.
- Separate hard-blocking criteria from non-blocking advisories.
- Ensure release gate can run in local-first environments without paid dependencies.
