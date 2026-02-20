# Implementation Plan: MCP Skill Registry & External Server Integrations

## Phase 1: Skill Registry Refactor
- [x] **Task: Define Registry Contracts**
  - [x] Extend skill typing to include JSON schema parameter definitions.
  - [x] Add registry APIs for dynamic skill registration and lookup.
- [x] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: MCP Transport Integration
- [x] **Task: Connect MCP Servers**
  - [x] Add adapters for GitHub, Context7, and Zapier MCP servers.
  - [x] Convert MCP tool metadata into internal skill contracts.
- [x] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Gateway Tool Exposure
- [x] **Task: Surface MCP Tools in Lane Runtime**
  - [x] Merge local and MCP skills into one tool catalog for model routing.
  - [x] Add telemetry and graceful degradation for unavailable servers.
- [x] **Task: Conductor - User Manual Verification 'Phase 3'**
