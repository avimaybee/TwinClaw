# Plan: Windows-Only Runtime & CLI Enforcement

## Phase 1: Scope and Baseline
- [x] Task: Audit runtime and CLI code paths for Linux/macOS branching.
- [x] Task: Identify tests coupled to non-Windows behavior.

## Phase 2: Implementation
- [x] Task: Add startup platform guard in `src/index.ts`.
- [x] Task: Restrict gateway lifecycle implementation to Windows in `src/core/gateway-cli.ts`.
- [x] Task: Replace `runtime.bash` with `runtime.powershell` in `src/skills/builtin.ts`.
- [x] Task: Standardize command discovery to `where` in doctor and skill package manager services.

## Phase 3: Verification
- [x] Task: Update gateway CLI tests to validate Windows-only behavior.
- [x] Task: Run `npm run check` and `npm test` in an environment with `pwsh.exe` available.

## Progress Notes
- Runtime enforcement changes are implemented and wired.
- Local verification complete (tests pass on Windows environment).

