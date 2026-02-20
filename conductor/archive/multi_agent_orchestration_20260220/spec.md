# Specification: Multi-Agent Orchestration & Delegation Runtime

## Overview
This track introduces a first-class orchestration runtime that allows TwinClaw to spawn, supervise, and reconcile sub-agent work for complex requests while keeping the gateway deterministic and auditable.

## Requirements
- Add an orchestration service for sub-agent lifecycle management (spawn, observe, cancel, finalize).
- Define delegation contracts for task brief, scoped context, tool budget, and expected output format.
- Integrate delegation decisions into the gateway loop so orchestration can be triggered intentionally, not ad hoc.
- Persist orchestration state transitions and outputs into session history for replay and debugging.
- Enforce hard safety limits (max concurrent agents, timeout ceilings, and explicit failure propagation).

## Technical Mandates
- Keep gateway as the single control-plane entrypoint; no side-channel dispatch paths.
- Use explicit typed state transitions (`queued -> running -> completed|failed|cancelled`) for orchestration jobs.
- Ensure sub-agent failures degrade gracefully to a useful parent response instead of crashing the runtime.
- Reuse existing memory, lane, and transcript infrastructure instead of duplicating context assembly.
