# Specification: Local Config Source-of-Truth & Schema Migration

## Overview
This track establishes `~/.twinclaw/twinclaw.json` as TwinClaw's single configuration source, replacing fragile `.env` and dotenv-vault driven setup with a typed, local-first config contract.

## Requirements
- Define and enforce the canonical config path (`~/.twinclaw/twinclaw.json`) with optional override support.
- Define typed schema coverage for model credentials, channel settings, DM policy, and default runtime settings.
- Provide deterministic load/validate behavior for startup and CLI workflows.
- Introduce operator-readable validation errors that explain required remediation without exposing secrets.
- Provide a migration strategy for existing `.env` installations (warning path + explicit migration guidance).

## Technical Mandates
- Never log secret values; diagnostics may only report key presence/validity.
- Configuration writes must be atomic to avoid partial/corrupt state.
- Support Windows/macOS/Linux path resolution semantics.
- Reuse existing validation infrastructure where possible; avoid duplicate schema logic.
