# Specification: Channel Login + Doctor Validation Surfaces

## Overview
This track adds frictionless channel bootstrap commands and post-onboarding diagnostics so operators can connect messaging channels and validate readiness without manual token hunting or env edits.

## Requirements
- Implement/standardize `twinclaw channels login` for QR-based WhatsApp session linking.
- Ensure onboarding + channel login sequencing is explicit and operator-friendly.
- Extend `twinclaw doctor` checks to validate config integrity, channel auth state, and critical runtime prerequisites.
- Provide deterministic remediation guidance when channel sessions are disconnected or credentials are invalid.
- Keep diagnostics output consumable by both CLI operators and release gate workflows.

## Technical Mandates
- Channel login flow must avoid exposing secrets/QR artifacts in persistent logs.
- Doctor checks must be fast, deterministic, and side-effect minimal.
- Reuse existing health/config validation modules where possible.
- Channel readiness checks must remain compatible with pairing-first DM policy.
