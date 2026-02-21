# Plan: Type-Safety & Reliability Stabilization

1. **Remove `any` in Critical Surfaces**  
   - [x] Audit `src/services/db.ts` for type violations.  
   - [x] Audit `src/services/queue-service.ts` and dispatchers.  
   - [x] Audit `lane-runtime` logic if applicable.  

2. **Determentistic Test Hardening**  
   - [x] Identify and fix any intermittently failing tests in `tests/**`.  
   - [x] Implement better isolation for DB-related tests.  

3. **Strict Compliance Check**  
   - [x] Enforce strict mode in `tsconfig.json` for all directories.  
   - [x] Run `npm run check` as part of CI and pre-commit hooks.  

## Completion Notes
- Eliminated remaining `any` usage in `src/core` by hardening tool/core message typings.
- Stabilized config validation tests by restoring environment variables in `assertRuntimeConfig` suite cleanup.
- Added CI and local pre-commit guardrails for `npm run check` via workflow + `.githooks/pre-commit`.
