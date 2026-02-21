# Specification: Interactive CLI Onboarding Wizard (`twinclaw onboard`)

## Overview
This track delivers a frictionless first-run onboarding wizard that collects required settings interactively and generates a valid `~/.twinclaw/twinclaw.json` configuration without requiring users to edit `.env` files.

## Requirements
- Implement an interactive `twinclaw onboard` command that captures model keys, channel preferences, and workspace defaults.
- Persist onboarding output into `~/.twinclaw/twinclaw.json` using the centralized config schema.
- Support re-running onboarding safely (idempotent updates, no duplicate/corrupt state).
- Provide clear validation feedback for required credentials and malformed values.
- Provide a non-interactive mode for scripted/bootstrap scenarios when required.

## Technical Mandates
- Secret prompts must be masked and never echoed in logs/transcripts.
- Onboarding must validate before write; invalid input must not produce partial config.
- Reuse central schema validation instead of duplicating validation logic.
- UX must produce explicit next-step commands (`twinclaw doctor`, `twinclaw channels login`, pairing approve flow).
