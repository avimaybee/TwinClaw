# Implementation Plan: Local Config Source-of-Truth & Schema Migration

## Phase 1: Config Schema & Storage Foundation
- [ ] **Task: Define `twinclaw.json` Schema Contract**
  - [ ] Define required/optional keys for models, channels, and defaults.
  - [ ] Add/update a default schema artifact (`twinclaw.default.json` or equivalent) used by onboarding and gates.
- [ ] **Task: Implement Config Path Resolution + IO**
  - [ ] Resolve default path (`~/.twinclaw/twinclaw.json`) with override support.
  - [ ] Implement safe read/write helpers with atomic persistence behavior.
- [ ] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Runtime Adoption & Legacy Compatibility
- [ ] **Task: Wire Runtime to Config Service**
  - [ ] Refactor runtime consumers to read from centralized config service.
  - [ ] Ensure startup fails fast with actionable validation errors on malformed config.
- [ ] **Task: Add Legacy `.env` Migration Signaling**
  - [ ] Emit explicit deprecation diagnostics for legacy env-based setups.
  - [ ] Provide migration hints toward `twinclaw onboard` and config file generation.
- [ ] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Validation Hardening & Documentation
- [ ] **Task: Add Deterministic Tests for Config Lifecycle**
  - [ ] Cover valid, missing, malformed, and partial-config scenarios.
  - [ ] Verify secret-safe diagnostics and cross-platform path handling.
- [ ] **Task: Publish Operator Guidance**
  - [ ] Update configuration docs for path precedence and troubleshooting.
  - [ ] Add examples for profile/custom-path usage.
- [ ] **Task: Conductor - User Manual Verification 'Phase 3'**
