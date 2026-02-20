# Specification: Runtime Health, Doctor & Readiness Surfaces

## Overview
This track delivers complete health/readiness diagnostics across CLI and control-plane surfaces so operators can quickly identify and remediate runtime issues.

## Requirements
- Implement/finish `doctor` checks for core services, config readiness, and dependency health.
- Expose consistent readiness health signals for CLI/API/GUI consumption.
- Ensure health checks support startup preflight and ongoing runtime checks.
- Provide actionable remediation guidance for each failing check.

## Technical Mandates
- Keep health-check logic modular and deterministic.
- Reuse existing incident, heartbeat, and service-status sources where available.
- Emit redaction-safe diagnostics only.
- Add deterministic tests for passing, degraded, and failing readiness states.
