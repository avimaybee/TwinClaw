# Specification: Model Usage Telemetry, Cooldown Visibility & Fallback Mode Controls

## Overview
This track closes a core product gap around operator transparency and control for model routing by exposing live model usage/cooldown telemetry and introducing explicit runtime fallback modes aligned with zero-cost resilience goals.

## Requirements
- Add a model usage telemetry layer that records per-provider and per-model request volume, failure/rate-limit counts, and active cooldown windows.
- Add a runtime fallback policy mode with explicit user-selectable behavior: `intelligent_pacing` (wait/retry preferred) and `aggressive_fallback` (provider switch preferred).
- Add API/GUI/TUI visibility for current model, recent failovers, cooldown timers, and fallback mode so users can understand routing decisions in real time.
- Add policy persistence and safe defaults so mode selection survives restarts and remains backward compatible for existing setups.
- Add operator-facing summaries/remediation hints when routing degrades (e.g., all providers cooling down).

## Technical Mandates
- Reuse existing router/health/control-plane services; avoid duplicating routing state logic.
- Keep telemetry writes bounded and deterministic (no unbounded in-memory growth).
- Ensure all surfaced diagnostics are scrubbed for secrets and safe for logs/UI.
- Add deterministic tests for mode behavior, cooldown transitions, and telemetry accuracy.

## Out of Scope
- New third-party model providers.
- Billing integration with external provider invoices.
- Replacing the existing incident auto-remediation playbook system.
