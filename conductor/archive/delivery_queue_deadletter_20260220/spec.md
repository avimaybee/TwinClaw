# Specification: Persistent Delivery Queue & Dead-Letter Recovery

## Overview
This track upgrades outbound interface reliability from in-memory attempts to durable queue-backed delivery so message sends can survive process restarts and be replayed safely.

## Requirements
- Add a SQLite-backed outbound delivery queue with explicit states (`queued`, `dispatching`, `sent`, `failed`, `dead_letter`).
- Persist retry attempts and transition records for every outbound send.
- Route exhausted failures into a dead-letter queue with replay/retry controls.
- Reconcile callback outcomes against queued records to close delivery loops deterministically.
- Expose queue and dead-letter visibility for operations troubleshooting.

## Technical Mandates
- Keep dispatcher as the only interface-to-gateway bridge.
- Ensure retry/dead-letter transitions are explicit, bounded, and auditable.
- Preserve platform-specific adapter behavior while centralizing queue logic.
- Reuse existing reliability telemetry patterns and response envelopes.
