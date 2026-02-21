# Implementation Plan: TwinClaw Workspace & Profile Alignment

## Phase 1: Core Path Refactoring & Configuration Update
- [x] **Task: Update Configuration Loader**
  - [x] Modify `getConfigPath` and related defaults to resolve to `~/.twinclaw/workspace/twinclaw.json` (or `~/.twinclaw/workspace-<profile>` if `TWINCLAW_PROFILE` is set).
  - [x] Ensure `twinclaw.json` is treated as the canonical config inside the new workspace environment.
- [x] **Task: Ensure Database and Identity Paths Follow Workspace**
  - [x] Update `db.ts` to initialize SQLite within the active workspace.
  - [x] Update `FileWatcherService` to monitor `identity/` inside the active workspace.
- [ ] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Migration Mechanism & Tooling
- [x] **Task: Implement Workspace Migration Utility**
  - [x] Write a routine on startup that detects legacy flat `~/.twinclaw/` and securely moves files to the new `~/.twinclaw/workspace/` location if empty.
  - [x] Update `twinclaw onboard` interactive prompts to mention the new workspace paradigms.
- [x] **Task: Create Git Backup Scaffolding**
  - [x] Auto-generate a robust `.gitignore` inside the workspace (ignoring `*.sqlite`, `*.sqlite-journal`, etc.) upon initialization.
- [ ] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Profile Testing & Finalizing
- [x] **Task: Test Profile Isolation**
  - [x] Add explicit Vitest tests ensuring passing `TWINCLAW_PROFILE=test` resolves to `workspace-test` fully isolated from `default`.
- [x] **Task: Documentation Polish**
  - [x] Remove mentions of the old `.twinclaw` home directory in `README` and `docs/`.
- [ ] **Task: Conductor - User Manual Verification 'Phase 3'**
