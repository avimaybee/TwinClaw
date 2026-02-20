# Specification: Control Plane Observability & Callback Idempotency

## Overview
This track hardens control-plane operations by adding structured request observability and idempotent callback handling so external integrations remain reliable under retries and duplicate webhooks.

## Requirements
- Add correlation IDs and structured metadata for API request/response logs.
- Add idempotency handling for `/callback/webhook` payloads to safely deduplicate retries.
- Persist callback ingestion outcomes for replay/debugging.
- Add explicit operator-facing diagnostics for duplicate, invalid, and rejected callbacks.
- Keep existing endpoint contracts stable for current callers.

## Technical Mandates
- Keep handlers thin and route persistence/validation logic through service abstractions.
- Ensure signature validation and idempotency checks are explicit and auditable.
- Avoid silent drops; every rejected callback must produce a clear reason.
- Reuse existing response envelope and logging conventions.
