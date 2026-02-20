# Implementation Plan: NPM Command Reliability Matrix & Script Repair

## Phase 1: Script Inventory & Failure Baseline
- [x] **Task: Enumerate Script Surface**
  - [x] Inventory root and subproject npm scripts with expected behavior.
  - [x] Classify scripts by criticality (build/test/runtime/release/tooling).
- [x] **Task: Capture Script Failure Baseline**
  - [x] `npm run build` had 18 TypeScript errors across 5 source files.
  - [x] `npm test` had failures in 8 test files (27 test files total).
- [ ] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Script & Toolchain Repair
- [x] **Task: Patch Broken Scripts**
  - [x] `src/core/onboarding.ts` — null guard for `responseMessage.content` (TS error)
  - [x] `src/interfaces/whatsapp_handler.ts` — explicit type annotations for event callbacks (implicit `any`)
  - [x] `src/services/browser-service.ts` — typed `parentElement` in DOM loop
  - [x] `src/services/persona-state.ts` — `mkdir` wrapper returning `Promise<void>`; `originalRemoved` flag for accurate mid-flight rollback; `expectedRevision` cast
  - [x] `src/services/secret-vault.ts` — `Database.Database` instance type for `db` parameter
  - [x] `src/services/db.ts` — fix invalid sqlite-vec SQL (mutually exclusive `k=?` and `LIMIT` → `LIMIT` only)
  - [x] `src/services/skill-package-manager.ts` — packages-only comparison for `changed`; preserve `generatedAt` on idempotent reinstall; expanded constraints for transitive conflict detection
- [x] **Task: Add Deterministic Command Health Output**
  - [x] `npm run check` script added (runs `tsc --noEmit`) for zero-build verification
  - [x] All test mocks fixed: `db: null` exports, `scrubSensitiveText`, DB-linked state mocks
  - [x] `MockModelRouter` — force `aggressive_fallback` + no-op sleep to avoid timing-dependent failures
  - [x] `reasoning-graph.spec.ts` — `beforeAll` table cleanup to prevent cross-run vector DB pollution
  - [x] `runtime-budget-governor.spec.ts` — stateful `setRuntimeBudgetState`/`getRuntimeBudgetState` mocks
- [ ] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: End-to-End Command Verification
- [x] **Task: Validate Critical Command Matrix**
  - [x] `npm run build` → **0 errors** (was 18)
  - [x] `npm test` → **112 tests pass, 0 failures** across 27 test files (was multiple failures)
  - [x] CodeQL security scan → **0 alerts**
- [x] **Task: Publish Reliability Baseline**
  - [x] Build: zero TypeScript errors; all type contracts enforced
  - [x] Tests: 112/112 pass; no DB pollution; no timing-dependent failures
  - [x] Security: no new vulnerabilities introduced
- [ ] **Task: Conductor - User Manual Verification 'Phase 3'**
