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
- [x] **Task: Refactor Startup + Services**
  - [x] Replace env-first reads with central config service usage.
  - [x] Keep path/profile overrides explicit and documented.
- [x] **Task: Add Legacy Warning/Fail Paths**
  - [x] Emit deterministic warnings for deprecated env usage.
  - [x] Enforce hard failure when required JSON config is absent/invalid.
- [x] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Regression Tests & Documentation Sync
- [x] **Task: Add Migration Regression Tests**
  - [x] Cover legacy env present/no JSON, JSON valid, JSON invalid, and mixed-mode scenarios.
  - [x] Assert diagnostics include actionable migration guidance.
- [x] **Task: Synchronize Runtime Documentation**
  - [x] Remove obsolete dotenv-vault setup references in runtime docs.
  - [x] Document supported override env variables only.
- [x] **Task: Conductor - User Manual Verification 'Phase 3'**
