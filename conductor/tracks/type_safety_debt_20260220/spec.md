# Specification: Type Safety Debt Burn-Down (Strict TS Compliance)

## Overview
This track eliminates the known `any`-type debt in reliability-critical and operator-facing modules to restore strict TypeScript discipline.

## Requirements
- Remove the 17 reported `any` usages in targeted source files:
  - `src/services/queue-service.ts`
  - `src/services/db.ts`
  - `src/core/onboarding.ts`
  - `src/core/lane-executor.ts`
  - `src/interfaces/tui-dashboard.ts`
  - `src/skills/types.ts`
- Keep behavior equivalent while improving compile-time guarantees.
- Ensure updated types align with existing domain contracts and runtime schemas.

## Technical Mandates
- No `as any` escape hatches.
- Reuse existing DTOs/types before creating new ones.
- Prioritize typed DB row contracts for delivery/reliability paths.
- Validate strict compile and affected tests after refactor.
