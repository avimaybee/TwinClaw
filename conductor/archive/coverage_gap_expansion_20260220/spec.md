# Specification: Coverage Gap Closure for Messaging, MCP, Proactive & Observability

## Overview
This track closes audit-identified test coverage gaps in key runtime subsystems that currently lack dedicated verification.

## Requirements
- Add dedicated tests for messaging voice/dispatch paths.
- Add dedicated tests for MCP registry/server-manager behavior.
- Add dedicated tests for proactive execution notifier/scheduler interactions.
- Add dedicated tests for observability/control-plane instrumentation paths.

## Technical Mandates
- Keep tests deterministic and isolated from external network dependencies.
- Reuse existing harness patterns and fixtures.
- Prioritize reliability-critical and operator-critical scenarios.
- Ensure coverage additions integrate with existing test command flows.
