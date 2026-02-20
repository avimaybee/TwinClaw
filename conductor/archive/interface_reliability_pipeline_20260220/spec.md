# Specification: Interface Reliability Pipeline & Callback Recovery

## Overview
This track improves cross-platform messaging reliability by adding delivery retries, callback reconciliation, and failure telemetry across Telegram and WhatsApp adapters.

## Requirements
- Add retry/backoff handling for outbound message delivery in dispatcher adapters.
- Track pending callback states for async interface operations and reconcile completion/failure events.
- Add structured reliability telemetry for failed sends, retries, and ultimate delivery outcomes.
- Keep platform-specific behavior while preserving one normalized dispatcher pipeline.

## Technical Mandates
- Keep dispatcher as the only adapter-to-gateway bridge.
- Avoid duplicating reliability logic across Telegram and WhatsApp handlers.
- Ensure retry logic is bounded and failures are surfaced explicitly.
- Persist operational events for postmortem traceability.
