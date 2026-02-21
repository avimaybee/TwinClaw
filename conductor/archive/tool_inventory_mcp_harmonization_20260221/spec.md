# Specification: Native Tool Inventory & MCP Harmonization

## Core Goal
Standardize the TwinClaw skill ecosystem to tightly wrap the native `Tool Inventory` (Runtime, FS, Sessions, Web, UI, Automation, Messaging) while maintaining seamless MCP extension capabilities.

## Context
TwinClaw initially implemented its own custom `SkillRegistry` with manually defined builtin skills for basic file operations and terminal execution. The updated architecture offers a robust standard suite of built-in tool abstractions (`group:runtime`, `group:fs`) which feature integrated safety checks and loop-guardrails. Harmonizing these sets prevents tool duplication and ensures consistent behavior.

## Requirements
1. **Tool Groups Implementation:** Map TwinClaw’s builtins to `group:*` shorthands (e.g., `group:runtime` for `exec`, `process`).
2. **Apply Patch Tool:** Ensure `group:fs` implementations include standard file read/write, but explicitly implement `apply_patch` for diff-based editing.
3. **Loop Detection Guardrail:** Integrate the `loop-detection` capability. The orchestrator must track tool-call hashes and identify infinite loops if the LLM repeats identical calls without outcome progression.
4. **Registry Harmonization:** Update `SkillRegistry.ts` to expose these new integrated native tools alongside external servers from the `McpServerManager`.
5. **Tool Policies:** Adapt `tools.allow` and `tools.deny` configuration logic from the system schema to enable/disable specific tool groups or plugins per profile or model provider.
