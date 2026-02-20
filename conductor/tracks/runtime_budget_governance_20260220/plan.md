# Implementation Plan: Runtime Economics, Budget Guardrails & Adaptive Quality Profiles

## Phase 1: Data Layer & Types
- [x] **Task: Define Runtime Budget Types**
  - [x] Create `src/types/runtime-budget.ts` with all budget interfaces (`RuntimeBudgetLimits`, `RuntimeBudgetProfile`, `RuntimeBudgetSeverity`, `RuntimeBudgetDirective`, `RuntimeBudgetSnapshot`, `RuntimeBudgetEvent`, etc.).
- [x] **Task: Implement DB Schema & Accessors**
  - [x] Add `runtime_usage_events`, `runtime_budget_events`, and `runtime_budget_state` tables to `src/services/db.ts`.
  - [x] Implement typed accessor functions: `recordRuntimeUsageEvent`, `recordRuntimeBudgetEvent`, `getRuntimeBudgetState`, `setRuntimeBudgetState`, `clearRuntimeBudgetState`, `listRuntimeBudgetEvents`, `getRuntimeDailyUsageAggregate`, `getRuntimeSessionUsageAggregate`, `listRuntimeProviderUsageAggregates`.
- [x] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Governor Service
- [x] **Task: Implement RuntimeBudgetGovernor**
  - [x] Create `src/services/runtime-budget-governor.ts` with full governor class.
  - [x] Implement `getRoutingDirective()`, `recordUsage()`, `applyProviderCooldown()`, `setManualProfile()`, `resetPolicyState()`, `getSnapshot()`, `getRecentEvents()`.
  - [x] Implement private `#evaluate()` severity/profile/action resolution logic.
  - [x] Implement `#recordTransition()` to suppress duplicate budget events.
  - [x] Support env-var overrides for all limit thresholds (`RUNTIME_BUDGET_*`).
- [x] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Integration & API Surface
- [x] **Task: Expose Budget Endpoints on Control Plane**
  - [x] Add `GET /budget/snapshot` and `POST /budget/profile` routes to the control-plane HTTP router.
  - [x] Wire `RuntimeBudgetGovernor` into the model router so every inference request consults the directive.
- [x] **Task: Unit Tests**
  - [x] Write tests covering severity escalation, profile selection, provider cooldown, manual override, and env-var configuration.
- [x] **Task: Conductor - User Manual Verification 'Phase 3'**
