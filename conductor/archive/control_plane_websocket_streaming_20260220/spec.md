# Specification: Control Plane WebSocket Handshake & Real-Time Runtime Streaming

## Overview
This track adds an authenticated WebSocket control-plane channel for live runtime streaming so operators and interfaces can observe TwinClaw state changes without polling-heavy loops.

## Requirements
- Add a loopback-only control-plane WebSocket endpoint with explicit authentication handshake and rejection semantics.
- Define a typed event envelope for runtime status updates (health, reliability, incidents, and release lifecycle events).
- Support initial snapshot payloads on connect and incremental event pushes after subscription.
- Add bounded reconnect/fallback behavior for GUI and other operator clients so visibility remains resilient during transient disconnects.
- Add operator-facing diagnostics for connection lifecycle, auth failures, and dropped-event conditions.

## Technical Mandates
- Keep socket transport wiring modular (gateway/event producers separate from connection hub logic).
- Reuse existing health/reliability/incident/release services as event sources instead of duplicating state logic.
- Enforce deterministic, versioned payload contracts and explicit error close codes for failed auth/invalid subscriptions.
- Add guardrails for fan-out/backpressure (bounded queues, stale-connection cleanup, heartbeat/ping checks).
- Add deterministic tests for handshake auth, event delivery, reconnect behavior, and fallback semantics.
