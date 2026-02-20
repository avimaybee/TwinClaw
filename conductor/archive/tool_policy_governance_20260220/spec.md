# Specification: Policy-Aware Tool Governance & Permission Profiles

## Overview
This track introduces policy-driven tool governance so TwinClaw can enforce environment-aware and user-aware permission boundaries before executing high-risk skills.

## Requirements
- Define policy profiles for tool execution (allow, deny, require-explicit-confirmation).
- Enforce policy checks in the lane execution path before any tool invocation.
- Add audit logs for policy decisions and blocked tool calls.
- Support per-session overrides with safe defaults that remain restrictive.

## Technical Mandates
- Keep policy evaluation centralized and deterministic.
- Do not bypass policy checks from direct gateway or MCP tool paths.
- Ensure blocked actions produce explicit user-facing diagnostics.
- Reuse existing transcript logging and registry metadata where possible.
