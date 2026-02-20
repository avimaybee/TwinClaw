# Specification: Gateway Control Plane & Lane Runtime

## Overview
This track implements the missing core gateway runtime that connects inbound interfaces to model routing, semantic memory, and lane-based tool execution. The goal is to make message processing deterministic, modular, and reusable across REPL and messaging adapters.

## Requirements
- Add a concrete gateway implementation that satisfies `GatewayHandler`.
- Build a lane loop that handles model `tool_calls` serially through `LaneExecutor`.
- Inject semantic memory context into the assembled system prompt for each request.
- Persist user/assistant/tool messages to SQLite session history.
- Keep explicit error signaling and avoid silent failures.

## Technical Mandates
- Preserve strict TypeScript typing and existing service abstractions.
- Reuse existing `ModelRouter`, `LaneExecutor`, and built-in skills instead of duplicating logic.
- Keep execution bounded (max tool rounds) to prevent runaway loops.
