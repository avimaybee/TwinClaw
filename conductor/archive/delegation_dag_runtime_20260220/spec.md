# Specification: Delegation DAG Planner & Dependency-Aware Execution

## Overview
This track evolves delegation from independent sub-agent jobs into a dependency-aware execution graph so complex requests can be decomposed, sequenced, and recovered deterministically.

## Requirements
- Introduce a DAG contract for delegated briefs including stable node IDs and explicit dependencies.
- Validate delegation graphs for missing dependencies and cyclic references before execution.
- Execute jobs only when upstream dependencies complete successfully.
- Cancel dependent jobs automatically when a required parent fails.
- Persist graph-level events so operators can trace node ordering and failure propagation.

## Technical Mandates
- Keep the orchestration service as the only authority for delegation state transitions.
- Preserve explicit typed transitions and never silently skip dependency failures.
- Ensure graph execution remains bounded by existing timeout/retry/concurrency limits.
- Reuse current SQLite persistence and gateway delegation integration paths.
