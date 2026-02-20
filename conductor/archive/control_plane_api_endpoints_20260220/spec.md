# Specification: Control Plane HTTP API & Webhook Callback Layer

## Overview
This track formalizes an HTTP control-plane surface for health checks, browser operations, and long-running task callbacks so TwinClaw can interoperate cleanly with external systems.

## Requirements
- Implement stable internal endpoints: `GET /health`, `POST /browser/snapshot`, and `POST /browser/click`.
- Add webhook callback ingestion for long-running external task completion events.
- Route endpoint actions through existing gateway/browser services instead of duplicating business logic.
- Introduce request validation and signature/auth checks for callback endpoints.
- Emit structured logs and response envelopes consistent with existing runtime conventions.

## Technical Mandates
- Keep routers thin; move endpoint logic into dedicated handler modules.
- Reuse shared response/error utilities and avoid per-handler response drift.
- Validate all inbound payloads before invoking gateway, browser, or skill paths.
- Ensure endpoint failures are explicit and non-silent for operator observability.
