# Specification: MCP Runtime Capability Scopes & Health Circuit Breakers

## Overview
This track hardens MCP runtime execution by introducing server-level capability scopes and health-based circuit breakers so unstable or over-privileged external servers cannot destabilize core workflows.

## Requirements
- Define capability scopes per MCP server/tool (read-only, write-limited, high-risk blocked-by-default).
- Enforce runtime scope checks before MCP invocation in the lane execution path.
- Add per-server health tracking with circuit states (`closed`, `open`, `half_open`) based on failure thresholds.
- Add graceful fallback behavior when an MCP circuit opens (skip server, preserve parent response quality).
- Persist scope decisions and circuit transitions for audit/replay.

## Technical Mandates
- Reuse policy governance as the decision baseline; do not create bypass routes.
- Keep gateway + lane executor as the only tool execution pathways.
- Ensure circuits are deterministic, bounded, and automatically recoverable.
- Surface explicit diagnostics for blocked scope decisions and open circuits.
