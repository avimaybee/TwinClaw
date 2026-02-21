# Specification: MVP Gate v2 (Deep Config/Vault Validation)

## Goal
To ensure that every release candidate has a valid configuration schema and a healthy secret vault, verifiable by automated release gate tooling.

## Requirements
- **JSON Schema:** Must enforce all required fields in `twinclaw.json`.
- **Onboarding:** Must verify the `onboard` command correctly generates the config file.
- **Vault:** Must integrate a readiness probe for the secret-vault service.

## Technical Mandates
- Do not expose secret contents during JSON validation.
- The gate must fail if the vault is inaccessible or corrupted.
