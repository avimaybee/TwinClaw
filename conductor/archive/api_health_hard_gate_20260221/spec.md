# Specification: API Health as Default Hard Gate

## Goal
To guarantee that the TwinClaw Gateway is fully operational before any interaction or release verdict is issued.

## Requirements
- **Startup:** The gateway must not background itself or report as ready until `GET /health` returns 200.
- **Probe:** Support deterministic Liveness/Readiness probes.
- **Gate:** The release gate CLI must perform a live probe to verify health.

## Constraints
- Probes must be performed within a configurable timeout.
- Shutdown must happen gracefully if health fails.
