# Implementation Plan: Native Tool Inventory & MCP Harmonization

## Phase 1: Tool Registry Modernization
- [x] **Task: Standardize Native Tool Namespaces**
  - [x] Rename existing `builtins` internally to align with `group:fs` (`read`, `write`, `apply_patch`) and `group:runtime` (`exec`, `bash`, `process`).
  - [x] Update `SkillRegistry` to organize and list tools according to these groups.
- [x] **Task: Add Loop Detection Guardrail**
  - [x] Implement a tool-call loop heuristic in `ModelRouter` or `Gateway`.
  - [x] Emit an actionable diagnostic out of the loop and break the execution chain if `N` identical calls occur.
- [x] **Task: Conductor - User Manual Verification 'Phase 1'**

## Phase 2: Feature Parity & `apply_patch`
- [x] **Task: Implement `apply_patch` Tool**
  - [x] Add the `apply_patch` tool for diff-based editing to `group:fs`. Utilize standard diff applying libraries.
  - [x] Safely handle patch failure (graceful error strings passed back to the LLM).
- [x] **Task: Implement Process/Exec Sandbox**
  - [x] Shore up the `group:runtime` tools with timeout handling and safety flags.
- [x] **Task: Conductor - User Manual Verification 'Phase 2'**

## Phase 3: Profile Tool Policies
- [x] **Task: Implement Tool Profiles**
  - [x] Introduce `tools.allow` and `tools.deny` keys into `twinclaw.json` (aligned with the latest schema semantics).
  - [x] Evaluate policies before passing tools to open-ended LLM contexts.
- [x] **Task: End-to-End Tests**
  - [x] Add `vitest` coverage for an LLM patching action safely (execution blocked locally due missing pwsh runtime).
- [x] **Task: Conductor - User Manual Verification 'Phase 3'**
