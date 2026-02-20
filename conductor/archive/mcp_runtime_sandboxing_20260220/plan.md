# Implementation Plan: MCP Runtime Capability Scopes & Health Circuit Breakers

## Phase 1: Capability Scope Model
- [x] **Task: Define MCP Capability Profiles**
  - [x] Add typed scope contracts for server-level and tool-level permissions.
  - [x] Add secure defaults for unclassified MCP tools.
- [x] **Task: Scope Enforcement Integration**
  - [x] Apply scope checks before MCP tool invocation in lane execution.
  - [x] Emit explicit blocked-action diagnostics with profile references.
- [x] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Server Health Circuits
- [x] **Task: Implement Health Scoring and Circuit State**
  - [x] Track per-server failures, latency spikes, and timeout counts.
  - [x] Add deterministic open/half-open/closed transition rules.
- [x] **Task: Runtime Fallback Behavior**
  - [x] Skip open circuits while preserving useful parent responses.
  - [x] Add cooldown + probe behavior for half-open recovery.
- [x] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Auditability & Tests
- [x] **Task: Persist Scope + Circuit Events**
  - [x] Record scope enforcement outcomes and circuit transitions in SQLite/transcripts.
  - [x] Expose summary diagnostics for operator visibility.
- [x] **Task: Deterministic Regression Coverage**
  - [x] Add tests for scope precedence, circuit transitions, and fallback guarantees.
  - [x] Add integration scenarios with mixed MCP success/failure conditions.
- [x] **Task: Conductor - User Manual Verification 'Phase 3'**
