# Implementation Plan: Local Config Source-of-Truth & Schema Migration

## Phase 1: Config Schema & Storage Foundation
- [x] **Task: Define `twinclaw.json` Schema Contract**
  - [x] Define required/optional keys for models, channels, and defaults.
  - [x] Add/update a default schema artifact (`twinclaw.default.json` or equivalent) used by onboarding and gates.
- [x] **Task: Implement Config Path Resolution + IO**
  - [x] Resolve default path (`~/.twinclaw/twinclaw.json`) with override support.
  - [x] Implement safe read/write helpers with atomic persistence behavior.
- [x] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Runtime Adoption & Legacy Compatibility
- [x] **Task: Wire Runtime to Config Service**
  - [x] Refactor runtime consumers to read from centralized config service.
  - [x] Ensure startup fails fast with actionable validation errors on malformed config.
- [x] **Task: Add Legacy `.env` Migration Signaling**
  - [x] Emit explicit deprecation diagnostics for legacy env-based setups.
  - [x] Provide migration hints toward `twinclaw onboard` and config file generation.
- [x] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Validation Hardening & Documentation
- [x] **Task: Add Deterministic Tests for Config Lifecycle**
  - [x] Cover valid, missing, malformed, and partial-config scenarios.
  - [x] Verify secret-safe diagnostics and cross-platform path handling.
- [x] **Task: Publish Operator Guidance**
  - [x] Update configuration docs for path precedence and troubleshooting.
  - [x] Add examples for profile/custom-path usage.
- [x] **Task: Conductor - User Manual Verification 'Phase 3'**
