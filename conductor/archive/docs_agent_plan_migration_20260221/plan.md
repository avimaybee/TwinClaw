# Implementation Plan: Agent Roadmap/Execution-Plan Docs Migration

## Phase 1: Stream Alpha Migration
- [x] **Task: Rewrite Phase A1 Setup Objectives**
  - [x] Replace dotenv/dotenv-vault setup tasks with onboarding wizard + JSON config tasks.
  - [x] Ensure config manager deliverables align with centralized schema contract.
- [x] **Task: Validate Stream Alpha Consistency**
  - [x] Ensure dependent phases reference the new config layer (not env files).
  - [x] Keep migration language actionable for autonomous implementation agents.
- [x] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Stream Beta Pairing Migration
- [x] **Task: Update Telegram Phase (B1)**
  - [x] Replace manual key/allowlist extraction steps with pairing challenge and approval command flow.
  - [x] Ensure command examples use `twinclaw pairing approve telegram <code>`.
- [x] **Task: Update WhatsApp Phase (B3)**
  - [x] Align onboarding and login references to wizard + channel login flow.
  - [x] Ensure DM access behavior references pairing policy rather than static whitelist.
- [x] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Review Readiness & Drift Prevention
- [x] **Task: Cross-Check Agent Plan Against PRD/Blueprint**
  - [x] Confirm terminology and command set consistency across documents.
  - [x] Remove stale env-oriented tasks in modified sections.
- [x] **Task: Publish Agent-Facing Migration Notes**
  - [x] Add concise execution notes for teams picking up the updated streams.
  - [x] Capture explicit out-of-scope items to prevent overreach.
- [x] **Task: Conductor - User Manual Verification 'Phase 3'**
