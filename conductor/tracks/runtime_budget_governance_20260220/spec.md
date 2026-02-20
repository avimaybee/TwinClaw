# Specification: Runtime Economics, Budget Guardrails & Adaptive Quality Profiles

## Overview
This track introduces usage-aware budget governance so TwinClaw can operate within free-tier API limits sustainably. The governor tracks daily/session/provider request and token counts, enforces configurable hard and warning thresholds, applies intelligent pacing, and surfaces a routing directive (profile, severity, blocked providers/models) that the model router consumes before each inference call.

## Requirements
- **RuntimeBudgetGovernor service:** Evaluate usage state and emit a routing directive on every request.
- **Budget profiles:** `economy`, `balanced`, `performance` — auto-selected by severity or operator-overridden.
- **Severity levels:** `ok`, `warning`, `hard_limit` — drive pacing delays and model/provider blocking.
- **Provider cooldowns:** Per-provider in-memory + DB-persisted cooldown on 429 or limit breach.
- **Manual profile override:** Operator can pin a profile via `setManualProfile`; persisted across restarts via DB state.
- **Snapshot API:** `getSnapshot()` returns full budget state including directive, aggregates, and recent events.
- **DB persistence:** `runtime_usage_events`, `runtime_budget_events`, `runtime_budget_state` tables via `better-sqlite3`.
- **Env-var configuration:** All limit thresholds overridable via `RUNTIME_BUDGET_*` environment variables.

## Technical Mandates
- Governor must be pure TypeScript with no network I/O; only DB reads/writes.
- Routing directive must be deterministic given the same DB state.
- Budget evaluation must not add measurable latency to the inference hot path (sub-millisecond DB reads).
- All events must be immutable once written; no destructive updates to the events tables.
