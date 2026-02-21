# Implementation Plan: Runtime Config Migration & dotenv-vault Decommission

## Phase 1: Runtime Inventory & Migration Contract
- [ ] **Task: Audit Env-Coupled Runtime Paths**
  - [ ] Identify all startup/services depending on `.env` or dotenv-vault.
  - [ ] Classify paths as required migration, optional legacy bridge, or removal.
- [ ] **Task: Define Decommission Contract**
  - [ ] Define legacy behavior window and explicit warning/error semantics.
  - [ ] Define migration acceptance criteria for startup, doctor, and channel boot.
- [ ] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Runtime Refactor to JSON Config
- [ ] **Task: Refactor Startup + Services**
  - [ ] Replace env-first reads with central config service usage.
  - [ ] Keep path/profile overrides explicit and documented.
- [ ] **Task: Add Legacy Warning/Fail Paths**
  - [ ] Emit deterministic warnings for deprecated env usage.
  - [ ] Enforce hard failure when required JSON config is absent/invalid.
- [ ] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Regression Tests & Documentation Sync
- [ ] **Task: Add Migration Regression Tests**
  - [ ] Cover legacy env present/no JSON, JSON valid, JSON invalid, and mixed-mode scenarios.
  - [ ] Assert diagnostics include actionable migration guidance.
- [ ] **Task: Synchronize Runtime Documentation**
  - [ ] Remove obsolete dotenv-vault setup references in runtime docs.
  - [ ] Document supported override env variables only.
- [ ] **Task: Conductor - User Manual Verification 'Phase 3'**
