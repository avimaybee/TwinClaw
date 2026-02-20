# Specification: Accessibility Reference Browser Actions & Deterministic Click Mapping

## Overview
This track aligns TwinClaw's browser control-plane behavior with PRD requirements by introducing deterministic accessibility-reference mapping in snapshots and first-class click-by-reference actions.

## Requirements
- Extend browser snapshot output to include a normalized interactive-reference map with stable per-snapshot IDs, role/name metadata, and click-target hints.
- Add click-by-reference support (`ref`) to browser action endpoints so operators and agents can act on deterministic IDs instead of fragile selectors.
- Add stale-reference protection by scoping references to a snapshot context and returning explicit errors for expired or unknown IDs.
- Preserve backward compatibility for existing selector/coordinate click paths while promoting reference-first execution.
- Add operator diagnostics for reference generation, lookup misses, and invalid click-resolution outcomes.

## Technical Mandates
- Keep route handlers thin and place reference extraction/resolution logic in browser service modules.
- Ensure reference IDs are deterministic within a snapshot and bounded in memory lifecycle (no unbounded reference cache growth).
- Validate all request payloads with explicit status codes and actionable error messages.
- Keep all logging/transcript outputs aligned with existing redaction and audit conventions.
- Add deterministic tests for reference-map generation, stale reference handling, and click resolution correctness.

## Out of Scope
- Replacing the current VLM screenshot pipeline.
- OCR-specific extraction workflows.
- External browser-cloud orchestration.
