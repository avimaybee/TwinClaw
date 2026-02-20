# Specification: CLI Hardening, User Onboarding & "Doctor" Diagnostics

## Overview
This track strengthens first-run and day-2 operator experience by adding a robust diagnostics command, safer configuration workflows, and guided onboarding for local TwinClaw deployments.

## Requirements
- Add a `doctor` diagnostics command that validates runtime prerequisites, environment variables, and core service connectivity.
- Add guided onboarding prompts for required keys and platform setup with explicit validation feedback.
- Add safer CLI command handling with clearer errors, help output, and actionable remediation hints.
- Ensure diagnostics output is machine-readable and human-readable for both CLI and GUI surfaces.
- Keep onboarding idempotent so reruns do not corrupt existing configuration.

## Technical Mandates
- Reuse existing config/env helpers and avoid duplicated validation logic.
- Surface explicit error causes and next actions; no silent failures.
- Keep diagnostics checks deterministic and fast enough for local interactive use.
- Add tests for critical doctor checks and onboarding validation paths.
