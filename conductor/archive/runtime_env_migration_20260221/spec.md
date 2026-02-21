# Specification: Runtime Config Migration & dotenv-vault Decommission

## Overview
This track removes env-file-centric runtime assumptions and migrates startup/runtime configuration flows to the new local JSON configuration architecture.

## Requirements
- Remove runtime dependence on dotenv-vault and `.env` as primary config source.
- Route all runtime config reads through centralized `twinclaw.json` loaders/validators.
- Maintain explicit compatibility messaging for legacy installations during migration period.
- Ensure startup and diagnostics surfaces remain deterministic under missing/invalid config states.
- Update operational docs to remove dotenv-vault references where runtime behavior changed.

## Technical Mandates
- Migration behavior must fail-safe: no silent defaults for missing required keys.
- Keep environment variables only for path/profile overrides and operational toggles.
- Preserve existing security posture (secret redaction, minimal exposure in logs).
- Avoid broad fallback catches; bubble validation failures with clear context.
