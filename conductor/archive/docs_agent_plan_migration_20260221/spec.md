# Specification: Agent Roadmap/Execution-Plan Docs Migration

## Overview
This track updates implementation planning docs so parallel agent execution follows the new onboarding-first, JSON-config, and pairing-policy architecture.

## Requirements
- Update `docs/plan-for-agents.md` Phase A1 to replace dotenv/dotenv-vault tasks with `twinclaw onboard` + JSON config parser tasks.
- Update Telegram/WhatsApp stream phases (B1/B3) to use `dmPolicy: "pairing"` and pairing approval command flows.
- Remove or rewrite references requiring manual `.env` extraction and ad hoc whitelist acquisition.
- Preserve multi-agent stream structure while aligning deliverables to release architecture.

## Technical Mandates
- Keep stream boundaries intact to avoid cross-agent scope drift.
- Ensure updated tasks remain implementation-ready and test-oriented.
- Keep channel tasks aligned with shared dispatcher/policy architecture.
- Avoid introducing provider/tooling requirements that conflict with current stack constraints.
