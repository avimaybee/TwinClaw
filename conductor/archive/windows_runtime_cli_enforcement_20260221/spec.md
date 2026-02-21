# Specification: Windows-Only Runtime & CLI Enforcement

## Goal
Enforce Windows as the only supported runtime platform for TwinClaw execution paths.

## Requirements
- Runtime startup must fail fast on non-Windows hosts.
- Gateway lifecycle commands must be explicitly Windows-only.
- Built-in runtime scripting must target PowerShell instead of bash.
- Binary-lookup helpers must use Windows-native command discovery.

## Acceptance Criteria
- `src/index.ts` blocks non-`win32` startup with a clear operator error.
- `src/core/gateway-cli.ts` resolves context only on `win32` and removes Linux/macOS service management paths.
- `src/skills/builtin.ts` exposes `runtime.powershell` (not `runtime.bash`).
- `src/core/doctor.ts` and `src/services/skill-package-manager.ts` use `where` for binary checks.

## Out of Scope
- Supporting or documenting Linux/macOS execution.
- Backporting compatibility shims for non-Windows shells.
