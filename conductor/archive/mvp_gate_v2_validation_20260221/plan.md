# Plan: MVP Gate v2 (Deep Config/Vault Validation)

1. **Implement JSON Schema Validation**  
   - [x] Define JSON schema-equivalent validator for `twinclaw.json`.  
   - [x] Add deterministic config validation in MVP gate runtime checks.  

2. **Verify Onboarding Execution**  
   - [x] Trigger a simulated non-interactive `onboard` run from the gate service.  
   - [x] Verify onboarding smoke output against the config schema validator.  

3. **Map Vault Health to Verdicts**  
   - [x] Add `secret-vault doctor` check to gate hard-gates.  
   - [x] Mark gate as "fail" when vault health is degraded/critical.  

## Collaboration Notes
- Added hard-gate checks for `config-schema` and `vault-health` plus stronger onboarding smoke validation.
- Expanded `tests/harness/mvp-gate.spec.ts` with schema, onboarding, and vault-failure regression coverage.
- CI workflow, release checklist docs, and gate CLI flags were aligned to the new hard-gate behavior.
