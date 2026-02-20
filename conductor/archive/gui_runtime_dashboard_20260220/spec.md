# Specification: Live GUI Control Plane Dashboard & Runtime Controls

## Overview
This track upgrades the GUI from static scaffolded panels to a live control-plane dashboard that reflects runtime health, reliability telemetry, and operational controls.

## Requirements
- Replace static GUI placeholders with live data from control-plane endpoints.
- Add runtime status cards for health, uptime, skill counts, and interface reliability metrics.
- Add resilient polling/subscription behavior with explicit offline/error states.
- Add safe runtime controls for read-only operations first (refresh, inspect, view logs), with clearly gated mutating actions.
- Keep UI responsive and functional when backend is unavailable.

## Technical Mandates
- Route GUI data access through a dedicated GUI-side service layer (no ad hoc fetches in view components).
- Reuse existing API response envelopes and type contracts.
- Preserve accessibility and clear error feedback in dashboard components.
- Keep transport retries bounded and avoid runaway polling loops.
